/**
 * Per-user in-memory rate limiter.
 * Sliding window: max `n` events in the last `windowMs` per user id.
 *
 * Lightweight. For Railway single-instance deploys this is fine.
 * For multi-instance you'd swap in Redis later.
 */
const buckets = new Map(); // userId -> [ts, ts, ...]

export function rateLimit(key, n, windowMs) {
  return (req, res, next) => {
    if (!req.user?.id) return next();
    const userId = req.user.id;
    const now = Date.now();
    const bucket = (buckets.get(`${key}:${userId}`) || []).filter(t => now - t < windowMs);
    if (bucket.length >= n) {
      const retry = Math.ceil((windowMs - (now - bucket[0])) / 1000);
      return res.status(429).json({
        error: `Too many requests. Try again in ${retry}s.`,
      });
    }
    bucket.push(now);
    buckets.set(`${key}:${userId}`, bucket);
    next();
  };
}
