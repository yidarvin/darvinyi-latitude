import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

/**
 * GET /api/folio/insight
 * Returns a single insight string + supporting stats, computed from the
 * user's walks. This is shown in the folio header card.
 *
 * The text is template-built from real data, not LLM-generated. The agent
 * itself will form richer observations in dialogue.
 */
router.get('/folio/insight', requireAuth, async (req, res, next) => {
  try {
    const walks = await prisma.walk.findMany({
      where: { userId: req.user.id, status: { not: 'draft' } },
      orderBy: { date: 'desc' },
      take: 10,
      select: {
        title: true,
        locationName: true,
        date: true,
        timeOfDay: true,
        styles: true,
        durationMin: true,
        distanceM: true,
      },
    });

    const totalWalks = await prisma.walk.count({
      where: { userId: req.user.id, status: { not: 'draft' } },
    });

    const totalDistanceM = walks.reduce((acc, w) => acc + (w.distanceM || 0), 0);
    const totalFrames = await prisma.stop.count({
      where: { walk: { userId: req.user.id, status: { not: 'draft' } } },
    });

    let text = null;
    let tone = 'invite'; // 'invite' | 'observation' | 'absence'

    if (walks.length === 0) {
      text = "No walks yet. Start by telling Latitude where you are, what you brought, and how long you've got.";
      tone = 'invite';
    } else {
      const recent = walks.slice(0, 3);
      const tods = recent.map(w => w.timeOfDay).filter(Boolean);
      const todCount = tally(tods);
      const dominantTod = topKey(todCount);

      const locs = recent.map(w => firstWord(w.locationName));
      const uniqueLocs = new Set(locs);

      const lastDate = walks[0].date;
      const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince >= 21) {
        text = `It's been ${daysSince} days since your last walk (${walks[0].title}, in ${walks[0].locationName.split(',')[0]}). The agent's holding onto your style — pick up where you left off.`;
        tone = 'absence';
      } else if (dominantTod && todCount[dominantTod] >= 2 && walks.length >= 3) {
        const todLabel = TOD_LABELS[dominantTod] || dominantTod;
        text = `You've gravitated toward *${todLabel.toLowerCase()} light* on your recent walks. Worth breaking the pattern, or keep building the consistency?`;
        tone = 'observation';
      } else if (uniqueLocs.size === 1 && walks.length >= 2) {
        text = `Your last few walks have stayed in *${[...uniqueLocs][0]}*. The agent's queuing up something further afield next.`;
        tone = 'observation';
      } else if (walks.length >= 3) {
        text = `Three different neighborhoods in your last three walks — *${recent.map(w => firstWord(w.locationName)).join(', ')}*. The agent's noticed your range.`;
        tone = 'observation';
      } else {
        text = `Welcome back. ${walks.length} walk${walks.length === 1 ? '' : 's'} in your folio so far.`;
        tone = 'invite';
      }
    }

    res.json({
      insight: { text, tone },
      stats: {
        totalWalks,
        totalFrames,
        totalDistanceKm: Math.round((totalDistanceM / 1000) * 10) / 10,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function tally(arr) {
  return arr.reduce((acc, k) => ({ ...acc, [k]: (acc[k] || 0) + 1 }), {});
}
function topKey(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0];
}
function firstWord(s) {
  return (s || '').split(',')[0].trim();
}

const TOD_LABELS = {
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  golden: 'Golden hour',
  blue: 'Blue hour',
  night: 'Night',
};

export default router;
