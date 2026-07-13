import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const { mockPrisma, mockModelsList } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
  mockModelsList: vi.fn(),
}));

vi.mock('../db.js', () => ({ prisma: mockPrisma }));
// Signup does a cheap live call to validate the key — mock it so tests never
// touch the real network and can control the accept/reject outcome.
vi.mock('@anthropic-ai/sdk', () => ({
  // A real function (not an arrow) so `new Anthropic(...)` works — an arrow
  // implementation has no [[Construct]], so `new` on it silently produces a
  // value whose .models is undefined, and every call would then throw a
  // plain TypeError instead of exercising the mocked list()/rejection.
  default: vi.fn(function Anthropic() {
    return { models: { list: mockModelsList } };
  }),
}));

function buildApp(authRouter) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal server error' });
  });
  return app;
}

describe('auth rate limiting', () => {
  it('returns 429 once the per-IP attempt budget is exhausted, before that IP hits 401 forever', async () => {
    // Fresh module graph so this run's rate-limit counters start clean,
    // regardless of test order or shared IP across supertest requests.
    vi.resetModules();
    mockPrisma.user.findUnique.mockResolvedValue(null); // unknown email → every attempt 401s until rate-limited
    const { default: authRouter } = await import('./auth.js');
    const app = buildApp(authRouter);

    const results = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'whatever123' });
      results.push(res.status);
    }

    expect(results.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(results[10]).toBe(429);
  }, 20000);
});

describe('auth validation and behavior', () => {
  let authRouter, app;

  beforeEach(async () => {
    // Fresh module + fresh rate-limit counters per test, so these don't
    // share a budget with each other or with the exhaustion test above.
    vi.resetModules();
    vi.clearAllMocks();
    mockModelsList.mockResolvedValue({ data: [] });
    ({ default: authRouter } = await import('./auth.js'));
    app = buildApp(authRouter);
  });

  it('rejects a signup password longer than 72 characters (bcrypt silently truncates beyond that)', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@test.dev',
      password: 'x'.repeat(73),
      anthropicApiKey: 'sk-ant-' + 'a'.repeat(20),
    });
    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('creates an account and sets a session cookie on valid signup', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'u1', email: 'new@test.dev', createdAt: new Date() });

    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@test.dev',
      password: 'a-fine-password',
      anthropicApiKey: 'sk-ant-' + 'a'.repeat(20),
    });

    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toBeTruthy();
  });

  it('rejects signup when Anthropic reports the API key as invalid', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockModelsList.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));

    const res = await request(app).post('/api/auth/signup').send({
      email: 'new@test.dev',
      password: 'a-fine-password',
      anthropicApiKey: 'sk-ant-' + 'a'.repeat(20),
    });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('does not block signup when the live key check fails for a non-auth reason (network blip)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'u2', email: 'new2@test.dev', createdAt: new Date() });
    mockModelsList.mockRejectedValue(new Error('ETIMEDOUT'));

    const res = await request(app).post('/api/auth/signup').send({
      email: 'new2@test.dev',
      password: 'a-fine-password',
      anthropicApiKey: 'sk-ant-' + 'a'.repeat(20),
    });

    expect(res.status).toBe(201);
  });

  it('returns a generic 401 for an unknown email, not a distinguishable error', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'whatever123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns the same generic 401 for a known email with the wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'known@test.dev',
      passwordHash: await (await import('bcryptjs')).default.hash('correct-password', 12),
      createdAt: new Date(),
    });
    const res = await request(app).post('/api/auth/login').send({ email: 'known@test.dev', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});

describe('account trust surface', () => {
  let authRouter, app, signToken, COOKIE_NAME;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockModelsList.mockResolvedValue({ data: [] });
    ({ default: authRouter } = await import('./auth.js'));
    ({ signToken, COOKIE_NAME } = await import('../lib/jwt.js'));
    app = buildApp(authRouter);
  });

  it('requires auth to remove the API key', async () => {
    const res = await request(app).delete('/api/auth/api-key');
    expect(res.status).toBe(401);
  });

  it('nulls the API key columns on remove', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@test.dev', createdAt: new Date() });
    mockPrisma.user.update.mockResolvedValue({});
    const res = await request(app)
      .delete('/api/auth/api-key')
      .set('Cookie', `${COOKIE_NAME}=${signToken('u1')}`);
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { apiKeyCipher: null, apiKeyNonce: null, apiKeyAuthTag: null },
    });
  });

  it('rejects account deletion with the wrong password, without deleting anything', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@test.dev', createdAt: new Date(),
      passwordHash: await bcrypt.hash('correct-password', 12),
    });
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `${COOKIE_NAME}=${signToken('u1')}`)
      .send({ password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('deletes the account and clears the session cookie with the correct password', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@test.dev', createdAt: new Date(),
      passwordHash: await bcrypt.hash('correct-password', 12),
    });
    mockPrisma.user.delete.mockResolvedValue({});
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `${COOKIE_NAME}=${signToken('u1')}`)
      .send({ password: 'correct-password' });
    expect(res.status).toBe(200);
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(res.headers['set-cookie'][0]).toMatch(new RegExp(`^${COOKIE_NAME}=;`));
  });
});
