import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createSSE } from '../agent/sse.js';
import { runAgentLoop, abortActiveRun, reapIfStale } from '../agent/loop.js';
import { deriveTranscript } from '../agent/transcript.js';

const router = Router();

/**
 * GET /api/agent-runs?status=active,awaiting_user
 * Lists the user's resumable runs so the Folio can surface a "pick up where
 * you left off" banner — the disconnect fix in the agent loop means a
 * dropped connection leaves a genuinely resumable run instead of a dead one,
 * but nothing pointed the user back at it until now. Reaps stale rows the
 * same way the single-run and stream routes do.
 */
router.get('/agent-runs', requireAuth, async (req, res, next) => {
  try {
    const allowed = new Set(['active', 'awaiting_user']);
    const requested = typeof req.query.status === 'string'
      ? req.query.status.split(',').map(s => s.trim()).filter(s => allowed.has(s))
      : ['active', 'awaiting_user'];
    const statuses = requested.length > 0 ? requested : ['active', 'awaiting_user'];

    const rows = await prisma.agentRun.findMany({
      where: { userId: req.user.id, status: { in: statuses } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, status: true, updatedAt: true, briefSnapshot: true },
    });

    const runs = [];
    for (const row of rows) {
      const fresh = await reapIfStale(row);
      if (fresh.status === 'active' || fresh.status === 'awaiting_user') {
        runs.push({
          id: fresh.id,
          status: fresh.status,
          updatedAt: fresh.updatedAt,
          locationName: row.briefSnapshot?.locationName || null,
        });
      }
    }

    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent-runs/:id/stream
 * Opens SSE. Runs (or resumes) the agent loop.
 */
router.get('/agent-runs/:id/stream', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    let run = await prisma.agentRun.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true, status: true, walkId: true, updatedAt: true },
    });
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    run = await reapIfStale(run);

    const sse = createSSE(res);

    if (run.status === 'composed') {
      sse.send('composed', { walkId: run.walkId });
      sse.close();
      return;
    }

    if (run.status === 'abandoned') {
      sse.send('error', { message: 'This walk was stopped.' });
      sse.close();
      return;
    }

    if (run.status === 'awaiting_user') {
      const fullRun = await prisma.agentRun.findUnique({
        where: { id }, select: { messages: true },
      });
      const lastAssistant = [...(fullRun.messages || [])].reverse()
        .find(m => m.role === 'assistant');
      const tu = lastAssistant?.content?.find(b => b.type === 'tool_use' && b.name === 'request_user_input');
      if (tu) {
        sse.send('awaiting_user', { question: tu.input.question, toolUseId: tu.id });
      } else {
        sse.send('error', { message: 'Run state inconsistent' });
      }
      sse.close();
      return;
    }

    await runAgentLoop(sse, id);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent-runs/:id/reply
 * Append the user's reply to a tool_use that's awaiting input.
 * Sets the run back to active. The client should then re-open the stream.
 */
const replySchema = z.object({
  reply: z.string().min(1).max(2000),
});

router.post('/agent-runs/:id/reply', requireAuth, rateLimit('agent-reply', 30, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const { reply } = replySchema.parse(req.body);
    const { id } = req.params;

    const run = await prisma.agentRun.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'awaiting_user') {
      return res.status(400).json({ error: 'Run is not awaiting user input' });
    }

    const messages = Array.isArray(run.messages) ? [...run.messages] : [];
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    const tu = lastAssistant?.content?.find(b => b.type === 'tool_use' && b.name === 'request_user_input');
    if (!tu) {
      return res.status(500).json({ error: 'Run has no pending request_user_input' });
    }

    messages.push({
      role: 'user',
      content: [{
        type:         'tool_result',
        tool_use_id:  tu.id,
        content:      reply,
      }],
    });

    await prisma.agentRun.update({
      where: { id },
      data:  { messages, status: 'active' },
    });

    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid reply' });
    next(err);
  }
});

/**
 * POST /api/agent-runs/:id/refine
 * Re-open a composed run for refinement. Appends the user's note as a new
 * user message and flips the run back to active. The client then re-opens the
 * stream; on the next compose_walk the agent updates the existing walk in place.
 */
const refineSchema = z.object({
  message: z.string().min(1).max(2000),
});

router.post('/agent-runs/:id/refine', requireAuth, rateLimit('agent-refine', 30, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const { message } = refineSchema.parse(req.body);
    const { id } = req.params;

    const run = await prisma.agentRun.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'composed' || !run.walkId) {
      return res.status(400).json({ error: 'This walk is not ready to refine' });
    }

    const messages = Array.isArray(run.messages) ? [...run.messages] : [];
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: message }],
    });

    await prisma.agentRun.update({
      where: { id },
      data:  { messages, status: 'active' },
    });

    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid message' });
    next(err);
  }
});

/**
 * POST /api/agent-runs/:id/abort
 * Marks an active or awaiting_user run as abandoned. If a loop is actively
 * streaming for this run right now, stops it immediately (rather than
 * letting it keep spending the user's Anthropic tokens until its next
 * natural checkpoint). Composed runs cannot be aborted.
 */
router.post('/agent-runs/:id/abort', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const run = await prisma.agentRun.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true, status: true },
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'composed') {
      return res.status(400).json({ error: 'Cannot abort a composed run' });
    }
    await prisma.agentRun.update({
      where: { id },
      data:  { status: 'abandoned' },
    });
    abortActiveRun(id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agent-runs/:id
 * Small endpoint for the dialogue UI to know the run's current state
 * without opening a stream.
 */
router.get('/agent-runs/:id', requireAuth, async (req, res, next) => {
  try {
    let run = await prisma.agentRun.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: {
        id: true, status: true, walkId: true,
        createdAt: true, briefSnapshot: true, updatedAt: true, messages: true,
      },
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    run = await reapIfStale(run);
    // Derived, not the raw Anthropic message history — lets the Dialogue
    // screen hydrate its transcript on load/refresh instead of showing a
    // blank slate until the next live event arrives.
    const transcript = deriveTranscript(run.messages);
    const { messages: _messages, ...runWithoutRawMessages } = run;
    res.json({ run: { ...runWithoutRawMessages, transcript } });
  } catch (err) {
    next(err);
  }
});

export default router;
