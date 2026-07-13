import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateLimit, __testing } from './rateLimit.js';

function fakeReqRes(userId) {
  const req = { user: userId ? { id: userId } : undefined };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  return { req, res, next };
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    __testing.buckets.clear();
  });

  it('allows requests under the limit and blocks the one that exceeds it', () => {
    const mw = rateLimit('test-key', 2, 60_000);
    const { req, res, next } = fakeReqRes('user-a');

    mw(req, res, next); // 1
    mw(req, res, next); // 2
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();

    mw(req, res, next); // 3 — over the limit
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('skips unauthenticated requests entirely (no req.user)', () => {
    const mw = rateLimit('test-key', 1, 60_000);
    const { req, res, next } = fakeReqRes(undefined);
    mw(req, res, next);
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('tracks separate buckets per key and per user', () => {
    const mwA = rateLimit('key-a', 1, 60_000);
    const mwB = rateLimit('key-b', 1, 60_000);
    const user1 = fakeReqRes('user-1');
    const user2 = fakeReqRes('user-2');

    mwA(user1.req, user1.res, user1.next);
    mwB(user1.req, user1.res, user1.next); // different key, same user — not blocked
    mwA(user2.req, user2.res, user2.next); // different user, same key — not blocked

    expect(user1.next).toHaveBeenCalledTimes(2);
    expect(user2.next).toHaveBeenCalledTimes(1);
  });

  it('sweep evicts buckets that are entirely stale, without touching live ones', () => {
    const mw = rateLimit('sweep-key', 5, 60_000);
    const stale = fakeReqRes('stale-user');
    mw(stale.req, stale.res, stale.next);
    expect(__testing.buckets.has('sweep-key:stale-user')).toBe(true);

    // Rewrite the recorded timestamp to be far in the past, simulating a
    // user who hit the endpoint once and never came back.
    __testing.buckets.set('sweep-key:stale-user', [Date.now() - 24 * 60 * 60 * 1000]);

    const live = fakeReqRes('live-user');
    mw(live.req, live.res, live.next);

    __testing.sweep();

    expect(__testing.buckets.has('sweep-key:stale-user')).toBe(false);
    expect(__testing.buckets.has('sweep-key:live-user')).toBe(true);
  });
});
