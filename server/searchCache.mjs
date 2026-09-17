const TTL = 10 * 60 * 1000;
const entries = new Map();
export function getCached(key) {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expires) { entries.delete(key); return undefined; }
  return structuredClone(entry.value);
}
export function setCached(key, value) {
  if (!value.length) return;
  // Bound memory even if callers eventually supply custom queries.
  if (entries.size >= 100) entries.delete(entries.keys().next().value);
  entries.set(key, { value: structuredClone(value), expires: Date.now() + TTL });
}
export function clearSearchCache() { entries.clear(); }
