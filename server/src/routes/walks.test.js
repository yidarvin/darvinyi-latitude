import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    walk: { findMany: vi.fn() },
  },
}));

vi.mock('../db.js', () => ({ prisma: mockPrisma }));

const { default: walksRouter } = await import('./walks.js');
const { signToken, COOKIE_NAME } = await import('../lib/jwt.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', walksRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'Internal server error' }));
  return app;
}

function fakeWalk(id) {
  return { id, title: `Walk ${id}`, subtitle: 's', locationName: 'Mission, SF', date: new Date(), timeOfDay: 'golden', durationMin: 60, distanceM: 1000, cameraBody: 'X100VI', styles: ['street'], stops: [], _count: { stops: 4 } };
}

describe('GET /api/walks pagination', () => {
  const app = buildApp();
  const cookie = `${COOKIE_NAME}=${signToken('user-1')}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'u@test.dev', createdAt: new Date() });
  });

  it('requests one extra row and reports nextCursor when a next page exists', async () => {
    // 25 rows back for a page size of 24 signals "there's more".
    mockPrisma.walk.findMany.mockResolvedValue(Array.from({ length: 25 }, (_, i) => fakeWalk(`w${i}`)));

    const res = await request(app).get('/api/walks').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.walks).toHaveLength(24);
    expect(res.body.nextCursor).toBe('w23');
    expect(mockPrisma.walk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 })
    );
  });

  it('reports nextCursor: null when there is no further page', async () => {
    mockPrisma.walk.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => fakeWalk(`w${i}`)));

    const res = await request(app).get('/api/walks').set('Cookie', cookie);

    expect(res.body.walks).toHaveLength(5);
    expect(res.body.nextCursor).toBeNull();
  });

  it('passes the cursor query param through to Prisma for the next page', async () => {
    mockPrisma.walk.findMany.mockResolvedValue([]);

    await request(app).get('/api/walks?cursor=w23').set('Cookie', cookie);

    expect(mockPrisma.walk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'w23' }, skip: 1 })
    );
  });

  it('orders by date desc with id as a tiebreaker for stable cursor pagination', async () => {
    mockPrisma.walk.findMany.mockResolvedValue([]);
    await request(app).get('/api/walks').set('Cookie', cookie);
    expect(mockPrisma.walk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ date: 'desc' }, { id: 'desc' }] })
    );
  });
});
