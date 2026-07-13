import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import StepIndicator from '../components/StepIndicator.jsx';
import LoadingDot from '../components/LoadingDot.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import * as walksApi from '../api/walks.js';
import * as agentRunsApi from '../api/agentRuns.js';
import { abortRun } from '../api/agentRuns.js';
import { submitBriefDraft } from '../api/walks.js';
import Button from '../components/Button.jsx';
import { useAgentStream } from '../hooks/useAgentStream.js';
import { renderEmphasis } from '../lib/markdownLite.jsx';
import { formatDate } from '../lib/walkLabels.js';
import { Turn, ReplyBox } from '../components/AgentTranscript.jsx';

const WALK_STEPS = [
  { key: 'brief',    label: 'Brief' },
  { key: 'dialogue', label: 'Dialogue' },
  { key: 'plan',     label: 'The Plan' },
];

// Statuses where the stream endpoint has something useful to resume —
// active/awaiting_user genuinely continue the dialogue, and 'error' just
// replays the stored failure so the existing error UI renders it correctly.
const RESUMABLE_STATUSES = new Set(['active', 'awaiting_user', 'error']);

export default function Dialogue() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [run, setRun]               = useState(null);
  const [pastWalks, setPastWalks]   = useState(null);
  const [loadError, setLoadError]   = useState(null);
  const [aborting, setAborting]     = useState(false);
  const [confirmingAbort, setConfirmingAbort] = useState(false);

  const handleAbort = () => {
    if (aborting) return;
    setConfirmingAbort(true);
  };

  const confirmAbort = async () => {
    setConfirmingAbort(false);
    setAborting(true);
    try {
      await abortRun(id);
      navigate('/folio', { replace: true });
    } catch {
      setAborting(false);
    }
  };

  const handleRestart = async () => {
    if (!run?.briefSnapshot) return;
    const b = run.briefSnapshot;
    try {
      const res = await submitBriefDraft({
        locationName: b.locationName,
        durationId:   b.durationId,
        timeOfDay:    b.timeOfDay,
        cameraId:     b.cameraId,
        lensIds:      b.lensIds || [],
        lensText:     b.cameraType === 'film' ? (b.lensSpec || '') : '',
        styles:       b.styles,
        roundTrip:    b.roundTrip || false,
        intent:       b.intent || '',
      });
      navigate(`/dialogue/${res.agentRunId}`, { replace: true });
    } catch {
      navigate('/brief');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [runRes, walksRes] = await Promise.all([
          agentRunsApi.getAgentRun(id),
          walksApi.listWalks(),
        ]);
        if (cancelled) return;
        setRun(runRes.run);
        setPastWalks(walksRes.walks);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.message || 'Failed to load run');
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Don't auto-open the stream — wait until the run's actual status is
  // known. Otherwise a failed/slow getAgentRun() leaves the agent looping
  // invisibly behind the load-error screen, and revisiting an aborted run's
  // URL would silently resurrect it.
  const stream = useAgentStream(id, { autoStart: false });

  useEffect(() => {
    if (!run) return;
    if (run.status === 'composed') {
      navigate(`/folio/walks/${run.walkId}`, { replace: true });
      return;
    }
    if (RESUMABLE_STATUSES.has(run.status)) {
      stream.start(run.transcript);
    }
    // Only re-run when the run identity actually changes — stream.start is
    // stable per runId and re-triggering on every stream-state update would
    // restart the connection in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (stream.composed) {
      const t = setTimeout(() => {
        navigate(`/folio/walks/${stream.composed.walkId}`, { replace: true });
      }, 700);
      return () => clearTimeout(t);
    }
  }, [stream.composed, navigate]);

  if (loadError) {
    return (
      <div className="app">
        <TopNav />
        <main className="error-banner" role="alert">
          {loadError}
        </main>
      </div>
    );
  }

  if (!run || !pastWalks) {
    return (
      <div className="app">
        <TopNav />
        <main><LoadingDot /></main>
      </div>
    );
  }

  if (run.status === 'abandoned') {
    return (
      <div className="app">
        <TopNav />
        <main style={{ padding: 32, textAlign: 'center' }}>
          <h1 className="display-sm">This walk was <em>stopped.</em></h1>
          <p className="lede" style={{ margin: '12px auto 24px' }}>
            The draft was discarded. Start a fresh one whenever you're ready.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Button onClick={handleRestart}>Start over</Button>
            <Button variant="ghost" onClick={() => navigate('/folio')}>Back to folio</Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <TopNav />
      <StepIndicator steps={WALK_STEPS} current="dialogue" onJump={(k) => k === 'brief' && navigate('/brief')} />

      <main className="dialogue-wrap">

        <aside className="dialogue-side">
          <div className="kicker">02 · Dialogue</div>
          <h1 className="display-sm">A short <em>conversation.</em></h1>
          <p className="body-md">
            The agent has your brief <em>and</em> your folio. A few quick
            calibrations before it composes today's route.
          </p>
          <div className={`dialogue-stamp ${stream.composed ? 'is-done' : ''}`} role="status">
            {stream.composed       && 'Composed'}
            {stream.awaitingUser   && 'Awaiting reply'}
            {stream.status === 'streaming'    && 'Thinking'}
            {stream.status === 'connecting'   && 'Connecting'}
            {stream.status === 'reconnecting' && 'Reconnecting…'}
            {stream.status === 'error'        && 'Error'}
          </div>

          <div className="memory-recap">
            <div className="memory-recap-title">Loaded into context</div>
            {pastWalks.length === 0 ? (
              <div className="memory-recap-empty">No prior walks — agent is composing from scratch.</div>
            ) : (
              pastWalks.slice(0, 6).map(w => (
                <div className="memory-item" key={w.id}>
                  <span className="memory-item-where">{w.title}</span>
                  <span className="memory-item-date">{formatDate(w.date)}</span>
                </div>
              ))
            )}
          </div>

          {!stream.composed && (
            <div className="dialogue-actions">
              <Button variant="ghost" onClick={handleAbort} disabled={aborting}>
                {aborting ? 'Stopping…' : 'Stop walk'}
              </Button>
            </div>
          )}
        </aside>

        <div className="transcript" role="log" aria-live="polite" aria-relevant="additions">

          {stream.turns.map((turn, i) => <Turn key={i} turn={turn} />)}

          {stream.activeText && (
            <div className="turn">
              <div className="turn-who agent">Latitude · Agent</div>
              <div className="turn-msg">
                {renderEmphasis(stream.activeText)}
                <span className="cursor" />
              </div>
            </div>
          )}

          {stream.awaitingUser && (
            <ReplyBox
              question={stream.awaitingUser.question}
              onSubmit={stream.submitReply}
            />
          )}

          {stream.composed && (
            <div className="turn">
              <div className="turn-who agent">Latitude · Agent</div>
              <div className="turn-msg" style={{ color: 'var(--accent)' }}>
                <em>Composed.</em> Routing you to the plan…
              </div>
            </div>
          )}

          {stream.error && (
            <div className="turn" role="alert">
              <div className="turn-who error">Error</div>
              <div className="turn-msg error" style={{ fontSize: 16, marginBottom: 12 }}>
                {stream.error}
              </div>
              <div className="dialogue-error-actions">
                <Button onClick={handleRestart}>Try again</Button>
                <Button variant="ghost" onClick={() => navigate('/folio')}>Back to folio</Button>
              </div>
            </div>
          )}

        </div>
      </main>

      <ConfirmDialog
        open={confirmingAbort}
        title="Stop this walk?"
        message="This discards the current draft. You'll need to start over."
        confirmLabel="Stop walk"
        danger
        onConfirm={confirmAbort}
        onCancel={() => setConfirmingAbort(false)}
      />
    </div>
  );
}
