import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  CAMERAS, MIRRORLESS_LENSES, STYLE_OPTIONS, TOD_OPTIONS,
  DURATIONS, findCamera, findDuration,
} from '../lib/cameras.js';

const router = Router();

const cameraIds      = CAMERAS.map(c => c.id);
const durationIds    = DURATIONS.map(d => d.id);
const mirrorlessLens = new Set(MIRRORLESS_LENSES.map(l => l.id));

const briefSchema = z.object({
  locationName: z.string().min(2).max(120).trim(),
  durationId:   z.enum(durationIds),
  timeOfDay:    z.enum(TOD_OPTIONS),
  cameraId:     z.enum(cameraIds),
  lensIds:      z.array(z.string()).optional().default([]),
  // Free-text lens + film stock for film bodies — the only camera type with
  // no fixed lensSpec and no chip-selectable lens list.
  lensText:     z.string().max(120).optional().default(''),
  styles:       z.array(z.enum(STYLE_OPTIONS)).min(1, 'Choose at least one style'),
  roundTrip:    z.boolean().optional().default(false),
  intent:       z.string().max(500).optional().default(''),
  // The photographer's own local calendar date (YYYY-MM-DD), so the agent's
  // "today" matches their timezone rather than the server's UTC clock.
  // Optional + validated loosely since it's client-computed, not user input.
  localDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const WALKS_PAGE_SIZE = 24;

/**
 * GET /api/walks?cursor=<walkId>
 * List the current user's walks, most recent first, paginated. Returns
 * lightweight cards (no per-stop detail — that comes from /walks/:id) plus
 * every stop's bare coordinates for the folio thumbnail minimaps.
 */
router.get('/walks', requireAuth, async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim() ? req.query.cursor.trim() : undefined;

    const rows = await prisma.walk.findMany({
      where: { userId: req.user.id, status: { not: 'draft' } },
      // date(desc) alone isn't a stable sort — walks composed in the same
      // instant would tie. id is unique, so it makes cursor pagination exact.
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: WALKS_PAGE_SIZE + 1, // one extra row, to know if there's a next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        subtitle: true,
        locationName: true,
        date: true,
        timeOfDay: true,
        durationMin: true,
        distanceM: true,
        cameraBody: true,
        styles: true,
        status: true,
        stops: {
          select: { ordinal: true, lat: true, lng: true },
          orderBy: { ordinal: 'asc' },
        },
        _count: { select: { stops: true } },
      },
    });

    const hasMore = rows.length > WALKS_PAGE_SIZE;
    const walks = hasMore ? rows.slice(0, WALKS_PAGE_SIZE) : rows;

    res.json({ walks, nextCursor: hasMore ? walks[walks.length - 1].id : null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/walks/:id
 * Full detail for one walk.
 */
router.get('/walks/:id', requireAuth, async (req, res, next) => {
  try {
    const walk = await prisma.walk.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        stops: { orderBy: { ordinal: 'asc' } },
        agentRun: { select: { id: true } },
      },
    });

    if (!walk) {
      return res.status(404).json({ error: 'Walk not found' });
    }

    res.json({ walk });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/walks/:id
 * Permanently remove a walk from the user's folio. Stops cascade-delete, and
 * the linked AgentRun's walkId is set null. After deletion the walk no longer
 * appears in get_user_history, so its stops become fair game for future walks.
 */
router.delete('/walks/:id', requireAuth, async (req, res, next) => {
  try {
    const walk = await prisma.walk.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: { id: true },
    });

    if (!walk) {
      return res.status(404).json({ error: 'Walk not found' });
    }

    await prisma.walk.delete({ where: { id: walk.id } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({
  status: z.enum(['composed', 'completed']),
});

/**
 * PATCH /api/walks/:id/status
 * Mark a walk as walked (or back to just composed). get_user_history reports
 * this to the agent, so completed walks read as lived-in history rather than
 * unexecuted plans.
 */
router.patch('/walks/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);

    const walk = await prisma.walk.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: { id: true },
    });
    if (!walk) {
      return res.status(404).json({ error: 'Walk not found' });
    }

    await prisma.walk.update({ where: { id: walk.id }, data: { status } });

    res.json({ ok: true, status });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid status' });
    }
    next(err);
  }
});

/**
 * POST /api/walks/draft
 * Creates an AgentRun seeded with the validated brief.
 * Does NOT create a Walk row — that happens when the agent calls compose_walk.
 */
router.post('/walks/draft',
  requireAuth,
  rateLimit('draft', 10, 60 * 60 * 1000),
  async (req, res, next) => {
  try {
    const brief = briefSchema.parse(req.body);

    const camera = findCamera(brief.cameraId);
    let lensSpec = camera.lensSpec || '';
    if (camera.type === 'mirrorless') {
      const validLensIds = brief.lensIds.filter(id => mirrorlessLens.has(id));
      if (validLensIds.length === 0) {
        return res.status(400).json({ error: 'Choose at least one lens for a mirrorless body' });
      }
      lensSpec = validLensIds
        .map(id => MIRRORLESS_LENSES.find(l => l.id === id).label)
        .join(' · ');
    } else if (camera.type === 'film') {
      lensSpec = brief.lensText.trim();
      if (!lensSpec) {
        return res.status(400).json({ error: 'Enter your lens and film stock for a film body' });
      }
    }

    const duration = findDuration(brief.durationId);

    const briefSnapshot = {
      locationName: brief.locationName,
      durationId:   brief.durationId,
      durationMin:  duration.minutes,
      timeOfDay:    brief.timeOfDay,
      cameraId:     brief.cameraId,
      cameraType:   camera.type,
      cameraLabel:  camera.label.split(' · ')[0],
      lensIds:      brief.lensIds || [],
      lensSpec,
      styles:       brief.styles,
      roundTrip:    brief.roundTrip,
      intent:       brief.intent || null,
      localDate:    brief.localDate || new Date().toISOString().slice(0, 10),
      submittedAt:  new Date().toISOString(),
    };

    const run = await prisma.agentRun.create({
      data: {
        userId:        req.user.id,
        briefSnapshot,
        messages:      [],
        status:        'active',
      },
      select: { id: true },
    });

    res.status(201).json({ agentRunId: run.id });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: err.issues[0]?.message || 'Invalid brief' });
    }
    next(err);
  }
}
);

export default router;
