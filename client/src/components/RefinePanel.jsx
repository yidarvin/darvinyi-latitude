import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentStream } from '../hooks/useAgentStream.js';
import { Turn, ReplyBox } from './AgentTranscript.jsx';
import { renderEmphasis } from '../lib/markdownLite.jsx';

const EXAMPLES = [
  'Swap a stop',
  'Make it shorter',
  'More architecture',
  'Different finish',
];

/**
 * Inline "talk to the agent again" panel on the Plan screen.
 * Re-opens the composed AgentRun, streams the agent's rework, and calls
 * onComposed() so the parent can reload the (now updated) walk.
 */
export default function RefinePanel({ runId, onComposed }) {
  const stream = useAgentStream(runId, { autoStart: false });
  const [text, setText] = useState('');
  const [reloadFailed, setReloadFailed] = useState(false);
  const lastComposed = useRef(null);

  // onComposed (Plan's reloadWalk) reports whether the refetch actually
  // succeeded — surface that honestly instead of always claiming "Updated."
  const applyReload = useCallback(async () => {
    const ok = await onComposed?.();
    setReloadFailed(ok === false);
  }, [onComposed]);

  useEffect(() => {
    if (stream.composed && stream.composed !== lastComposed.current) {
      lastComposed.current = stream.composed;
      applyReload();
    }
  }, [stream.composed, applyReload]);

  const busy    = stream.status === 'streaming' || stream.status === 'connecting';
  const canType = !busy && !stream.awaitingUser;
  const started = busy || stream.awaitingUser || stream.turns.length > 0 || stream.activeText;

  const submit = async () => {
    const note = text.trim();
    if (!note || busy) return;
    setText('');
    setReloadFailed(false);
    await stream.refine(note);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="refine">
      <div className="shotlist-title refine-title">Refine with the <em>agent</em></div>

      {started && (
        <div className="transcript refine-transcript" role="log" aria-live="polite" aria-relevant="additions">
          {stream.turns.map((t, i) => <Turn key={i} turn={t} />)}

          {stream.activeText && (
            <div className="turn">
              <div className="turn-who agent">Latitude · Agent</div>
              <div className="turn-msg">
                {renderEmphasis(stream.activeText)}
                <span className="cursor" />
              </div>
            </div>
          )}

          {stream.awaitingUser && (
            <ReplyBox
              question={stream.awaitingUser.question}
              onSubmit={stream.submitReply}
            />
          )}

          {busy && !stream.activeText && !stream.awaitingUser && (
            <div className="refine-status" role="status">Reworking the route…</div>
          )}

          {stream.composed && !busy && (
            <div className="turn">
              <div className="turn-who agent">Latitude · Agent</div>
              {reloadFailed ? (
                <div className="turn-msg error">
                  The route was updated, but reloading the plan failed.{' '}
                  <button type="button" className="refine-retry-link" onClick={applyReload}>Retry</button>
                </div>
              ) : (
                <div className="turn-msg" style={{ color: 'var(--accent)' }}>
                  <em>Updated.</em> The plan now reflects your note.
                </div>
              )}
            </div>
          )}

          {stream.error && (
            <div className="turn" role="alert">
              <div className="turn-who error">Error</div>
              <div className="turn-msg error">{stream.error}</div>
            </div>
          )}
        </div>
      )}

      {canType && (
        <div className="refine-input">
          {!started && (
            <p className="refine-hint">
              Don't like a stop, or want a different feel? Tell the agent —
              it edits <em>this</em> walk in place.
            </p>
          )}
          <div className="turn-input">
            <input
              type="text"
              aria-label="Refine note"
              placeholder="e.g. swap stop 4 for something quieter"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button onClick={submit} disabled={!text.trim()}>Refine →</button>
          </div>
          {!started && (
            <div className="refine-examples">
              {EXAMPLES.map(ex => (
                <button key={ex} className="refine-chip" onClick={() => setText(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
