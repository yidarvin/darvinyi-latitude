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
    try { res.end(); } catch {}
  }

  res.on('close', () => { closed = true; });

  return { send, heartbeat, close, isClosed: () => closed };
}
