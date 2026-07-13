/**
 * Tiny SSE helper. Wraps an Express response with `send(event, data)` and
 * `heartbeat()`. Caller is responsible for calling `close()`.
 */
export function createSSE(res) {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  res.flushHeaders();

  let closed = false;
  const closeListeners = [];

  function send(event, data) {
    if (closed) return;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      closed = true;
    }
  }

  function heartbeat() {
    if (closed) return;
    try { res.write(': heartbeat\n\n'); } catch { closed = true; }
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const cb of closeListeners) { try { cb(); } catch {} }
    try { res.end(); } catch {}
  }

  res.on('close', () => {
    const wasOpen = !closed;
    closed = true;
    if (wasOpen) { for (const cb of closeListeners) { try { cb(); } catch {} } }
  });

  // Register a callback fired exactly once, whenever this stream closes —
  // whether the client disconnected or we called close() ourselves. Lets a
  // caller (the agent loop) abort in-flight work the instant the connection
  // it's streaming to goes away, rather than only noticing at the next
  // natural checkpoint.
  function onClose(cb) {
    if (closed) { cb(); return; }
    closeListeners.push(cb);
  }

  return { send, heartbeat, close, isClosed: () => closed, onClose };
}
