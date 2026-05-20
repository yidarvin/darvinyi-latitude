import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'latitude', time: new Date().toISOString() });
});

router.get('/db-health', async (req, res, next) => {
  try {
    const result = await prisma.$queryRaw`SELECT 1 as ok`;
    res.json({ ok: true, db: result });
  } catch (err) {
    next(err);
  }
});

export default router;
