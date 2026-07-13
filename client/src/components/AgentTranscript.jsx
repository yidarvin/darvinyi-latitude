import { useEffect, useId, useRef, useState } from 'react';
import { renderEmphasis } from '../lib/markdownLite.jsx';

export const TOOL_LABELS = {
  get_user_history:  'Loading folio',
  geocode_location:  'Geocoding',
  get_weather:       'Checking weather',
  compute_route:     'Computing route',
  web_search:        'Searching',
};

/**
 * A single transcript entry — agent text, a user reply, or a tool step.
 * Shared by the Dialogue screen and the Plan screen's refine panel.
 */
export function Turn({ turn }) {
  if (turn.kind === 'agent') {
    const text = turn.text.trim();
    if (!text) return null;
    return (
      <div className="turn">
        <div className="turn-who agent">Latitude · Agent</div>
        <div className="turn-msg">{renderEmphasis(text)}</div>
      </div>
    );
  }

  if (turn.kind === 'user') {
    return (
      <div className="turn user">
        <div className="turn-who user">You</div>
        <div className="turn-msg">{turn.text}</div>
      </div>
    );
  }

  if (turn.kind === 'tool') {
    return (
      <div className="turn">
        <div className="turn-tool">
          <span className="turn-who tool">Tool</span>
          <span className="tool-name">{TOOL_LABELS[turn.tool] || turn.tool}</span>
          <span className={`tool-status ${turn.error ? 'is-error' : (turn.doneAt ? 'is-done' : '')}`}>
            {turn.error ? `failed · ${turn.error}` : (turn.doneAt ? '✓' : 'running…')}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * The inline reply box shown when the agent asks a follow-up question
 * (request_user_input). Used both mid-dialogue and mid-refinement.
 */
export function ReplyBox({ question, onSubmit, placeholder = 'Type your answer…' }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const questionId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await onSubmit(text.trim());
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="turn">
      <div className="turn-who agent">Latitude · Agent</div>
      <div className="turn-msg" id={questionId} style={{ marginBottom: 8 }}>{renderEmphasis(question)}</div>
      <div className="turn-input">
        <input
          ref={inputRef}
          type="text"
          aria-labelledby={questionId}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        <button onClick={handleSubmit} disabled={submitting || !text.trim()}>
          {submitting ? '…' : 'Send →'}
        </button>
      </div>
    </div>
  );
}
