import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as walksApi from '../api/walks.js';
import { get } from '../api/client.js';
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
  { id: 'hassel-x2d2', type: 'medium',     label: 'Hasselblad X2D II 100C',      lensSpec: '38mm f/2.5 V · 90mm f/2.5 V' },
  { id: 'fuji-gfx100', type: 'medium',     label: 'Fujifilm GFX 100 II',         lensSpec: '63mm f/2.8 · 110mm f/2' },
  { id: 'hassel-907x', type: 'medium',     label: 'Hasselblad 907X & CFV 100C',  lensSpec: '80mm f/2.4' },
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

const ROUTE_SHAPE_OPTIONS = [
  { value: 'line', label: '→ One way — point to point' },
  { value: 'loop', label: '↻ Round trip — start & finish together' },
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
  lensText:     '',
  routeShape:   'line',
  styles:       ['street', 'arch'],
  intent:       '',
};

export default function Brief() {
  const [form, setForm]             = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [locating, setLocating]     = useState(false);
  const navigate = useNavigate();
  const firstInputRef = useRef(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  const camera = useMemo(
    () => CAMERAS.find(c => c.id === form.cameraId) || CAMERAS[0],
    [form.cameraId]
  );

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const useMyLocation = async () => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation isn\'t supported in this browser.');
      return;
    }
    setLocating(true);
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 8000,
          maximumAge: 60_000,
          enableHighAccuracy: false,
        });
      });
      const { latitude, longitude } = pos.coords;
      const { name } = await get(`/util/reverse-geocode?lat=${latitude}&lng=${longitude}`);
      update('locationName', name);
    } catch (err) {
      if (err.code === 1) setError('Location permission denied.');
      else if (err.code === 3) setError('Location request timed out.');
      else setError(err.message || 'Could not determine your location.');
    } finally {
      setLocating(false);
    }
  };

  // Computed live (not just on submit attempt) — the submit button stays
  // disabled while any of these are unmet, so this doubles as the only
  // place that explains *why*, right next to the button.
  const missingRequirements = useMemo(() => {
    const missing = [];
    if (form.locationName.trim().length < 2) missing.push('a location');
    if (form.styles.length === 0) missing.push('at least one style');
    if (camera.type === 'mirrorless' && form.lensIds.length === 0) missing.push('at least one lens for your mirrorless body');
    if (camera.type === 'film' && form.lensText.trim().length === 0) missing.push('your lens & film stock');
    return missing;
  }, [form.locationName, form.styles, form.lensIds, form.lensText, camera.type]);

  const isValid = missingRequirements.length === 0;

  const submit = async () => {
    if (!isValid) return; // button is disabled in this state — defensive only
    setError(null);
    setSubmitting(true);
    try {
      const res = await walksApi.submitBriefDraft({
        locationName: form.locationName.trim(),
        durationId:   form.durationId,
        timeOfDay:    form.timeOfDay,
        cameraId:     form.cameraId,
        lensIds:      camera.type === 'mirrorless' ? form.lensIds : [],
        lensText:     camera.type === 'film' ? form.lensText.trim() : '',
        styles:       form.styles,
        roundTrip:    form.routeShape === 'loop',
        intent:       form.intent.trim(),
        // The user's own local calendar date — .toISOString() is always UTC,
        // which tells an evening photographer it's already tomorrow. Sent so
        // the agent's "today" (and default weather lookups) match the
        // photographer's actual day, not the server's.
        localDate:    new Date().toLocaleDateString('en-CA'),
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

      <main>
      <div className="brief-head">
        <div>
          <div className="kicker">01 · The Brief</div>
          <h1 className="display-sm">Compose today's <em>walk.</em></h1>
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
              ref={firstInputRef}
              className="form-input"
              type="text"
              placeholder="Neighborhood, city"
              value={form.locationName}
              onChange={(e) => update('locationName', e.target.value)}
              disabled={submitting}
            />
            <button
              type="button"
              className="field-aux"
              onClick={useMyLocation}
              disabled={locating}
            >
              {locating ? 'Locating…' : '⌖ Use mine'}
            </button>
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
            label="Time of day"
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
                label="Lenses"
              />
            </>
          ) : camera.type === 'film' ? (
            <>
              <label className="form-label">
                Lens &amp; film <span className="form-label-aux">— what you're bringing</span>
              </label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. 50mm Summicron · Tri-X 400"
                value={form.lensText}
                onChange={(e) => update('lensText', e.target.value)}
                disabled={submitting}
              />
            </>
          ) : camera.type === 'medium' ? (
            <>
              <label className="form-label">Lens</label>
              <div className="lens-fixed-display">{camera.lensSpec}</div>
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
            Route shape <span className="form-label-aux">— how the walk is laid out</span>
          </label>
          <ChipGroup
            options={ROUTE_SHAPE_OPTIONS}
            value={form.routeShape}
            onChange={(v) => update('routeShape', v)}
            mode="single"
            label="Route shape"
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
            label="Photography styles you're open to"
          />
        </div>

        <div className="field field-full">
          <label className="form-label">
            Intent <span className="form-label-aux">— optional, free text</span>
          </label>
          <textarea
            className="form-input"
            rows={2}
            placeholder="A theme, a deadline, a mood, a note about taking transit between stops…"
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
          Expect 2&ndash;3 follow-up questions &mdash; <em>only the ones worth asking.</em>{' '}
          Every walk plans on foot &mdash; mention transit in Intent if you're open to it between stops.
          Routes cost roughly $0.10&ndash;0.30 in Anthropic usage on your own key.
        </div>
      </div>

      {error && (
        <div className="form-error" style={{ marginBottom: 24 }}>{error}</div>
      )}

      {!isValid && !submitting && (
        <div className="form-hint" style={{ marginBottom: 16 }}>
          Still need: {missingRequirements.join(', ')}.
        </div>
      )}

      <Button onClick={submit} disabled={submitting || !isValid} arrow={!submitting}>
        {submitting ? 'Sending…' : 'Send to agent'}
      </Button>
      </main>
    </div>
  );
}
