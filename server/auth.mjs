export function createApiKeyAuthMiddleware() {
  return function requireApiKey(req, res, next) {
    const expectedApiKey = process.env.GOLD_COCKPIT_API_KEY;

    if (!expectedApiKey) {
      return next();
    }

    const providedApiKey = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (providedApiKey === expectedApiKey) {
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized' });
  };
}
