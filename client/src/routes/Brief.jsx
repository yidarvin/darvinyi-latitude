import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as walksApi from '../api/walks.js';
import TopNav from '../components/TopNav.jsx';
import StepIndicator from '../components/StepIndicator.jsx';
import Button from '../components/Button.jsx';
import { Select } from '../components/Input.jsx';
import { ChipGroup } from '../components/Chip.jsx';

const WALK_STEPS = [
  { key: 'brief',    label: 'Brief' },
  { key: 'dialogue', label: 'Dialogue' },
  { key: 'plan',     label: 'The Plan' },
];

const CAMERA_GROUPS = [
  { type: 'compact',    label: '◇ Compact / fixed-lens' },
  { type: 'mirrorless', label: '◇ Mirrorless' },
  { type: 'medium',     label: '◇ Medium format' },
  { type: 'film',       label: '◇ Film' },
];

const CAMERAS = [
  { id: 'fuji-x100vi', type: 'compact',    label: 'Fujifilm X100VI · 35mm f/2',    lensSpec: '35mm equiv. f/2' },
  { id: 'leica-q3',    type: 'compact',    label: 'Leica Q3 · 28mm Summilux f/1.7', lensSpec: '28mm Summilux f/1.7' },
  { id: 'ricoh-gr3x',  type: 'compact',    label: 'Ricoh GR IIIx · 40mm f/2.8',    lensSpec: '40mm equiv. f/2.8' },
  { id: 'sony-rx1r2',  type: 'compact',    label: 'Sony RX1R II · 35mm Zeiss f/2', lensSpec: '35mm Zeiss f/2' },
  { id: 'sony-a7iv',   type: 'mirrorless', label: 'Sony A7 IV' },
  { id: 'fuji-xt5',    type: 'mirrorless', label: 'Fujifilm X-T5' },
  { id: 'canon-r5',    type: 'mirrorless', label: 'Canon EOS R5' },
  { id: 'nikon-z6iii', type: 'mirrorless', label: 'Nikon Z6 III' },
  { id: 'leica-sl3',   type: 'mirrorless', label: 'Leica SL3' },
  { id: 'hassel-x2d2', type: 'medium',     label: 'Hasselblad X2D II 100C' },
  { id: 'fuji-gfx100', type: 'medium',     label: 'Fujifilm GFX 100 II' },
  { id: 'hassel-907x', type: 'medium',     label: 'Hasselblad 907X & CFV 100C' },
  { id: 'leica-m6',    type: 'film',       label: 'Leica M6 (35mm)' },
  { id: 'mamiya-7ii',  type: 'film',       label: 'Mamiya 7 II (medium format)' },
  { id: 'hassel-500',  type: 'film',       label: 'Hasselblad 500C/M (medium format)' },
];

const MIRRORLESS_LENSES = [
  { id: '35-1.4',  label: '35mm f/1.4' },
  { id: '50-1.8',  label: '50mm f/1.8' },
  { id: '85-1.8',  label: '85mm f/1.8' },
  { id: '24-70',   label: '24–70mm f/2.8' },
  { id: '70-200',  label: '70–200mm f/4' },
  { id: '16-35',   label: '16–35mm f/4' },
];

const DURATIONS = [
  { id: '1h',   label: '1 hour — a short walk' },
  { id: '2h',   label: '2 hours — a half loop' },
  { id: '3h',   label: '3 hours — a proper walk' },
  { id: 'half', label: 'Half day — 4 to 6 hours' },
  { id: 'full', label: 'Full day — dawn to dusk' },
];

const TOD_OPTIONS = [
  { value: 'dawn',    label: '⏵ Dawn' },
  { value: 'morning', label: '⏵ Morning' },
  { value: 'midday',  label: '⏵ Midday' },
  { value: 'golden',  label: '⏵ Golden Hour' },
  { value: 'blue',    label: '⏵ Blue Hour' },
  { value: 'night',   label: '⏵ Night' },
];

const MOBILITY_OPTIONS = [
  { value: 'foot',    label: '⏚ On Foot' },
  { value: 'transit', label: '⎌ Public Transit' },
  { value: 'bike',    label: '⏃ Bicycle' },
  { value: 'ride',    label: '⎈ Car / Rideshare' },
];

const STYLE_OPTIONS = [
  { value: 'street',      label: 'Street' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'fineart',     label: 'Fine Art' },
  { value: 'portrait',    label: 'Portrait' },
  { value: 'arch',        label: 'Architecture' },
  { value: 'landscape',   label: 'Landscape' },
  { value: 'abstract',    label: 'Abstract' },
  { value: 'minimal',     label: 'Minimalism' },
  { value: 'color',       label: 'Color Study' },
  { value: 'night',       label: 'Night' },
];

const INITIAL = {
  locationName: '',
  durationId:   '3h',
  timeOfDay:    'morning',
  cameraId:     'fuji-x100vi',
  lensIds:      [],
  mobility:     ['foot', 'transit'],
  styles:       ['street', 'arch'],
  intent:       '',
};

export default function Brief() {
  const [form, setForm]             = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [locating, setLocating]     = useState(false);
  const navigate = useNavigate();

  const camera = useMemo(
    () => CAMERAS.find(c => c.id === form.cameraId) || CAMERAS[0],
    [form.cameraId]
  );

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const useMyLocation = () => {
    setLocating(true);
    setTimeout(() => {
      update('locationName', 'San Francisco, CA');
      setLocating(false);
    }, 500);
  };

  const isValid =
    form.locationName.trim().length >= 2 &&
    form.mobility.length >= 1 &&
    form.styles.length >= 1 &&
    (camera.type !== 'mirrorless' || form.lensIds.length >= 1);

  const submit = async () => {
    setError(null);
    if (!isValid) {
      setError('Fill in location, pick at least one mobility option, style, and (for mirrorless) at least one lens.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await walksApi.submitBriefDraft({
        locationName: form.locationName.trim(),
        durationId:   form.durationId,
        timeOfDay:    form.timeOfDay,
        cameraId:     form.cameraId,
        lensIds:      camera.type === 'mirrorless' ? form.lensIds : [],
        mobility:     form.mobility,
        styles:       form.styles,
        intent:       form.intent.trim(),
      });
      navigate(`/dialogue/${res.agentRunId}`);
    } catch (err) {
      setError(err.message || 'Failed to submit brief');
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <TopNav />

      <StepIndicator steps={WALK_STEPS} current="brief" />

      <div className="brief-head">
        <div>
          <div className="kicker">01 · The Brief</div>
          <h2 className="display-sm">Compose today's <em>walk.</em></h2>
        </div>
        <div className="brief-head-meta">
          Draft · <b>unsigned</b><br />
          Sent to agent on submit
        </div>
      </div>

      <div className="brief-grid">

        <div className="field">
          <label className="form-label">Location</label>
          <div className="field-row">
            <input
              className="form-input"
              type="text"
              placeholder="Neighborhood, city"
              value={form.locationName}
              onChange={(e) => update('locationName', e.target.value)}
              disabled={submitting}
            />
            <span className="field-aux" onClick={!locating ? useMyLocation : undefined}>
              {locating ? 'Locating…' : '⌖ Use mine'}
            </span>
          </div>
        </div>

        <Select
          label="Time available"
          value={form.durationId}
          onChange={(e) => update('durationId', e.target.value)}
          disabled={submitting}
        >
          {DURATIONS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>

        <div className="field field-full">
          <label className="form-label">Time of day</label>
          <ChipGroup
            options={TOD_OPTIONS}
            value={form.timeOfDay}
            onChange={(v) => update('timeOfDay', v)}
            mode="single"
          />
        </div>

        <Select
          label="Camera body"
          value={form.cameraId}
          onChange={(e) => update('cameraId', e.target.value)}
          disabled={submitting}
        >
          {CAMERA_GROUPS.map(g => (
            <optgroup key={g.type} label={g.label}>
              {CAMERAS.filter(c => c.type === g.type).map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </Select>

        <div className="field">
          {camera.type === 'mirrorless' ? (
            <>
              <label className="form-label">
                Lenses <span className="form-label-aux">— select all bringing</span>
              </label>
              <ChipGroup
                options={MIRRORLESS_LENSES.map(l => ({ value: l.id, label: l.label }))}
                value={form.lensIds}
                onChange={(v) => update('lensIds', v)}
                mode="multi"
              />
            </>
          ) : camera.type === 'film' ? (
            <>
              <label className="form-label">Lens &amp; film</label>
              <div className="lens-fixed-display">50mm Summicron · Tri-X 400</div>
            </>
          ) : camera.type === 'medium' ? (
            <>
              <label className="form-label">Lens</label>
              <div className="lens-fixed-display">
                {camera.id === 'hassel-x2d2' && '38mm f/2.5 V · 90mm f/2.5 V'}
                {camera.id === 'fuji-gfx100' && '63mm f/2.8 · 110mm f/2'}
                {camera.id === 'hassel-907x' && '80mm f/2.4'}
              </div>
            </>
          ) : (
            <>
              <label className="form-label">
                Lens <span className="form-label-aux">— fixed to body</span>
              </label>
              <div className="lens-fixed-display">{camera.lensSpec}</div>
            </>
          )}
        </div>

        <div className="field field-full">
          <label className="form-label">
            Mobility <span className="form-label-aux">— multi-select</span>
          </label>
          <ChipGroup
            options={MOBILITY_OPTIONS}
            value={form.mobility}
            onChange={(v) => update('mobility', v)}
            mode="multi"
          />
        </div>

        <div className="field field-full">
          <label className="form-label">
            Photography styles you're open to <span className="form-label-aux">— multi-select</span>
          </label>
          <ChipGroup
            options={STYLE_OPTIONS}
            value={form.styles}
            onChange={(v) => update('styles', v)}
            mode="multi"
          />
        </div>

        <div className="field field-full">
          <label className="form-label">
            Intent <span className="form-label-aux">— optional, free text</span>
          </label>
          <textarea
            className="form-input"
            rows={2}
            placeholder="A theme, a deadline, a mood…"
            value={form.intent}
            onChange={(e) => update('intent', e.target.value)}
            disabled={submitting}
          />
        </div>

      </div>

      <div className="brief-note">
        <div className="brief-note-label">⏵ Latitude</div>
        <div className="brief-note-text">
          I'll read this against your last walks before composing a route.
          Expect 2&ndash;3 follow-up questions &mdash; <em>only the ones worth asking.</em>
        </div>
      </div>

      {error && (
        <div className="form-error" style={{ marginBottom: 24 }}>{error}</div>
      )}

      <Button onClick={submit} disabled={submitting || !isValid} arrow={!submitting}>
        {submitting ? 'Sending…' : 'Send to agent'}
      </Button>
    </div>
  );
}
