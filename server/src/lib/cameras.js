/**
 * Camera catalog used by Latitude.
 * Each entry: { id, type, label, lensSpec? }
 *
 * - type: 'compact' | 'mirrorless' | 'medium' | 'film'
 * - lensSpec only present for fixed-lens bodies (the value the agent will use)
 */
export const CAMERAS = [
  // Compact / fixed-lens
  { id: 'fuji-x100vi', type: 'compact', label: 'Fujifilm X100VI · 35mm f/2',     lensSpec: '35mm equiv. f/2' },
  { id: 'leica-q3',    type: 'compact', label: 'Leica Q3 · 28mm Summilux f/1.7', lensSpec: '28mm Summilux f/1.7' },
  { id: 'ricoh-gr3x',  type: 'compact', label: 'Ricoh GR IIIx · 40mm f/2.8',     lensSpec: '40mm equiv. f/2.8' },
  { id: 'sony-rx1r2',  type: 'compact', label: 'Sony RX1R II · 35mm Zeiss f/2',  lensSpec: '35mm Zeiss f/2' },

  // Mirrorless
  { id: 'sony-a7iv',   type: 'mirrorless', label: 'Sony A7 IV' },
  { id: 'fuji-xt5',    type: 'mirrorless', label: 'Fujifilm X-T5' },
  { id: 'canon-r5',    type: 'mirrorless', label: 'Canon EOS R5' },
  { id: 'nikon-z6iii', type: 'mirrorless', label: 'Nikon Z6 III' },
  { id: 'leica-sl3',   type: 'mirrorless', label: 'Leica SL3' },

  // Medium format — fixed-kit bodies; the two lenses shot most often for each
  { id: 'hassel-x2d2', type: 'medium', label: 'Hasselblad X2D II 100C',      lensSpec: '38mm f/2.5 V · 90mm f/2.5 V' },
  { id: 'fuji-gfx100', type: 'medium', label: 'Fujifilm GFX 100 II',         lensSpec: '63mm f/2.8 · 110mm f/2' },
  { id: 'hassel-907x', type: 'medium', label: 'Hasselblad 907X & CFV 100C',  lensSpec: '80mm f/2.4' },

  // Film — lensSpec left blank; the photographer types their own lens + stock
  { id: 'leica-m6',    type: 'film', label: 'Leica M6 (35mm)' },
  { id: 'mamiya-7ii',  type: 'film', label: 'Mamiya 7 II (medium format)' },
  { id: 'hassel-500',  type: 'film', label: 'Hasselblad 500C/M (medium format)' },
];

export const MIRRORLESS_LENSES = [
  { id: '35-1.4',   label: '35mm f/1.4' },
  { id: '50-1.8',   label: '50mm f/1.8' },
  { id: '85-1.8',   label: '85mm f/1.8' },
  { id: '24-70',    label: '24–70mm f/2.8' },
  { id: '70-200',   label: '70–200mm f/4' },
  { id: '16-35',    label: '16–35mm f/4' },
];

export const STYLE_OPTIONS = [
  'street', 'documentary', 'fineart', 'portrait', 'arch',
  'landscape', 'abstract', 'minimal', 'color', 'night',
];

export const TOD_OPTIONS = ['dawn', 'morning', 'midday', 'golden', 'blue', 'night'];

export const DURATIONS = [
  { id: '1h',  label: '1 hour — a short walk',     minutes: 60  },
  { id: '2h',  label: '2 hours — a half loop',     minutes: 120 },
  { id: '3h',  label: '3 hours — a proper walk',   minutes: 180 },
  { id: 'half',label: 'Half day — 4 to 6 hours',   minutes: 300 },
  { id: 'full',label: 'Full day — dawn to dusk',   minutes: 600 },
];

export function findCamera(id) {
  return CAMERAS.find(c => c.id === id) || null;
}
export function findDuration(id) {
  return DURATIONS.find(d => d.id === id) || null;
}
