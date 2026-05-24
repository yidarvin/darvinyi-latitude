import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as walksApi from '../api/walks.js';
import { useAuth } from '../hooks/useAuth.jsx';
import TopNav from '../components/TopNav.jsx';
import Button from '../components/Button.jsx';
import WalkThumb from '../components/WalkThumb.jsx';
import LoadingDot from '../components/LoadingDot.jsx';
import { SkeletonLine, SkeletonBlock } from '../components/Skeleton.jsx';
import { renderEmphasis } from '../lib/markdownLite.jsx';
import { styleLabel, todLabel, formatDate, formatKm } from '../lib/walkLabels.js';

export default function Folio() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [walks, setWalks] = useState(null);
  const [insight, setInsight] = useState(null);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

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
        setInsight(insightRes);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load folio');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDelete = async (e, walk) => {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId) return;
    const ok = window.confirm(
      `Delete "${walk.title}"? Its photo stops become fair game for future walks. This can't be undone.`
    );
    if (!ok) return;

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
        <div style={{ color: '#f87171', fontFamily: 'var(--mono)', fontSize: 12, padding: 20 }}>
          {error}
        </div>
      </div>
    );
  }

  if (!walks || !insight) {
    return (
      <div className="app">
        <TopNav />
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
      </div>
    );
  }

  const greeting = greetingFor(new Date());
  const firstName = user.email.split('@')[0];

  return (
    <div className="app">
      <TopNav />

      <div className="folio-head">
        <div>
          <div className="kicker">Your folio · {new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</div>
          <h2 className="display-sm">{greeting}, <em>{firstName}.</em></h2>
        </div>
        <div className="folio-stats">
          <div><span className="stat-num">{insight.stats.totalWalks}</span>Walks</div>
          <div><span className="stat-num">{insight.stats.totalFrames}</span>Frames</div>
          <div><span className="stat-num"><em>{insight.stats.totalDistanceKm}</em>km</span>Walked</div>
        </div>
      </div>

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
                  <button
                    type="button"
                    className="walk-delete"
                    title="Delete walk"
                    aria-label={`Delete ${w.title}`}
                    disabled={deletingId === w.id}
                    onClick={(e) => handleDelete(e, w)}
                  >
                    {deletingId === w.id ? '···' : '✕'}
                  </button>
                </div>
                <div className="walk-body">
                  <div className="walk-title">{renderEmphasis(emphasizeTitle(w.title))}</div>
                  <div className="walk-location">{w.locationName.split(',')[0]} · SF</div>

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
        </>
      )}
    </div>
  );
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
