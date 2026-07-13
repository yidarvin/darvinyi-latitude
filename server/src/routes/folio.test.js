import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    walk: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    stop: { count: vi.fn() },
  },
}));

vi.mock('../db.js', () => ({ prisma: mockPrisma }));

const { default: folioRouter } = await import('./folio.js');
const { signToken, COOKIE_NAME } = await import('../lib/jwt.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', folioRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'Internal server error' }));
  return app;
}

function walk(overrides = {}) {
  return {
    title: 'Edge Conditions',
    locationName: 'Mission District, San Francisco',
    date: new Date(),
    timeOfDay: 'golden',
    styles: ['street'],
    durationMin: 90,
    distanceM: 2000,
    ...overrides,
  };
}

describe('GET /api/folio/insight', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'u@test.dev', createdAt: new Date() });
    mockPrisma.stop.count.mockResolvedValue(12);
  });

  it('computes totalDistanceKm from an aggregate over ALL walks, not just the 10 most recently fetched', async () => {
    // Simulate an 11th-walk user: findMany (capped at 10) returns less
    // distance than the true all-time sum the aggregate query returns.
    mockPrisma.walk.findMany.mockResolvedValue(Array.from({ length: 10 }, () => walk({ distanceM: 1000 })));
    mockPrisma.walk.count.mockResolvedValue(11);
    mockPrisma.walk.aggregate.mockResolvedValue({ _sum: { distanceM: 15000 } }); // all 11 walks

    const res = await request(app).get('/api/folio/insight').set('Cookie', `${COOKIE_NAME}=${signToken('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.totalDistanceKm).toBe(15);
    expect(mockPrisma.walk.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }), _sum: { distanceM: true } })
    );
  });

  it('handles a user with zero walks (no aggregate rows) without crashing', async () => {
    mockPrisma.walk.findMany.mockResolvedValue([]);
    mockPrisma.walk.count.mockResolvedValue(0);
    mockPrisma.walk.aggregate.mockResolvedValue({ _sum: { distanceM: null } });
    mockPrisma.stop.count.mockResolvedValue(0);

    const res = await request(app).get('/api/folio/insight').set('Cookie', `${COOKIE_NAME}=${signToken('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.totalDistanceKm).toBe(0);
  });

  it('only claims "three different neighborhoods" when the neighborhoods are actually distinct', async () => {
    mockPrisma.walk.findMany.mockResolvedValue([
      // Distinct timeOfDay per walk so this doesn't incidentally trip the
      // "gravitated toward X light" branch instead of the one under test.
      walk({ locationName: 'Mission, SF', timeOfDay: 'golden' }),
      walk({ locationName: 'Dogpatch, SF', timeOfDay: 'morning' }),
      walk({ locationName: 'Mission, SF', timeOfDay: 'midday' }), // duplicate — only 2 unique, not 3
    ]);
    mockPrisma.walk.count.mockResolvedValue(3);
    mockPrisma.walk.aggregate.mockResolvedValue({ _sum: { distanceM: 6000 } });

    const res = await request(app).get('/api/folio/insight').set('Cookie', `${COOKIE_NAME}=${signToken('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.insight.text).not.toMatch(/Three different neighborhoods/);
  });

  it('claims "three different neighborhoods" when they genuinely are distinct', async () => {
    mockPrisma.walk.findMany.mockResolvedValue([
      walk({ locationName: 'Mission, SF', timeOfDay: 'golden' }),
      walk({ locationName: 'Dogpatch, SF', timeOfDay: 'morning' }),
      walk({ locationName: 'Presidio, SF', timeOfDay: 'midday' }),
    ]);
    mockPrisma.walk.count.mockResolvedValue(3);
    mockPrisma.walk.aggregate.mockResolvedValue({ _sum: { distanceM: 6000 } });

    const res = await request(app).get('/api/folio/insight').set('Cookie', `${COOKIE_NAME}=${signToken('user-1')}`);

    expect(res.status).toBe(200);
    expect(res.body.insight.text).toMatch(/Three different neighborhoods/);
  });
});
