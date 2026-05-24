import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import StepIndicator from '../components/StepIndicator.jsx';
import LoadingDot from '../components/LoadingDot.jsx';
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

export default function Dialogue() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [run, setRun]               = useState(null);
  const [pastWalks, setPastWalks]   = useState(null);
  const [loadError, setLoadError]   = useState(null);
  const [aborting, setAborting]     = useState(false);

  const handleAbort = async () => {
    if (aborting) return;
    if (!confirm('Stop this walk and discard the draft?')) return;
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
        mobility:     b.mobility,
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

  const stream = useAgentStream(id);

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
        <div style={{ color: '#f87171', fontFamily: 'var(--mono)', padding: 24 }}>
          {loadError}
        </div>
      </div>
    );
  }

  if (!run || !pastWalks) {
    return (
      <div className="app">
        <TopNav />
        <LoadingDot />
      </div>
    );
  }

  return (
    <div className="app">
      <TopNav />
      <StepIndicator steps={WALK_STEPS} current="dialogue" onJump={(k) => k === 'brief' && navigate('/brief')} />

      <div className="dialogue-wrap">

        <aside className="dialogue-side">
          <div className="kicker">02 · Dialogue</div>
          <h2 className="display-sm">A short <em>conversation.</em></h2>
          <p className="body-md">
            The agent has your brief <em>and</em> your folio. A few quick
            calibrations before it composes today's route.
          </p>
          <div className={`dialogue-stamp ${stream.composed ? 'is-done' : ''}`}>
            {stream.composed     && 'Composed'}
            {stream.awaitingUser && 'Awaiting reply'}
            {stream.status === 'streaming' && 'Thinking'}
            {stream.status === 'connecting' && 'Connecting'}
            {stream.status === 'error'    && 'Error'}
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

        <div className="transcript">

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
            <div className="turn">
              <div className="turn-who" style={{ color: '#f87171' }}>Error</div>
              <div className="turn-msg" style={{ color: '#f87171', fontSize: 16, marginBottom: 12 }}>
                {stream.error}
              </div>
              <div className="dialogue-error-actions">
                <Button onClick={handleRestart}>Try again</Button>
                <Button variant="ghost" onClick={() => navigate('/folio')}>Back to folio</Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
