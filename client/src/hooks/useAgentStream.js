import { useState, useEffect, useRef, useCallback } from 'react';
import * as agentRunsApi from '../api/agentRuns.js';
import { apiUrl } from '../api/client.js';

const MAX_RECONNECT_ATTEMPTS = 4;
const RECONNECT_DELAY_MS = 2000;

/**
 * Drive the dialogue UI from the agent SSE stream.
 *
 * Returns:
 *   - turns:         ordered conversation entries (assistant/user/tool)
 *   - activeText:    text the agent is currently streaming (not yet committed to turns)
 *   - awaitingUser:  { question } when paused for input
 *   - composed:      { walkId } when the agent finalized
 *   - error:         string or null
 *   - status:        'connecting' | 'streaming' | 'reconnecting' | 'awaiting' | 'composed' | 'error' | 'idle'
 *   - submitReply:   async (text) => void
 *   - refine:        async (text) => void   (re-open a composed run with a note)
 *   - start:         (hydratedTurns?) => void  (manually open the stream — see autoStart below)
 *
 * Options:
 *   - autoStart (default true): open the stream on mount. Pass false when the
 *     caller wants to gate opening the stream on something else first (e.g.
 *     Dialogue waits for the run's status to confirm it's actually resumable,
 *     and seeds prior transcript via start(hydratedTurns) at the same time),
 *     or for a run that's already composed (the Plan screen's refine panel).
 *
 * Connection lifecycle:
 *   - Mounts → opens EventSource (unless autoStart is false — call start() instead)
 *   - runId changing → full reset (turns/error/composed/awaitingUser all clear)
 *     and, if autoStart, reconnects — this is a different run, not a resume
 *   - A transient drop (no server-sent error payload) → closes the dead
 *     connection itself (rather than trusting the browser's silent native
 *     retry) and reconnects with visible 'reconnecting' status, up to
 *     MAX_RECONNECT_ATTEMPTS — turns/composed/error are left untouched
 *   - On awaiting_user → closes, sets awaitingUser
 *   - submitReply → POSTs the reply, then reconnects
 *   - On composed → sets composed, closes
 *   - refine → POSTs the note, then reconnects (composed cleared)
 *   - On turn_end → closes, status 'idle' (refinement reply with no recompose)
 */
export function useAgentStream(runId, { autoStart = true } = {}) {
  const [turns,        setTurns]        = useState([]);
  const [activeText,   setActiveText]   = useState('');
  const [awaitingUser, setAwaitingUser] = useState(null);
  const [composed,     setComposed]     = useState(null);
  const [error,        setError]        = useState(null);
  const [status,       setStatus]       = useState(autoStart ? 'connecting' : 'idle');

  const sourceRef = useRef(null);
  const activeTextRef = useRef('');
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  const closeSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Establishes (or re-establishes) the EventSource. Does NOT touch
  // turns/composed/error — a reconnect should resume in place, not wipe
  // what's already on screen. Callers that want a clean slate (a genuine
  // run switch, or start()) reset that state themselves before calling this.
  const connect = useCallback(() => {
    if (!runId) return;
    closeSource();
    clearReconnectTimer();
    setStatus('streaming');
    setActiveText('');
    activeTextRef.current = '';

    const src = new EventSource(apiUrl(`/agent-runs/${runId}/stream`), { withCredentials: true });
    sourceRef.current = src;

    function flushActiveText() {
      if (activeTextRef.current.trim().length > 0) {
        const text = activeTextRef.current;
        setTurns(prev => [...prev, { kind: 'agent', text }]);
      }
      activeTextRef.current = '';
      setActiveText('');
    }

    src.addEventListener('open', () => {
      reconnectAttemptsRef.current = 0;
    });

    src.addEventListener('message_delta', (e) => {
      const { delta } = JSON.parse(e.data);
      activeTextRef.current += delta;
      setActiveText(activeTextRef.current);
    });

    src.addEventListener('tool_start', (e) => {
      const data = JSON.parse(e.data);
      flushActiveText();
      setTurns(prev => [...prev, { kind: 'tool', tool: data.tool, input: data.input, doneAt: null }]);
    });

    src.addEventListener('tool_done', (e) => {
      const data = JSON.parse(e.data);
      setTurns(prev => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].kind === 'tool' && next[i].tool === data.tool && next[i].doneAt === null) {
            next[i] = { ...next[i], doneAt: Date.now(), error: data.error || null };
            break;
          }
        }
        return next;
      });
    });

    src.addEventListener('awaiting_user', (e) => {
      const { question } = JSON.parse(e.data);
      flushActiveText();
      setAwaitingUser({ question });
      setStatus('awaiting');
      closeSource();
    });

    src.addEventListener('composed', (e) => {
      const { walkId } = JSON.parse(e.data);
      flushActiveText();
      setComposed({ walkId });
      setStatus('composed');
      closeSource();
    });

    src.addEventListener('turn_end', () => {
      // Refinement: agent replied without recomposing. Walk is unchanged.
      flushActiveText();
      setStatus('idle');
      closeSource();
    });

    src.addEventListener('error', (e) => {
      // A server-sent error event always carries a JSON payload — a
      // definite, terminal outcome the server wants shown as-is.
      if (e.data) {
        try {
          const { message } = JSON.parse(e.data);
          setError(message || 'Agent error');
          setStatus('error');
          closeSource();
          return;
        } catch {}
      }

      // No parseable payload — a transport-level failure (network blip,
      // proxy timeout, an idle SSE connection getting killed). Don't lean on
      // the browser's silent native retry: it gives no visible feedback and
      // its timing is opaque. Close it ourselves and reconnect on our own
      // schedule instead, so the user sees "reconnecting" rather than a
      // dialogue that's quietly stalled.
      closeSource();
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        setStatus('reconnecting');
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      } else {
        setError('Connection lost. Check your network and try again.');
        setStatus('error');
      }
    });
  }, [runId, closeSource, clearReconnectTimer]);

  // Full reset + connect — a genuine (re)start, not a resume. `hydratedTurns`
  // seeds the transcript (e.g. from the server's derived history) so a
  // manual start after a page load shows prior context instead of blank.
  const start = useCallback((hydratedTurns) => {
    reconnectAttemptsRef.current = 0;
    setTurns(Array.isArray(hydratedTurns) ? hydratedTurns : []);
    setError(null);
    setComposed(null);
    setAwaitingUser(null);
    connect();
  }, [connect]);

  useEffect(() => {
    if (autoStart) start();
    return () => { closeSource(); clearReconnectTimer(); };
    // Runs again only when runId itself changes — a real run switch, which
    // is exactly when the full reset in start() is wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const submitReply = useCallback(async (replyText) => {
    if (!awaitingUser) return;
    setTurns(prev => [...prev, { kind: 'user', text: replyText }]);
    setAwaitingUser(null);
    setStatus('streaming');
    try {
      await agentRunsApi.submitReply(runId, replyText);
      connect();
    } catch (err) {
      setError(err.message || 'Failed to submit reply');
      setStatus('error');
    }
  }, [runId, awaitingUser, connect]);

  const refine = useCallback(async (note) => {
    setTurns(prev => [...prev, { kind: 'user', text: note }]);
    setComposed(null);
    setError(null);
    setAwaitingUser(null);
    setStatus('streaming');
    try {
      await agentRunsApi.refineRun(runId, note);
      connect();
    } catch (err) {
      setError(err.message || 'Failed to start refinement');
      setStatus('error');
    }
  }, [runId, connect]);

  return {
    turns,
    activeText,
    awaitingUser,
    composed,
    error,
    status,
    submitReply,
    refine,
    start,
  };
}
