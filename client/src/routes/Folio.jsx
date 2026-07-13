import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as walksApi from '../api/walks.js';
import * as agentRunsApi from '../api/agentRuns.js';
import { useAuth } from '../hooks/useAuth.jsx';
import TopNav from '../components/TopNav.jsx';
import Button from '../components/Button.jsx';
import WalkThumb from '../components/WalkThumb.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { SkeletonLine, SkeletonBlock } from '../components/Skeleton.jsx';
import { renderEmphasis } from '../lib/markdownLite.jsx';
import { styleLabel, todLabel, formatDate, formatKm } from '../lib/walkLabels.js';

export default function Folio() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [walks, setWalks] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [insight, setInsight] = useState(null);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [resumableRuns, setResumableRuns] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [walksRes, insightRes] = await Promise.all([
          walksApi.listWalks(),
          walksApi.getFolioInsight(),
        ]);
        if (cancelled) return;
        setWalks(walksRes.walks);
        setNextCursor(walksRes.nextCursor || null);
        setInsight(insightRes);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load folio');
      }
    })();
    // Best-effort — a failed lookup just means no resume banner, not a
    // broken folio.
    agentRunsApi.listAgentRuns()
      .then((res) => { if (!cancelled) setResumableRuns(res.runs || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await walksApi.listWalks(nextCursor);
      setWalks(prev => [...prev, ...res.walks]);
      setNextCursor(res.nextCursor || null);
    } catch (err) {
      setError(err.message || 'Failed to load more walks');
    } finally {
      setLoadingMore(false);
    }
  };

  const requestDelete = (e, walk) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId) return;
    setConfirmTarget(walk);
  };

  const confirmDelete = async () => {
    const walk = confirmTarget;
    setConfirmTarget(null);
    if (!walk) return;

    setDeletingId(walk.id);
    try {
      await walksApi.deleteWalk(walk.id);
      // Drop it locally, then refresh the insight + stats so they stay accurate.
      setWalks(prev => prev.filter(w => w.id !== walk.id));
      try {
        const insightRes = await walksApi.getFolioInsight();
        setInsight(insightRes);
      } catch { /* stats refresh is best-effort */ }
    } catch (err) {
      setError(err.message || 'Failed to delete walk');
    } finally {
      setDeletingId(null);
    }
  };

  if (error) {
    return (
      <div className="app">
        <TopNav />
        <main className="error-banner" role="alert">
          {error}
        </main>
      </div>
    );
  }

  if (!walks || !insight) {
    return (
      <div className="app">
        <TopNav />
        <main>
        <div className="folio-head">
          <div>
            <SkeletonLine width={180} height={11} style={{ marginBottom: 14 }} />
            <SkeletonLine width={420} height={36} />
          </div>
        </div>
        <SkeletonBlock height={120} style={{ marginBottom: 44 }} />
        <SkeletonLine width={140} height={22} style={{ marginBottom: 22 }} />
        <div className="walks-grid">
          {[0,1,2,3].map(i => (
            <div key={i} className="walk-card" style={{ cursor: 'default' }}>
              <SkeletonBlock height={130} />
              <div className="walk-body">
                <SkeletonLine width="70%" height={20} style={{ marginBottom: 8 }} />
                <SkeletonLine width="40%" height={11} style={{ marginBottom: 14 }} />
                <SkeletonLine width="50%" height={14} />
              </div>
            </div>
          ))}
        </div>
        </main>
      </div>
    );
  }

  const greeting = greetingFor(new Date());
  const firstName = user.email.split('@')[0];

  return (
    <div className="app">
      <TopNav />

      <main>
      <div className="folio-head">
        <div>
          <div className="kicker">Your folio · {new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</div>
          <h1 className="display-sm">{greeting}, <em>{firstName}.</em></h1>
        </div>
        <div className="folio-stats">
          <div><span className="stat-num">{insight.stats.totalWalks}</span>Walks</div>
          <div><span className="stat-num">{insight.stats.totalFrames}</span>Frames</div>
          <div><span className="stat-num"><em>{insight.stats.totalDistanceKm}</em>km</span>Walked</div>
        </div>
      </div>

      {resumableRuns.length > 0 && (
        <div className="resume-banner" role="status">
          <div>
            <div className="resume-banner-label">⏵ Walk in progress</div>
            <div className="resume-banner-text">
              {resumableRuns[0].locationName
                ? <>You've got a walk going in <em>{resumableRuns[0].locationName.split(',')[0]}</em> — pick up where you left off.</>
                : <>You've got a walk in progress — pick up where you left off.</>}
            </div>
          </div>
          <Button onClick={() => navigate(`/dialogue/${resumableRuns[0].id}`)} arrow>Resume</Button>
        </div>
      )}

      <div className="insight-card">
        <div>
          <div className="insight-label">⏵ Agent insight</div>
          <div className="insight-text">{renderEmphasis(insight.insight.text)}</div>
        </div>
        <Button onClick={() => navigate('/brief')} arrow>
          {walks.length === 0 ? 'Plan your first walk' : "Plan today's walk"}
        </Button>
      </div>

      {walks.length === 0 ? (
        <div className="folio-empty">
          <h3 className="display-sm">Your folio is <em>empty.</em></h3>
          <p className="lede">Latitude composes walks from the brief you give it. Once you've taken a walk or two, this is where they'll live.</p>
          <Button onClick={() => navigate('/brief')} arrow>Compose a walk</Button>
        </div>
      ) : (
        <>
          <div className="folio-section-head">
            <div className="folio-section-title">Past <em>walks</em></div>
            <div className="label-mono">Sorted · most recent</div>
          </div>

          <div className="walks-grid">
            {walks.map((w) => (
              <Link key={w.id} to={`/folio/walks/${w.id}`} className="walk-card">
                <div className="walk-thumb">
                  <WalkThumb stops={w.stops} />
                  <div className="walk-meta-overlay">{formatDate(w.date)}</div>
                  {w.status === 'completed' && (
                    <div className="walk-walked-badge" title="Marked as walked">✓ Walked</div>
                  )}
                  <button
                    type="button"
                    className="walk-delete"
                    title="Delete walk"
                    aria-label={`Delete ${w.title}`}
                    disabled={deletingId === w.id}
                    onClick={(e) => requestDelete(e, w)}
                  >
                    {deletingId === w.id ? '···' : '✕'}
                  </button>
                </div>
                <div className="walk-body">
                  <div className="walk-title">{renderEmphasis(emphasizeTitle(w.title))}</div>
                  <div className="walk-location">{walkLocationLabel(w.locationName)}</div>

                  <div className="walk-tags">
                    {w.styles.slice(0, 2).map((s) => (
                      <span key={s} className="walk-tag">{styleLabel(s)}</span>
                    ))}
                  </div>

                  <div className="walk-stats">
                    <span><b>{w._count.stops}</b> frames</span>
                    <span><b>{formatKm(w.distanceM)}</b> km</span>
                    <span>{todLabel(w.timeOfDay)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {nextCursor && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
              <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more walks'}
              </Button>
            </div>
          )}
        </>
      )}
      </main>

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete this walk?"
        message={confirmTarget ? `Delete "${confirmTarget.title}"? Its photo stops become fair game for future walks. This can't be undone.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

/**
 * "Neighborhood, City" → "Neighborhood · City". Falls back to just the
 * neighborhood when there's no comma (e.g. a single-word location).
 */
function walkLocationLabel(locationName) {
  const [area, ...rest] = (locationName || '').split(',');
  const region = rest.length ? rest[rest.length - 1].trim() : null;
  return region ? `${area.trim()} · ${region}` : area.trim();
}

function greetingFor(d) {
  const h = d.getHours();
  if (h < 5)  return 'Late night';
  if (h < 11) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Late night';
}

/**
 * Wrap one word in the title with *...* for emphasis.
 */
function emphasizeTitle(title) {
  const words = title.split(' ');
  if (words.length < 2) return title;
  const last = words[words.length - 1];
  return [...words.slice(0, -1), `*${last}*`].join(' ');
}
