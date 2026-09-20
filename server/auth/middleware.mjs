import { SESSION_COOKIE, parseCookies, findActiveUserBySession } from './sessions.mjs';

export function createRequireAuth(db) {
  return async function requireAuth(req, res, next) {
    try {
      const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
      const user = token ? await findActiveUserBySession(db, token) : null;
      if (!user) return res.status(401).json({ error: 'Not signed in' });
      req.user = user;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// The router factories take a fixed (db, userId); this builds one per logged-in
// user on first use and delegates, so no router needs to know about sessions.
export function perUserRouter(factory) {
  const cache = new Map();
  return function perUser(req, res, next) {
    let router = cache.get(req.user.id);
    if (!router) {
      router = factory(req.user.id);
      cache.set(req.user.id, router);
    }
    router(req, res, next);
  };
}
