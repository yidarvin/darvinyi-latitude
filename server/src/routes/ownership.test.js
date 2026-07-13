import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// ── Mocked prisma, hoisted so vi.mock factories can reference it ──
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    user:     { findUnique: vi.fn() },
    walk:     { findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn(), count: vi.fn() },
    agentRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    stop:     { count: vi.fn() },
  };
  return { mockPrisma };
});

vi.mock('../db.js', () => ({ prisma: mockPrisma }));
vi.mock('../agent/loop.js', () => ({
  runAgentLoop: vi.fn(async () => {}),
  abortActiveRun: vi.fn(() => false),
  reapIfStale: vi.fn((run) => run),
}));
vi.mock('../agent/sse.js', () => ({
  createSSE: () => ({ send: vi.fn(), close: vi.fn(), heartbeat: vi.fn(), isClosed: () => false }),
}));

const { default: walksRouter } = await import('./walks.js');
const { default: agentRunsRouter } = await import('./agentRuns.js');
const { default: folioRouter } = await import('./folio.js');
const { signToken, COOKIE_NAME } = await import('../lib/jwt.js');

const OWNER_ID    = 'user-owner';
const ATTACKER_ID = 'user-attacker';
const WALK_ID     = 'walk-owned-by-owner';
const RUN_ID      = 'run-owned-by-owner';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', walksRouter);
  app.use('/api', agentRunsRouter);
  app.use('/api', folioRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal server error' });
  });
  return app;
}

function cookieFor(userId) {
  const token = signToken(userId);
  return `${COOKIE_NAME}=${token}`;
}

describe('ownership isolation across routes', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // requireAuth resolves req.user from whichever id the JWT carries.
    mockPrisma.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve({ id: where.id, email: `${where.id}@test.dev`, createdAt: new Date() })
    );
  });

  describe('GET /api/walks/:id', () => {
    it('scopes the Prisma lookup by the authenticated user id', async () => {
      mockPrisma.walk.findFirst.mockResolvedValue(null);
      await request(app).get(`/api/walks/${WALK_ID}`).set('Cookie', cookieFor(OWNER_ID));
      expect(mockPrisma.walk.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: WALK_ID, userId: OWNER_ID }) })
      );
    });

    it("404s when the authenticated user does not own the walk (DB enforces the userId filter)", async () => {
      mockPrisma.walk.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === OWNER_ID && where.id === WALK_ID ? { id: WALK_ID, stops: [] } : null)
      );

      const asOwner = await request(app).get(`/api/walks/${WALK_ID}`).set('Cookie', cookieFor(OWNER_ID));
      expect(asOwner.status).toBe(200);

      const asAttacker = await request(app).get(`/api/walks/${WALK_ID}`).set('Cookie', cookieFor(ATTACKER_ID));
      expect(asAttacker.status).toBe(404);
    });
  });

  describe('DELETE /api/walks/:id', () => {
    it('refuses to delete a walk owned by another user', async () => {
      mockPrisma.walk.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === OWNER_ID && where.id === WALK_ID ? { id: WALK_ID } : null)
      );

      const res = await request(app).delete(`/api/walks/${WALK_ID}`).set('Cookie', cookieFor(ATTACKER_ID));
      expect(res.status).toBe(404);
      expect(mockPrisma.walk.delete).not.toHaveBeenCalled();
    });

    it('deletes when the authenticated user is the owner', async () => {
      mockPrisma.walk.findFirst.mockResolvedValue({ id: WALK_ID });
      mockPrisma.walk.delete.mockResolvedValue({ id: WALK_ID });

      const res = await request(app).delete(`/api/walks/${WALK_ID}`).set('Cookie', cookieFor(OWNER_ID));
      expect(res.status).toBe(200);
      expect(mockPrisma.walk.delete).toHaveBeenCalledWith({ where: { id: WALK_ID } });
    });
  });

  describe('GET /api/walks (list)', () => {
    it('always filters findMany by the authenticated user id', async () => {
      mockPrisma.walk.findMany.mockResolvedValue([]);
      await request(app).get('/api/walks').set('Cookie', cookieFor(ATTACKER_ID));
      expect(mockPrisma.walk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: ATTACKER_ID }) })
      );
    });
  });

  describe('agent-runs ownership', () => {
    it('GET /api/agent-runs/:id 404s for a run owned by another user', async () => {
      mockPrisma.agentRun.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === OWNER_ID && where.id === RUN_ID ? { id: RUN_ID, status: 'active' } : null)
      );
      const res = await request(app).get(`/api/agent-runs/${RUN_ID}`).set('Cookie', cookieFor(ATTACKER_ID));
      expect(res.status).toBe(404);
    });

    it('POST /api/agent-runs/:id/abort 404s for a run owned by another user and never updates it', async () => {
      mockPrisma.agentRun.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === OWNER_ID && where.id === RUN_ID ? { id: RUN_ID, status: 'active' } : null)
      );
      const res = await request(app).post(`/api/agent-runs/${RUN_ID}/abort`).set('Cookie', cookieFor(ATTACKER_ID));
      expect(res.status).toBe(404);
      expect(mockPrisma.agentRun.update).not.toHaveBeenCalled();
    });

    it('POST /api/agent-runs/:id/abort succeeds for the owner and stops any live loop', async () => {
      mockPrisma.agentRun.findFirst.mockResolvedValue({ id: RUN_ID, status: 'active' });
      mockPrisma.agentRun.update.mockResolvedValue({});
      const res = await request(app).post(`/api/agent-runs/${RUN_ID}/abort`).set('Cookie', cookieFor(OWNER_ID));
      expect(res.status).toBe(200);
      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({ where: { id: RUN_ID }, data: { status: 'abandoned' } });
    });

    it('POST /api/agent-runs/:id/refine 404s for a run owned by another user and never updates it', async () => {
      mockPrisma.agentRun.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === OWNER_ID && where.id === RUN_ID ? { id: RUN_ID, status: 'composed', walkId: WALK_ID } : null)
      );
      const res = await request(app)
        .post(`/api/agent-runs/${RUN_ID}/refine`)
        .set('Cookie', cookieFor(ATTACKER_ID))
        .send({ message: 'make it shorter' });
      expect(res.status).toBe(404);
      expect(mockPrisma.agentRun.update).not.toHaveBeenCalled();
    });

    it('POST /api/agent-runs/:id/reply 404s for a run owned by another user and never updates it', async () => {
      mockPrisma.agentRun.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.userId === OWNER_ID && where.id === RUN_ID ? { id: RUN_ID, status: 'awaiting_user', messages: [] } : null)
      );
      const res = await request(app)
        .post(`/api/agent-runs/${RUN_ID}/reply`)
        .set('Cookie', cookieFor(ATTACKER_ID))
        .send({ reply: 'street photography' });
      expect(res.status).toBe(404);
      expect(mockPrisma.agentRun.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/folio/insight', () => {
    it('scopes all folio queries by the authenticated user id', async () => {
      mockPrisma.walk.findMany.mockResolvedValue([]);
      mockPrisma.walk.count.mockResolvedValue(0);
      mockPrisma.stop.count.mockResolvedValue(0);

      await request(app).get('/api/folio/insight').set('Cookie', cookieFor(ATTACKER_ID));

      expect(mockPrisma.walk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: ATTACKER_ID }) })
      );
      expect(mockPrisma.walk.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: ATTACKER_ID }) })
      );
    });
  });

  describe('unauthenticated access', () => {
    it('rejects requests with no session cookie', async () => {
      const res = await request(app).get(`/api/walks/${WALK_ID}`);
      expect(res.status).toBe(401);
    });
  });
});
