/**
 * Props:
 *   steps:   [{ key, label }]
 *   current: key of current step (or null)
 *   onJump?: (key) => void
 */
export default function StepIndicator({ steps, current, onJump }) {
  const currentIdx = steps.findIndex(s => s.key === current);
  return (
    <nav
      className="steps"
      aria-label="Walk creation progress"
      style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
    >
      {steps.map((s, i) => {
        const isCurrent = i === currentIdx;
        const isDone = i < currentIdx;
        const isClickable = !!onJump && (isDone || isCurrent);
        const cls = ['step', isCurrent && 'is-current', isDone && 'is-done']
          .filter(Boolean).join(' ');
        const content = (
          <>
            <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
            <div className="step-label">{s.label}</div>
          </>
        );
        return isClickable ? (
          <button
            key={s.key}
            type="button"
            className={cls}
            onClick={() => onJump(s.key)}
            aria-current={isCurrent ? 'step' : undefined}
          >
            {content}
          </button>
        ) : (
          <div
            key={s.key}
            className={cls}
            style={{ cursor: 'default' }}
            aria-current={isCurrent ? 'step' : undefined}
          >
            {content}
          </div>
        );
      })}
    </nav>
  );
}
