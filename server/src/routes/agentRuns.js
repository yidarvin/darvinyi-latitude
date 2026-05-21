import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createSSE } from '../agent/sse.js';
import { runAgentLoop } from '../agent/loop.js';

const router = Router();

/**
 * GET /api/agent-runs/:id/stream
 * Opens SSE. Runs (or resumes) the agent loop.
 */
router.get('/agent-runs/:id/stream', requireAuth, async (req, res) => {
  const { id } = req.params;

  const run = await prisma.agentRun.findFirst({
    where: { id, userId: req.user.id },
    select: { id: true, status: true, walkId: true },
  });
  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const sse = createSSE(res);

  if (run.status === 'composed') {
    sse.send('composed', { walkId: run.walkId });
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
});

/**
 * POST /api/agent-runs/:id/reply
 * Append the user's reply to a tool_use that's awaiting input.
 * Sets the run back to active. The client should then re-open the stream.
 */
const replySchema = z.object({
  reply: z.string().min(1).max(2000),
});

router.post('/agent-runs/:id/reply', requireAuth, async (req, res, next) => {
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
 * POST /api/agent-runs/:id/abort
 * Marks an active or awaiting_user run as abandoned. Client should then
 * navigate away. Composed runs cannot be aborted.
 */
router.post('/agent-runs/:id/abort', requireAuth, async (req, res) => {
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
  res.json({ ok: true });
});

/**
 * GET /api/agent-runs/:id
 * Small endpoint for the dialogue UI to know the run's current state
 * without opening a stream.
 */
router.get('/agent-runs/:id', requireAuth, async (req, res) => {
  const run = await prisma.agentRun.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    select: {
      id: true, status: true, walkId: true,
      createdAt: true, briefSnapshot: true,
    },
  });
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run });
});

export default router;
