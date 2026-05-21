import { useState, useEffect, useRef, useCallback } from 'react';
import * as agentRunsApi from '../api/agentRuns.js';

/**
 * Drive the dialogue UI from the agent SSE stream.
 *
 * Returns:
 *   - turns:         ordered conversation entries (assistant/user/tool)
 *   - activeText:    text the agent is currently streaming (not yet committed to turns)
 *   - awaitingUser:  { question } when paused for input
 *   - composed:      { walkId } when the agent finalized
 *   - error:         string or null
 *   - status:        'connecting' | 'streaming' | 'awaiting' | 'composed' | 'error' | 'idle'
 *   - submitReply:   async (text) => void
 *
 * Connection lifecycle:
 *   - Mounts → opens EventSource
 *   - On awaiting_user → closes, sets awaitingUser
 *   - submitReply → POSTs the reply, then re-opens EventSource
 *   - On composed → sets composed, closes, never re-opens
 */
export function useAgentStream(runId) {
  const [turns,        setTurns]        = useState([]);
  const [activeText,   setActiveText]   = useState('');
  const [awaitingUser, setAwaitingUser] = useState(null);
  const [composed,     setComposed]     = useState(null);
  const [error,        setError]        = useState(null);
  const [status,       setStatus]       = useState('connecting');

  const sourceRef = useRef(null);
  const activeTextRef = useRef('');

  const close = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const openStream = useCallback(() => {
    if (!runId) return;
    close();
    setStatus('streaming');
    setActiveText('');
    activeTextRef.current = '';

    const src = new EventSource(`/api/agent-runs/${runId}/stream`, { withCredentials: true });
    sourceRef.current = src;

    function flushActiveText() {
      if (activeTextRef.current.trim().length > 0) {
        const text = activeTextRef.current;
        setTurns(prev => [...prev, { kind: 'agent', text }]);
      }
      activeTextRef.current = '';
      setActiveText('');
    }

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
      close();
    });

    src.addEventListener('composed', (e) => {
      const { walkId } = JSON.parse(e.data);
      flushActiveText();
      setComposed({ walkId });
      setStatus('composed');
      close();
    });

    src.addEventListener('error', (e) => {
      if (e.data) {
        try {
          const { message } = JSON.parse(e.data);
          setError(message || 'Agent error');
          setStatus('error');
          close();
          return;
        } catch {}
      }
      if (src.readyState === EventSource.CLOSED) {
        setError('Connection lost');
        setStatus('error');
        close();
      }
    });
  }, [runId, close]);

  useEffect(() => {
    openStream();
    return () => close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const submitReply = useCallback(async (replyText) => {
    if (!awaitingUser) return;
    setTurns(prev => [...prev, { kind: 'user', text: replyText }]);
    setAwaitingUser(null);
    setStatus('streaming');
    try {
      await agentRunsApi.submitReply(runId, replyText);
      openStream();
    } catch (err) {
      setError(err.message || 'Failed to submit reply');
      setStatus('error');
    }
  }, [runId, awaitingUser, openStream]);

  return {
    turns,
    activeText,
    awaitingUser,
    composed,
    error,
    status,
    submitReply,
  };
}
