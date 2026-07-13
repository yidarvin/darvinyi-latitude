import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import polyline from '@mapbox/polyline';
import TopNav from '../components/TopNav.jsx';
import StepIndicator from '../components/StepIndicator.jsx';
import Button from '../components/Button.jsx';
import { SkeletonLine, SkeletonBlock } from '../components/Skeleton.jsx';
import RefinePanel from '../components/RefinePanel.jsx';
import * as walksApi from '../api/walks.js';
import { makeStopIcon } from '../lib/mapMarkers.js';
import { renderEmphasis } from '../lib/markdownLite.jsx';
import { downloadGpx, mapsLink } from '../lib/gpx.js';

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
  const [error, setError]     = useState(null); // { notFound: boolean, message: string }
  const [activeStop, setActiveStop] = useState(null);
  const [markingWalked, setMarkingWalked] = useState(false);

  const loadWalk = useCallback(async (signal) => {
    try {
      const res = await walksApi.getWalk(id);
      if (signal?.cancelled) return;
      setWalk(res.walk);
      setError(null);
    } catch (err) {
      if (signal?.cancelled) return;
      setError({
        notFound: err.status === 404,
        message: err.status === 404 ? 'Walk not found' : (err.message || "Couldn't load this walk"),
      });
    }
  }, [id]);

  useEffect(() => {
    const signal = { cancelled: false };
    loadWalk(signal);
    return () => { signal.cancelled = true; };
  }, [loadWalk]);

  // Re-fetch after the agent refines, so the map + shotlist reflect the
  // update. Returns whether it succeeded, so callers (RefinePanel) can be
  // honest about it instead of always claiming success.
  const reloadWalk = useCallback(async () => {
    try {
      const res = await walksApi.getWalk(id);
      setWalk(res.walk);
      setActiveStop(null);
      return true;
    } catch {
      return false;
    }
  }, [id]);

  const walkingPath = useMemo(() => {
    if (!walk?.walkingPolyline) return null;
    try { return polyline.decode(walk.walkingPolyline); } catch { return null; }
  }, [walk?.walkingPolyline]);

  const toggleWalked = async () => {
    if (markingWalked) return;
    const nextStatus = walk.status === 'completed' ? 'composed' : 'completed';
    setMarkingWalked(true);
    try {
      await walksApi.setWalkStatus(walk.id, nextStatus);
      setWalk(prev => ({ ...prev, status: nextStatus }));
    } catch {
      // best-effort — leave state as-is, the button just stays clickable to retry
    } finally {
      setMarkingWalked(false);
    }
  };

  if (error) {
    return (
      <div className="app">
        <TopNav />
        <main style={{ padding: 32, textAlign: 'center' }} role="alert">
          {error.notFound ? (
            <>
              <h1 className="display-sm">Walk <em>not found.</em></h1>
              <p className="lede" style={{ margin: '12px auto 24px' }}>
                This walk may have been deleted, or doesn't belong to your account.
              </p>
              <Button variant="ghost" onClick={() => navigate('/folio')}>← Back to folio</Button>
            </>
          ) : (
            <>
              <h1 className="display-sm">Couldn't load this <em>walk.</em></h1>
              <p className="lede" style={{ margin: '12px auto 24px' }}>{error.message}</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <Button onClick={loadWalk}>Retry</Button>
                <Button variant="ghost" onClick={() => navigate('/folio')}>← Back to folio</Button>
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  if (!walk) {
    return (
      <div className="app">
        <TopNav />
        <main>
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
        </main>
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

      <main>
      <div className="plan-head">
        <div>
          <div className="kicker">03 · The Plan</div>
          <h1 className="display-sm">{renderEmphasis(emphasizeFirstNoun(walk.title))}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {walk.status === 'completed' && (
            <div className="plan-stamp is-walked">Walked</div>
          )}
          <div className="plan-stamp">
            {isJustComposed ? 'Just composed' : composedDateLabel}
          </div>
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

            {walk.stops.map((s) => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={makeStopIcon(s.ordinal, activeStop === s.id)}
                eventHandlers={{ click: () => setActiveStop(s.id) }}
              />
            ))}

            <FitBoundsController stops={walk.stops} walkingPath={walkingPath} />
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
              >
                <button
                  type="button"
                  className="shotlist-item-btn"
                  onClick={() => setActiveStop(s.id)}
                  aria-current={activeStop === s.id ? 'true' : undefined}
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
                </button>
                <a
                  className="shotlist-maps-link"
                  href={mapsLink(s)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Maps ↗
                </a>
              </li>
            ))}
          </ol>

          {walk.agentRun?.id && (
            <RefinePanel runId={walk.agentRun.id} onComposed={reloadWalk} />
          )}

          <div className="plan-actions">
            <Button variant="ghost" onClick={() => navigate('/folio')}>← Back to folio</Button>
            <Button onClick={() => navigate('/brief')} arrow>Plan another</Button>
          </div>

          <div className="plan-actions plan-actions-secondary">
            <Button variant="ghost" onClick={toggleWalked} disabled={markingWalked}>
              {walk.status === 'completed' ? 'Mark as not walked' : 'Mark as walked'}
            </Button>
            <Button variant="ghost" onClick={() => downloadGpx(walk, walkingPath)}>Download GPX</Button>
            <Button variant="ghost" onClick={() => window.print()}>Print the plan</Button>
          </div>

        </div>
      </div>
      </main>
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
    if (!s) return;
    const targetZoom = Math.max(map.getZoom(), 15);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      map.setView([s.lat, s.lng], targetZoom);
    } else {
      map.flyTo([s.lat, s.lng], targetZoom, { duration: 0.6 });
    }
  }, [activeStop, stops, map]);
  return null;
}

// ──────────────────────────────────────────────────
// Re-fits the viewport whenever the route's geometry changes — react-leaflet
// treats MapContainer's center/zoom as mount-only, so without this a refine
// that relocates the walk leaves the map staring at the old center.
// ──────────────────────────────────────────────────
function FitBoundsController({ stops, walkingPath }) {
  const map = useMap();
  useEffect(() => {
    const points = walkingPath && walkingPath.length > 0
      ? walkingPath
      : stops.map(s => [s.lat, s.lng]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
    } else {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
    }
  }, [stops, walkingPath, map]);
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
