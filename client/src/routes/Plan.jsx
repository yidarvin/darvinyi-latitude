import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import polyline from '@mapbox/polyline';
import TopNav from '../components/TopNav.jsx';
import StepIndicator from '../components/StepIndicator.jsx';
import Button from '../components/Button.jsx';
import LoadingDot from '../components/LoadingDot.jsx';
import { SkeletonLine, SkeletonBlock } from '../components/Skeleton.jsx';
import * as walksApi from '../api/walks.js';
import { makeStopIcon } from '../lib/mapMarkers.js';
import { renderEmphasis } from '../lib/markdownLite.jsx';

const WALK_STEPS = [
  { key: 'brief',    label: 'Brief' },
  { key: 'dialogue', label: 'Dialogue' },
  { key: 'plan',     label: 'The Plan' },
];

const CARTODB_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTODB_ATTR  = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function Plan() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [walk, setWalk]       = useState(null);
  const [error, setError]     = useState(null);
  const [activeStop, setActiveStop] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await walksApi.getWalk(id);
        if (!cancelled) setWalk(res.walk);
      } catch (err) {
        if (!cancelled) setError(err.status === 404 ? 'Walk not found' : (err.message || 'Failed to load walk'));
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const walkingPath = useMemo(() => {
    if (!walk?.walkingPolyline) return null;
    try { return polyline.decode(walk.walkingPolyline); } catch { return null; }
  }, [walk?.walkingPolyline]);

  const transitPath = useMemo(() => {
    if (!walk?.transitPolyline) return null;
    try { return polyline.decode(walk.transitPolyline); } catch { return null; }
  }, [walk?.transitPolyline]);

  if (error) {
    return (
      <div className="app">
        <TopNav />
        <div style={{ padding: 32, textAlign: 'center' }}>
          <h2 className="display-sm">Walk <em>not found.</em></h2>
          <p className="lede" style={{ margin: '12px auto 24px' }}>
            This walk may have been deleted, or doesn't belong to your account.
          </p>
          <Button variant="ghost" onClick={() => navigate('/folio')}>← Back to folio</Button>
        </div>
      </div>
    );
  }

  if (!walk) {
    return (
      <div className="app">
        <TopNav />
        <div className="plan-head">
          <div>
            <SkeletonLine width={140} height={11} style={{ marginBottom: 14 }} />
            <SkeletonLine width={360} height={36} />
          </div>
        </div>
        <div className="plan-wrap">
          <SkeletonBlock height={720} />
          <div>
            <SkeletonLine width="80%" height={32} style={{ marginBottom: 14 }} />
            <SkeletonLine width="50%" height={11} style={{ marginBottom: 24 }} />
            <SkeletonBlock height={80} style={{ marginBottom: 28 }} />
            <SkeletonBlock height={200} style={{ marginBottom: 28 }} />
            <SkeletonLine width="40%" height={22} style={{ marginBottom: 18 }} />
            {[0,1,2,3].map(i => (
              <SkeletonLine key={i} width="100%" height={48} style={{ marginBottom: 10 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isJustComposed = isWithinHours(walk.composedAt, 1);
  const composedDateLabel = formatComposedLabel(walk.composedAt);

  return (
    <div className="app">
      <TopNav />
      <StepIndicator
        steps={WALK_STEPS}
        current="plan"
        onJump={(k) => k === 'brief' && navigate('/brief')}
      />

      <div className="plan-head">
        <div>
          <div className="kicker">03 · The Plan</div>
          <h1 className="display-sm">{renderEmphasis(emphasizeFirstNoun(walk.title))}</h1>
        </div>
        <div className="plan-stamp">
          {isJustComposed ? 'Just composed' : composedDateLabel}
        </div>
      </div>

      <div className="plan-wrap">

        {/* ─── Map ─── */}
        <div className="plan-map">
          <MapContainer
            center={[walk.centerLat, walk.centerLng]}
            zoom={14}
            scrollWheelZoom={true}
            zoomControl={true}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url={CARTODB_TILES} attribution={CARTODB_ATTR} />

            {walkingPath && (
              <Polyline
                positions={walkingPath}
                pathOptions={{ color: '#2dd4bf', weight: 3, opacity: 0.95 }}
              />
            )}
            {transitPath && (
              <Polyline
                positions={transitPath}
                pathOptions={{ color: '#2dd4bf', weight: 2, opacity: 0.55, dashArray: '6 8' }}
              />
            )}

            {walk.stops.map((s) => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={makeStopIcon(s.ordinal, activeStop === s.id)}
                eventHandlers={{ click: () => setActiveStop(s.id) }}
              />
            ))}

            <PanController activeStop={activeStop} stops={walk.stops} />
          </MapContainer>
        </div>

        {/* ─── Project sidebar ─── */}
        <div className="plan-side">

          <div className="project-head">
            <div className="project-subtitle">{walk.subtitle}</div>
          </div>

          <div className="project-brief">{renderEmphasis(walk.brief)}</div>

          {walk.conditions && (
            <div className="conditions">
              {walk.conditions.light && (
                <div className="conditions-row">
                  <div className="conditions-label">Light</div>
                  <div className="conditions-text">{renderEmphasis(walk.conditions.light)}</div>
                </div>
              )}
              {walk.conditions.weather && (
                <div className="conditions-row">
                  <div className="conditions-label">Weather</div>
                  <div className="conditions-text">{renderEmphasis(walk.conditions.weather)}</div>
                </div>
              )}
              {walk.conditions.camera_notes && (
                <div className="conditions-row">
                  <div className="conditions-label">Camera</div>
                  <div className="conditions-text">{renderEmphasis(walk.conditions.camera_notes)}</div>
                </div>
              )}
              {walk.conditions.afterward && (
                <div className="conditions-row">
                  <div className="conditions-label">Afterward</div>
                  <div className="conditions-text">{renderEmphasis(walk.conditions.afterward)}</div>
                </div>
              )}
            </div>
          )}

          <div className="shotlist-title">The <em>shotlist</em></div>

          <ol className="shotlist">
            {walk.stops.map((s) => (
              <li
                key={s.id}
                className={`shotlist-item ${activeStop === s.id ? 'is-active' : ''}`}
                onClick={() => setActiveStop(s.id)}
              >
                <div className="shotlist-num">{String(s.ordinal).padStart(2, '0')}</div>
                <div className="shotlist-body">
                  <div className="shotlist-name">{s.name}</div>
                  <div className="shotlist-brief">{renderEmphasis(s.brief)}</div>
                </div>
                <div className="shotlist-meta">
                  <b>{s.arrivalTime}</b><br />
                  {s.durationMin} min
                </div>
              </li>
            ))}
          </ol>

          <div className="plan-actions">
            <Button variant="ghost" onClick={() => navigate('/folio')}>← Back to folio</Button>
            <Button onClick={() => navigate('/brief')} arrow>Plan another</Button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────
// Pan-to-stop child component (lives inside MapContainer)
// ──────────────────────────────────────────────────
function PanController({ activeStop, stops }) {
  const map = useMap();
  useEffect(() => {
    if (!activeStop) return;
    const s = stops.find(x => x.id === activeStop);
    if (s) map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [activeStop, stops, map]);
  return null;
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────
function isWithinHours(iso, hours) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < hours * 60 * 60 * 1000;
}
function formatComposedLabel(iso) {
  if (!iso) return 'Past walk';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Composed today';
  if (days === 1) return 'Composed yesterday';
  if (days < 7)   return `Composed ${days} days ago`;
  if (days < 30)  return `Composed ${Math.floor(days / 7)} weeks ago`;
  return `Composed ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function emphasizeFirstNoun(title) {
  const words = title.split(' ');
  if (words.length < 2) return title;
  return [...words.slice(0, -1), `*${words[words.length - 1]}*`].join(' ');
}
