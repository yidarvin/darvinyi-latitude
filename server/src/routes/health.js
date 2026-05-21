import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false });
  }
});

export default router;
