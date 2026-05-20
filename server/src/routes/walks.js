import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

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

export default router;
