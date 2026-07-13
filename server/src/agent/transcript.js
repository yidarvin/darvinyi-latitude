/**
 * Turn a raw Anthropic message history (AgentRun.messages) into the
 * lightweight `turns` shape the client renders (see
 * client/src/components/AgentTranscript.jsx). Used to hydrate the Dialogue
 * screen with prior context on a fresh page load / refresh, since the live
 * SSE stream only carries events going forward from when it opens.
 *
 * This is a best-effort reconstruction, not a byte-for-byte replay: text
 * spread across multiple content blocks in one assistant turn renders as
 * multiple shorter turns here, where the live stream would show it as one
 * continuous message. Good enough for "what has the agent said so far",
 * not meant to be pixel-identical to the live experience.
 */
export function deriveTranscript(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const turns = [];
  const toolNameById = new Map();
  let sawFirstUserMessage = false;

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          turns.push({ kind: 'agent', text: block.text.trim() });
        } else if (block.type === 'tool_use') {
          toolNameById.set(block.id, block.name);
          // request_user_input / compose_walk / web_search all render via
          // their own dedicated UI (ReplyBox, the composed banner, or
          // nothing) — only "working tool" steps get a tool-row turn.
          if (!['request_user_input', 'compose_walk', 'web_search'].includes(block.name)) {
            turns.push({ kind: 'tool', tool: block.name, input: block.input, doneAt: 1, error: null });
          }
        }
      }
    } else if (msg.role === 'user') {
      if (!sawFirstUserMessage) {
        // The very first user message is the raw brief dump — never shown
        // as a chat turn, even live.
        sawFirstUserMessage = true;
        continue;
      }
      for (const block of msg.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          turns.push({ kind: 'user', text: block.text.trim() });
        } else if (block.type === 'tool_result') {
          // Only a reply to request_user_input is meaningful conversation —
          // every other tool's result is already reflected by that tool's
          // 'done' turn above; re-showing the raw payload would be noise.
          if (toolNameById.get(block.tool_use_id) === 'request_user_input' && typeof block.content === 'string') {
            turns.push({ kind: 'user', text: block.content });
          }
        }
      }
    }
  }

  return turns;
}
