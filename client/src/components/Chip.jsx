export function Chip({ selected, children, onClick, role, ...rest }) {
  const cls = ['chip', selected && 'is-selected'].filter(Boolean).join(' ');
  const stateProps = role === 'radio'
    ? { role: 'radio', 'aria-checked': selected }
    : { 'aria-pressed': selected };
  return (
    <button type="button" className={cls} onClick={onClick} {...stateProps} {...rest}>
      {children}
    </button>
  );
}

/**
 * ChipGroup — manages selection state for a row of chips.
 *
 * Props:
 *   - options: [{ value, label }, ...]
 *   - value:   string | string[] depending on mode
 *   - onChange:(next) => void
 *   - mode:    'single' | 'multi' (default 'single')
 *   - label:   accessible name for the group (read by screen readers)
 */
export function ChipGroup({ options, value, onChange, mode = 'single', label }) {
  const isSelected = (v) =>
    mode === 'multi' ? (value || []).includes(v) : value === v;

  const handleClick = (v) => {
    if (mode === 'multi') {
      const set = new Set(value || []);
      set.has(v) ? set.delete(v) : set.add(v);
      onChange(Array.from(set));
    } else {
      onChange(v);
    }
  };

  return (
    <div
      className="chip-row"
      role={mode === 'single' ? 'radiogroup' : 'group'}
      aria-label={label}
    >
      {options.map((opt) => (
        <Chip
          key={opt.value}
          role={mode === 'single' ? 'radio' : undefined}
          selected={isSelected(opt.value)}
          onClick={() => handleClick(opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}
