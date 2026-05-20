export function Chip({ selected, children, onClick, ...rest }) {
  const cls = ['chip', selected && 'is-selected'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} {...rest}>
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
 */
export function ChipGroup({ options, value, onChange, mode = 'single' }) {
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
    <div className="chip-row" role="group">
      {options.map((opt) => (
        <Chip
          key={opt.value}
          selected={isSelected(opt.value)}
          onClick={() => handleClick(opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}
