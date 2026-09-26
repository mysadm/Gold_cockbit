const TTL = 10 * 60 * 1000;
// A stale (expired) entry is still usable as a last-resort fallback when a fresh fetch fails,
// but only up to this age — see getStale and server/webSearch.mjs's timeout/error handling.
const STALE_MAX_AGE = 24 * 60 * 60 * 1000;
const entries = new Map();
export function getCached(key) {
  const entry = entries.get(key);
  if (!entry) return undefined;
  // No longer fresh, but kept (not deleted) so getStale can still fall back to it.
  if (Date.now() >= entry.expires) return undefined;
  return structuredClone(entry.value);
}
export function getStale(key) {
  const entry = entries.get(key);
  if (!entry || Date.now() - entry.fetchedAt > STALE_MAX_AGE) return undefined;
  return { value: structuredClone(entry.value), fetchedAt: entry.fetchedAt };
}
export function setCached(key, value) {
  if (!value.length) return;
  // Bound memory even if callers eventually supply custom queries.
  if (entries.size >= 100) entries.delete(entries.keys().next().value);
  entries.set(key, { value: structuredClone(value), expires: Date.now() + TTL, fetchedAt: Date.now() });
}
export function clearSearchCache() { entries.clear(); }
