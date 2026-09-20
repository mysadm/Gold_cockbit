export function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const t = now();
    const key = req.ip || 'unknown';
    const recent = (hits.get(key) || []).filter((ts) => ts > t - windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil((recent[0] + windowMs - t) / 1000)));
      return res.status(429).json({ error: 'Too many attempts, try again later' });
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, list] of hits) if (list.every((ts) => ts <= t - windowMs)) hits.delete(k);
    }
    next();
  };
}
