import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  CAMERAS, MIRRORLESS_LENSES, STYLE_OPTIONS, TOD_OPTIONS,
  MOBILITY_OPTIONS, DURATIONS, findCamera, findDuration,
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
  mobility:     z.array(z.enum(MOBILITY_OPTIONS)).min(1, 'Choose at least one mobility option'),
  styles:       z.array(z.enum(STYLE_OPTIONS)).min(1, 'Choose at least one style'),
  intent:       z.string().max(500).optional().default(''),
});

/**
 * GET /api/walks
 * List the current user's walks, most recent first.
 * Returns lightweight cards (no per-stop detail — that comes from /walks/:id).
 */
router.get('/walks', requireAuth, async (req, res, next) => {
  try {
    const walks = await prisma.walk.findMany({
      where: { userId: req.user.id, status: { not: 'draft' } },
      orderBy: { date: 'desc' },
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
        stops: {
          select: { ordinal: true, lat: true, lng: true },
          orderBy: { ordinal: 'asc' },
        },
        _count: { select: { stops: true } },
      },
    });

    res.json({ walks });
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
      mobility:     brief.mobility,
      styles:       brief.styles,
      intent:       brief.intent || null,
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
