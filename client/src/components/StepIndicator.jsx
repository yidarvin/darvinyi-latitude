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
      style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
    >
      {steps.map((s, i) => {
        const isCurrent = i === currentIdx;
        const isDone = i < currentIdx;
        const cls = ['step', isCurrent && 'is-current', isDone && 'is-done']
          .filter(Boolean).join(' ');
        return (
          <div
            key={s.key}
            className={cls}
            onClick={onJump && (i < currentIdx || isCurrent) ? () => onJump(s.key) : undefined}
            style={{ cursor: onJump && (i < currentIdx || isCurrent) ? 'pointer' : 'default' }}
          >
            <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
            <div className="step-label">{s.label}</div>
          </div>
        );
      })}
    </nav>
  );
}
