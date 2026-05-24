import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db.js';
import { decryptApiKey } from '../lib/crypto.js';
import { TOOL_DEFS, executeTool, createWalkFromCompose, updateWalkFromCompose } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_LOOP_ITERATIONS = 20;

/**
 * Run (or resume) an agent run, streaming events to the provided SSE.
 */
export async function runAgentLoop(sse, runId) {
  const heartbeat = setInterval(() => sse.heartbeat(), HEARTBEAT_INTERVAL_MS);
  const cleanup = () => clearInterval(heartbeat);

  try {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        user: {
          select: {
            id: true,
            apiKeyCipher:  true,
            apiKeyNonce:   true,
            apiKeyAuthTag: true,
          },
        },
      },
    });
    if (!run) {
      sse.send('error', { message: 'Run not found' });
      sse.close(); cleanup();
      return;
    }

    if (run.status === 'composed') {
      sse.send('composed', { walkId: run.walkId });
      sse.close(); cleanup();
      return;
    }

    if (run.status === 'error') {
      sse.send('error', { message: run.errorMessage || 'Run is in error state' });
      sse.close(); cleanup();
      return;
    }

    let apiKey;
    try {
      apiKey = decryptApiKey({
        cipher:  run.user.apiKeyCipher,
        nonce:   run.user.apiKeyNonce,
        authTag: run.user.apiKeyAuthTag,
      });
    } catch {
      sse.send('error', { message: 'Could not decrypt your API key. Try rotating it in Account.' });
      await markError(runId, 'apikey-decrypt-failed');
      sse.close(); cleanup();
      return;
    }

    const client = new Anthropic({ apiKey });

    let messages = Array.isArray(run.messages) ? [...run.messages] : [];
    if (messages.length === 0) {
      messages = [{
        role: 'user',
        content: [{ type: 'text', text: buildInitialUserMessage(run.briefSnapshot) }],
      }];
    }

    for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
      if (sse.isClosed()) break;

      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: 'active', messages },
      });

      let stream;
      try {
        stream = client.messages.stream({
          model:    MODEL,
          system:   SYSTEM_PROMPT,
          tools:    TOOL_DEFS,
          max_tokens: MAX_TOKENS,
          messages,
        });
      } catch (err) {
        await failRun(sse, runId, formatAnthropicError(err));
        cleanup(); return;
      }

      stream.on('text', (textDelta) => {
        sse.send('message_delta', { delta: textDelta });
      });

      let finalMessage;
      try {
        finalMessage = await stream.finalMessage();
      } catch (err) {
        await failRun(sse, runId, formatAnthropicError(err));
        cleanup(); return;
      }

      messages = [...messages, { role: 'assistant', content: finalMessage.content }];

      if (finalMessage.stop_reason === 'end_turn') {
        if (run.walkId) {
          // Refinement: the walk already exists and the agent answered
          // conversationally without recomposing. That's allowed — just pause.
          await prisma.agentRun.update({
            where: { id: runId },
            data: { status: 'composed', messages },
          });
          sse.send('turn_end', {});
          sse.close(); cleanup();
          return;
        }
        await prisma.agentRun.update({
          where: { id: runId },
          data: { status: 'error', errorMessage: 'Agent ended without composing a walk', messages },
        });
        sse.send('error', { message: 'Agent ended without composing a walk.' });
        sse.close(); cleanup();
        return;
      }

      if (finalMessage.stop_reason !== 'tool_use') {
        await failRun(sse, runId, `Unexpected stop_reason: ${finalMessage.stop_reason}`);
        cleanup(); return;
      }

      const toolUses = finalMessage.content.filter(b => b.type === 'tool_use');

      const reqInput = toolUses.find(t => t.name === 'request_user_input');
      if (reqInput) {
        if (toolUses.length > 1) {
          await failRun(sse, runId, 'Agent called request_user_input alongside other tools (not allowed)');
          cleanup(); return;
        }
        await prisma.agentRun.update({
          where: { id: runId },
          data: { status: 'awaiting_user', messages },
        });
        sse.send('awaiting_user', { question: reqInput.input.question, toolUseId: reqInput.id });
        sse.close(); cleanup();
        return;
      }

      const compose = toolUses.find(t => t.name === 'compose_walk');
      if (compose) {
        try {
          // First composition creates the walk; a refinement (run.walkId already
          // set) updates that same walk in place.
          let walkId = run.walkId;
          if (walkId) {
            await updateWalkFromCompose(walkId, run.briefSnapshot, compose.input);
          } else {
            walkId = await createWalkFromCompose(
              run.user.id,
              runId,
              run.briefSnapshot,
              compose.input,
            );
          }
          messages = [...messages, {
            role: 'user',
            content: [{
              type:         'tool_result',
              tool_use_id:  compose.id,
              content:      JSON.stringify({ walk_id: walkId }),
            }],
          }];
          await prisma.agentRun.update({
            where: { id: runId },
            data: { messages, status: 'composed', walkId },
          });
          sse.send('composed', { walkId });
          sse.close(); cleanup();
          return;
        } catch (err) {
          await failRun(sse, runId, 'compose_walk validation failed: ' + err.message);
          cleanup(); return;
        }
      }

      const toolResults = [];
      for (const tu of toolUses) {
        if (sse.isClosed()) break;

        // web_search is hosted by Anthropic — should never appear as a client-handled tool_use.
        if (tu.name === 'web_search') continue;

        sse.send('tool_start', { tool: tu.name, input: tu.input });

        try {
          const result = await executeTool(tu.name, tu.input, { userId: run.user.id, runId });
          sse.send('tool_done', { tool: tu.name });
          toolResults.push({
            type:         'tool_result',
            tool_use_id:  tu.id,
            content:      JSON.stringify(result),
          });
        } catch (err) {
          sse.send('tool_done', { tool: tu.name, error: err.message });
          toolResults.push({
            type:         'tool_result',
            tool_use_id:  tu.id,
            content:      JSON.stringify({ error: err.message }),
            is_error:     true,
          });
        }
      }

      messages = [...messages, { role: 'user', content: toolResults }];
    }

    await failRun(sse, runId, 'Agent run exceeded maximum iterations');
    cleanup();
    return;
  } catch (err) {
    console.error('[loop] unexpected error', err);
    try {
      await failRun(sse, runId, 'Unexpected server error');
    } catch {}
    cleanup();
  }
}

/**
 * Build the very first user message text from the brief snapshot.
 */
function buildInitialUserMessage(brief) {
  const mobility = brief.mobility.join(', ');
  const styles   = brief.styles.join(', ');
  return [
    `Here is the brief.`,
    ``,
    `Location:      ${brief.locationName}`,
    `Duration:      ${brief.durationMin} minutes`,
    `Time of day:   ${brief.timeOfDay}`,
    `Camera:        ${brief.cameraLabel}`,
    `Lens:          ${brief.lensSpec}`,
    `Mobility:      ${mobility}`,
    `Styles open to: ${styles}`,
    `Route shape:   ${brief.roundTrip
      ? 'Round trip — start and finish at the SAME point, with photo stops distributed all through the loop'
      : 'One way — point to point'}`,
    brief.intent ? `Intent:        ${brief.intent}` : null,
    ``,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ].filter(Boolean).join('\n');
}

async function markError(runId, message) {
  try {
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'error', errorMessage: message },
    });
  } catch {}
}

async function failRun(sse, runId, message) {
  await markError(runId, message);
  sse.send('error', { message });
  sse.close();
}

function formatAnthropicError(err) {
  if (err?.status === 401) return 'Your Anthropic API key is invalid. Rotate it in Account.';
  if (err?.status === 429) return 'Anthropic rate limit hit. Try again in a moment.';
  if (err?.status === 400) {
    const msg = err?.error?.error?.message || err.message;
    return `Anthropic rejected the request: ${msg}`;
  }
  if (err?.error?.error?.message) return err.error.error.message;
  return err?.message || 'Anthropic call failed';
}
