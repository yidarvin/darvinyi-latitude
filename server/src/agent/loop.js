import Anthropic, { APIUserAbortError } from '@anthropic-ai/sdk';
import { prisma } from '../db.js';
import { decryptApiKey } from '../lib/crypto.js';
import { TOOL_DEFS, executeTool, createWalkFromCompose, updateWalkFromCompose, validateComposeInput } from './tools.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 16000;
const MAX_TOKENS_RETRY = 32000; // one-shot bump if a turn hits stop_reason:'max_tokens'
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_LOOP_ITERATIONS = 20;

// System prompt is byte-stable across every iteration of every run — cache
// it (and the tools rendered just before it) so a 5-15 iteration run doesn't
// re-process the identical prefix at full price on the user's own API key.
const CACHED_SYSTEM = [
  { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
];

/**
 * Runs currently being looped, keyed by AgentRun id. Lets a fresh connection
 * (browser reconnect, a second tab, or the abort endpoint) preempt whatever
 * loop is already live for that run, instead of two loops running at once.
 * Single-instance Railway deploy makes an in-process Map sufficient.
 */
const activeRuns = new Map(); // runId -> { sse, abort() }

/**
 * Best-effort: stop whatever loop is currently running for `runId`, if any.
 * Used by the abort endpoint so "Stop walk" takes effect immediately even
 * while the SSE connection is still open and the agent is mid-turn.
 */
export function abortActiveRun(runId) {
  const existing = activeRuns.get(runId);
  if (!existing) return false;
  try { existing.sse.close(); } catch {}
  try { existing.abort(); } catch {}
  return true;
}

const STALE_RUN_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * A run stuck in 'active' or 'awaiting_user' with no activity for 24h means
 * the user closed the tab mid-dialogue and never came back — not a run
 * anyone is about to resume. Left alone, it lingers forever: the stream
 * route would keep silently resurrecting it, and a stale 'awaiting_user' run
 * would keep re-asking a question from weeks ago. Flip it to 'abandoned' the
 * next time anything reads it, rather than running a scheduled sweep job.
 */
export async function reapIfStale(run) {
  if (!run || !['active', 'awaiting_user'].includes(run.status)) return run;
  const idleMs = Date.now() - new Date(run.updatedAt).getTime();
  if (idleMs < STALE_RUN_THRESHOLD_MS) return run;
  return prisma.agentRun.update({
    where: { id: run.id },
    data: { status: 'abandoned' },
  });
}

/**
 * Close every currently-open agent-run SSE stream and abort its in-flight
 * Anthropic call. Used during graceful shutdown so an in-progress run gets a
 * clean, resumable disconnect (persisted status stays 'active') instead of
 * an abrupt connection drop when the process exits mid-response.
 */
export function closeAllActiveRuns() {
  for (const runId of [...activeRuns.keys()]) {
    abortActiveRun(runId);
  }
}

/**
 * Run (or resume) an agent run, streaming events to the provided SSE.
 */
export async function runAgentLoop(sse, runId) {
  // Preempt any loop already live for this run (second tab, browser
  // auto-reconnect racing a still-running old loop, etc). Closing the old
  // sse makes its next isClosed() check return cleanly instead of erroring;
  // aborting its in-flight stream (if any) stops burning tokens immediately.
  abortActiveRun(runId);

  let currentStream = null;
  const controller = {
    sse,
    abort: () => { if (currentStream) { try { currentStream.abort(); } catch {} } },
  };
  activeRuns.set(runId, controller);

  const heartbeat = setInterval(() => sse.heartbeat(), HEARTBEAT_INTERVAL_MS);
  const cleanup = () => {
    clearInterval(heartbeat);
    if (activeRuns.get(runId) === controller) activeRuns.delete(runId);
  };
  sse.onClose?.(() => controller.abort());

  try {
    let run = await prisma.agentRun.findUnique({
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
    run = await reapIfStale(run);

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

    if (run.status === 'abandoned') {
      sse.send('error', { message: 'This walk was stopped.' });
      sse.close(); cleanup();
      return;
    }

    if (!run.user.apiKeyCipher) {
      sse.send('error', { message: 'No Anthropic API key on file. Add one in Account to plan a walk.' });
      await markError(runId, 'no-api-key');
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

    /**
     * Start one model turn and wait for it to finish. Tracks the in-flight
     * stream on `currentStream` so a disconnect (via sse.onClose above) or a
     * preemption (via abortActiveRun) can cancel it immediately.
     */
    async function callModel(msgs, maxTokens) {
      const stream = client.messages.stream({
        model:      MODEL,
        system:     CACHED_SYSTEM,
        tools:      TOOL_DEFS,
        max_tokens: maxTokens,
        messages:   withCacheBreakpoint(msgs),
        // Omitted display keeps thinking blocks out of the visible message
        // stream (the Dialogue UI only renders `message_delta` as one
        // continuous reply) — thinking still happens and improves route
        // quality, it's just not surfaced as separate "reasoning" text yet.
        thinking:   { type: 'adaptive', display: 'omitted' },
      });
      currentStream = stream;
      stream.on('text', (textDelta) => sse.send('message_delta', { delta: textDelta }));
      try {
        const result = await stream.finalMessage();
        if (result.usage) {
          console.log(`[run:${runId}] usage: input=${result.usage.input_tokens} cache_read=${result.usage.cache_read_input_tokens ?? 0} cache_write=${result.usage.cache_creation_input_tokens ?? 0} output=${result.usage.output_tokens}`);
        }
        return result;
      } finally {
        currentStream = null;
      }
    }

    for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
      if (sse.isClosed()) { cleanup(); return; }

      // Atomically confirm this run is still ours to advance. If it isn't
      // (e.g. the user hit "Stop walk" from another tab between iterations),
      // this matches 0 rows and we stop without overwriting that decision.
      const claimed = await prisma.agentRun.updateMany({
        where: { id: runId, status: { in: ['active'] } },
        data:  { status: 'active', messages },
      });
      if (claimed.count === 0) { cleanup(); return; }

      let finalMessage;
      try {
        finalMessage = await callModel(messages, MAX_TOKENS);
      } catch (err) {
        await handleAnthropicError(sse, runId, err, messages);
        cleanup(); return;
      }

      if (finalMessage.stop_reason === 'max_tokens') {
        // One retry with a larger budget before giving up — the truncated
        // content is discarded rather than appended, since a partial
        // tool_use block with no matching tool_result would break the next
        // request's message structure.
        try {
          finalMessage = await callModel(messages, MAX_TOKENS_RETRY);
        } catch (err) {
          await handleAnthropicError(sse, runId, err, messages);
          cleanup(); return;
        }
        if (finalMessage.stop_reason === 'max_tokens') {
          await failRun(sse, runId,
            "The agent's response was too long, even after retrying with more room. Try a shorter brief or fewer stops.",
            messages);
          cleanup(); return;
        }
      }

      messages = [...messages, { role: 'assistant', content: finalMessage.content }];

      if (finalMessage.stop_reason === 'pause_turn') {
        // Anthropic's hosted web_search tool hit its internal round limit.
        // Re-sending this history resumes the paused turn automatically —
        // no extra user message needed.
        continue;
      }

      if (finalMessage.stop_reason === 'end_turn') {
        if (run.walkId) {
          // Refinement: the walk already exists and the agent answered
          // conversationally without recomposing. That's allowed — just pause.
          const claim = await prisma.agentRun.updateMany({
            where: { id: runId, status: { in: ['active'] } },
            data:  { status: 'composed', messages },
          });
          if (claim.count === 0) { cleanup(); return; }
          sse.send('turn_end', {});
          sse.close(); cleanup();
          return;
        }
        await failRun(sse, runId, 'Agent ended without composing a walk.', messages);
        cleanup(); return;
      }

      if (finalMessage.stop_reason !== 'tool_use') {
        await failRun(sse, runId, `Unexpected stop_reason: ${finalMessage.stop_reason}`, messages);
        cleanup(); return;
      }

      const toolUses = finalMessage.content.filter(b => b.type === 'tool_use');

      const reqInput = toolUses.find(t => t.name === 'request_user_input');
      if (reqInput && toolUses.length > 1) {
        // Model violated "request_user_input must be the only tool call this
        // turn." Recoverable: reject the whole turn so it can retry within
        // budget, rather than failing the run outright.
        const rejection = toolUses.map(tu => ({
          type:        'tool_result',
          tool_use_id: tu.id,
          content:     JSON.stringify({
            error: 'request_user_input must be the only tool call in a turn. Call it alone, or leave it out and call your other tools this turn instead.',
          }),
          is_error: true,
        }));
        messages = [...messages, { role: 'user', content: rejection }];
        continue;
      }
      if (reqInput) {
        const claim = await prisma.agentRun.updateMany({
          where: { id: runId, status: { in: ['active'] } },
          data:  { status: 'awaiting_user', messages },
        });
        if (claim.count === 0) { cleanup(); return; }
        sse.send('awaiting_user', { question: reqInput.input.question, toolUseId: reqInput.id });
        sse.close(); cleanup();
        return;
      }

      const toolResults = [];
      let composedThisTurn = null;

      for (const tu of toolUses) {
        // web_search is hosted by Anthropic — should never appear as a client-handled tool_use.
        if (tu.name === 'web_search') continue;

        if (tu.name === 'compose_walk') {
          // abortActiveRun's stream.abort() only cancels an in-flight
          // Anthropic call (currentStream) — it's a no-op once that call has
          // already resolved and execution has moved into tool handling. A
          // fresh connection racing a slow compose_walk here would otherwise
          // let this stale instance persist a Walk alongside the new
          // instance's, producing a silent duplicate. activeRuns holds
          // whichever controller is currently authoritative for this runId,
          // so if it's no longer ours, bail before writing anything.
          if (activeRuns.get(runId) !== controller) { cleanup(); return; }

          sse.send('tool_start', { tool: 'compose_walk', input: tu.input });
          try {
            // The JSON schema sent to Anthropic is advisory, not enforced —
            // validate for real before this reaches Prisma.
            const validated = validateComposeInput(tu.input);

            // First composition creates the walk; a refinement (run.walkId
            // already set) updates that same walk in place.
            let walkId = run.walkId;
            if (walkId) {
              await updateWalkFromCompose(walkId, run.briefSnapshot, validated);
            } else {
              walkId = await createWalkFromCompose(run.user.id, run.briefSnapshot, validated);
            }
            sse.send('tool_done', { tool: 'compose_walk' });
            composedThisTurn = { walkId };
            toolResults.push({
              type:        'tool_result',
              tool_use_id: tu.id,
              content:     JSON.stringify({ walk_id: walkId }),
            });
          } catch (err) {
            console.error(`[run:${runId}] compose_walk failed: ${err.message}`);
            sse.send('tool_done', { tool: 'compose_walk', error: err.message });
            // Recoverable: let the model see what went wrong (e.g. bad
            // coordinates) and retry, instead of losing the whole dialogue.
            toolResults.push({
              type:        'tool_result',
              tool_use_id: tu.id,
              content:     JSON.stringify({ error: err.message }),
              is_error:    true,
            });
          }
          continue;
        }

        sse.send('tool_start', { tool: tu.name, input: tu.input });
        try {
          const result = await executeTool(tu.name, tu.input, { userId: run.user.id, runId });
          sse.send('tool_done', { tool: tu.name });
          toolResults.push({
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     JSON.stringify(result),
          });
        } catch (err) {
          sse.send('tool_done', { tool: tu.name, error: err.message });
          toolResults.push({
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     JSON.stringify({ error: err.message }),
            is_error:    true,
          });
        }
      }

      messages = [...messages, { role: 'user', content: toolResults }];

      if (composedThisTurn) {
        const claim = await prisma.agentRun.updateMany({
          where: { id: runId, status: { in: ['active'] } },
          data:  { messages, status: 'composed', walkId: composedThisTurn.walkId },
        });
        if (claim.count === 0) { cleanup(); return; }
        sse.send('composed', { walkId: composedThisTurn.walkId });
        sse.close(); cleanup();
        // Best-effort, non-blocking — regenerate the folio insight on the
        // photographer's own key. A failure here never affects the run;
        // routes/folio.js falls back to its template logic until this lands.
        generateFolioInsight(client, run.user.id).catch((err) => {
          console.error(`[run:${runId}] insight generation failed:`, err.message);
        });
        return;
      }
    }

    await failRun(sse, runId, 'Agent run exceeded maximum iterations', messages);
    cleanup();
    return;
  } catch (err) {
    console.error(`[run:${runId}] unexpected error in loop:`, err);
    try {
      await failRun(sse, runId, 'Unexpected server error');
    } catch (failErr) {
      console.error(`[run:${runId}] failed to record the unexpected error:`, failErr);
    }
    cleanup();
  }
}

/**
 * Mark the last content block of the last message as a cache breakpoint, for
 * this request only — never mutates the caller's `messages`, since that
 * array gets persisted to the DB and cache_control is a per-request hint,
 * not conversation content. Each iteration's history extends the previous
 * one, so the prior breakpoint's prefix is reused and only the new tail
 * (this iteration's tool results) gets cached fresh.
 */
function withCacheBreakpoint(msgs) {
  if (msgs.length === 0) return msgs;
  const last = msgs[msgs.length - 1];
  if (!Array.isArray(last.content) || last.content.length === 0) return msgs;
  const lastIndex = last.content.length - 1;
  const patchedContent = last.content.map((block, i) =>
    i === lastIndex ? { ...block, cache_control: { type: 'ephemeral' } } : block
  );
  return [...msgs.slice(0, -1), { ...last, content: patchedContent }];
}

/**
 * Build the very first user message text from the brief snapshot.
 */
function buildInitialUserMessage(brief) {
  const styles = brief.styles.join(', ');
  return [
    `Here is the brief.`,
    ``,
    `Location:      ${brief.locationName}`,
    `Duration:      ${brief.durationMin} minutes`,
    `Time of day:   ${brief.timeOfDay}`,
    `Camera:        ${brief.cameraLabel}`,
    `Lens:          ${brief.lensSpec}`,
    `Styles open to: ${styles}`,
    `Route shape:   ${brief.roundTrip
      ? 'Round trip — start and finish at the SAME point, with photo stops distributed all through the loop'
      : 'One way — point to point'}`,
    brief.intent ? `Intent:        ${brief.intent}` : null,
    ``,
    // brief.localDate is the photographer's own calendar date; server UTC
    // is only a fallback for briefs submitted before this field existed.
    `Today is ${brief.localDate || new Date().toISOString().slice(0, 10)}.`,
  ].filter(Boolean).join('\n');
}

/**
 * Regenerate the user's standing folio insight — one short, specific
 * observation about their recent walking habits — right after a compose.
 * Uses the same per-request client (the photographer's own key) that just
 * finished the run. Best-effort: any failure here is swallowed by the
 * caller, which only logs it; routes/folio.js falls back to its
 * template-built insight whenever this hasn't run yet or has failed.
 */
async function generateFolioInsight(client, userId) {
  const recent = await prisma.walk.findMany({
    where: { userId, status: { not: 'draft' } },
    orderBy: { date: 'desc' },
    take: 5,
    select: { title: true, locationName: true, timeOfDay: true, styles: true, date: true },
  });
  if (recent.length === 0) return;

  const history = recent.map(w =>
    `- ${w.title} · ${w.locationName.split(',')[0]} · ${w.timeOfDay} · ${w.styles.join(', ')} · ${w.date.toISOString().slice(0, 10)}`
  ).join('\n');

  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    system: 'You write ONE short, sharp observation (1-2 sentences) about a photographer\'s recent walking habits, in a confident editorial voice — the kind of thing a sharp creative director would say in passing. Reference a specific real pattern from the data (a location, a time of day, a style) when one exists; if nothing stands out, just note something concrete about the most recent walk. Italicize exactly one phrase with *asterisks*. No greeting, no explanation, no quotation marks around the whole thing — output only the observation itself. Never invent details not present in the data.',
    messages: [{
      role: 'user',
      content: `Recent walks, most recent first:\n${history}`,
    }],
  });

  const text = result.content.find(b => b.type === 'text')?.text?.trim();
  if (!text) return;

  await prisma.user.update({
    where: { id: userId },
    data: { insightText: text, insightGeneratedAt: new Date() },
  });
}

async function markError(runId, message) {
  console.error(`[run:${runId}] failed: ${message}`);
  try {
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'error', errorMessage: message },
    });
  } catch (err) {
    console.error(`[run:${runId}] failed to persist error state:`, err);
  }
}

/**
 * Terminal failure: mark the run 'error' (unresumable) and notify the client.
 * `messages` is optional — when provided, it's persisted alongside the error
 * so the transcript up to the failure isn't lost.
 */
async function failRun(sse, runId, message, messages) {
  try {
    await prisma.agentRun.update({
      where: { id: runId },
      data: messages !== undefined
        ? { status: 'error', errorMessage: message, messages }
        : { status: 'error', errorMessage: message },
    });
    console.error(`[run:${runId}] failed: ${message}`);
  } catch (err) {
    console.error(`[run:${runId}] failed to persist error state:`, err);
  }
  sse.send('error', { message });
  sse.close();
}

/**
 * A failed Anthropic call that's plausibly transient (rate limit, server
 * overload, network blip) shouldn't brick the run the way a genuinely bad
 * request (invalid key, malformed call) should. For retryable errors, leave
 * the run resumable — the client can just retry the stream.
 */
async function handleAnthropicError(sse, runId, err, messagesSoFar) {
  if (err instanceof APIUserAbortError) {
    // We deliberately aborted this call (browser disconnected, or a fresh
    // connection preempted this loop) — not a real failure. Leave the run
    // exactly as it was before this call started so a reconnect resumes it.
    return;
  }

  const message = formatAnthropicError(err);
  console.error(`[run:${runId}] Anthropic call failed: ${message}`, err);

  if (sse.isClosed()) return; // client is gone — nothing to report, don't error the run

  if (isRetryableAnthropicError(err)) {
    await prisma.agentRun.updateMany({
      where: { id: runId, status: { in: ['active'] } },
      data:  { status: 'active', messages: messagesSoFar },
    });
    sse.send('error', { message, retryable: true });
    sse.close();
    return;
  }

  await failRun(sse, runId, message, messagesSoFar);
}

function isRetryableAnthropicError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (status === undefined) return true; // no HTTP response at all — connection-level failure
  return false;
}

function formatAnthropicError(err) {
  if (err?.status === 401) return 'Your Anthropic API key is invalid. Rotate it in Account.';
  if (err?.status === 429) return 'Anthropic rate limit hit — try again in a moment.';
  if (err?.status === 529) return 'Anthropic is briefly overloaded. Try again in a minute.';
  if (err?.status === 400) {
    const msg = err?.error?.error?.message || err.message;
    return `Anthropic rejected the request: ${msg}`;
  }
  if (typeof err?.status === 'number' && err.status >= 500) {
    return 'Anthropic had a temporary server error. Try again in a moment.';
  }
  if (err?.error?.error?.message) return err.error.error.message;
  return err?.message || 'Anthropic call failed';
}
