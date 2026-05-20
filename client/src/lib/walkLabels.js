export const STYLE_LABELS = {
  street:      'Street',
  documentary: 'Documentary',
  fineart:     'Fine Art',
  portrait:    'Portrait',
  arch:        'Architecture',
  landscape:   'Landscape',
  abstract:    'Abstract',
  minimal:     'Minimalism',
  color:       'Color Study',
  night:       'Night',
};

export const TOD_LABELS = {
  dawn:    'Dawn',
  morning: 'Morning',
  midday:  'Midday',
  golden:  'Golden hour',
  blue:    'Blue hour',
  night:   'Night',
};

export function styleLabel(key) {
  return STYLE_LABELS[key] || key;
}
export function todLabel(key) {
  return TOD_LABELS[key] || key;
}

export function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  });
}
export function formatKm(meters) {
  return (meters / 1000).toFixed(1);
}
