/**
 * Per-user in-memory rate limiter.
 * Sliding window: max `n` events in the last `windowMs` per user id.
 *
 * Lightweight. For Railway single-instance deploys this is fine.
 * For multi-instance you'd swap in Redis later.
 */
const buckets = new Map(); // "key:userId" -> [ts, ts, ...]

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
// A bucket is only filtered (and possibly emptied) when that exact
// key+user is hit again — a user who hits an endpoint once and never
// returns would otherwise leave a stale entry in memory forever. Track the
// widest window registered across all rateLimit() call sites and sweep on
// that cadence so idle buckets get reclaimed even with no further access.
let widestWindowMs = 0;

function sweep() {
  const now = Date.now();
  for (const [bucketKey, timestamps] of buckets) {
    const live = timestamps.filter(t => now - t < widestWindowMs);
    if (live.length === 0) buckets.delete(bucketKey);
    else buckets.set(bucketKey, live);
  }
}

const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
sweepTimer.unref(); // a housekeeping timer shouldn't hold the process open on its own

export function rateLimit(key, n, windowMs) {
  widestWindowMs = Math.max(widestWindowMs, windowMs);

  return (req, res, next) => {
    if (!req.user?.id) return next();
    const bucketKey = `${key}:${req.user.id}`;
    const now = Date.now();
    const bucket = (buckets.get(bucketKey) || []).filter(t => now - t < windowMs);
    if (bucket.length >= n) {
      const retry = Math.ceil((windowMs - (now - bucket[0])) / 1000);
      return res.status(429).json({
        error: `Too many requests. Try again in ${retry}s.`,
      });
    }
    bucket.push(now);
    buckets.set(bucketKey, bucket);
    next();
  };
}

// Exposed for tests only — direct introspection of the sweep mechanism
// without needing to fight the module-level setInterval with fake timers.
export const __testing = { buckets, sweep };
