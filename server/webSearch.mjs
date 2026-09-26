import { createHash } from 'node:crypto';
import { getCached, setCached, getStale } from './searchCache.mjs';
const SERPAPI_URL = 'https://serpapi.com/search.json';
const MAX_RESULTS = 5;

// Without a recency filter, Google's default ranking for these queries
// surfaces evergreen SEO/reference pages (tradingeconomics.com, goldprice.org)
// ahead of actual news — verified: on an ordinary run, 3 of 5 top organic
// results had no date at all and one was a 4-month-old article, while the
// same query with tbs=qdr:d returned exclusively same-day news with named
// events and figures. `qdr:d` restricts to results from the past 24 hours,
// which is what a daily gold-market analysis actually needs.
const RECENCY_FILTER = 'qdr:d';

// analyze.mjs runs several of these in parallel and awaits all of them before
// ever calling the LLM — an unbounded fetch here means a slow or half-
// unreachable SerpAPI (seen in practice: IPv6 route failures before falling
// back to IPv4) can stall the entire analysis well past the frontend's
// request timeout. Each caller already treats a thrown/rejected query as "no
// results from this query" via .catch(() => []), so timing out here is safe.
// Measured cold (real) search latency is 100-200ms per query (GOLD_COCKPIT_SPEED_PLAN.md
// NOTES) — 3s leaves 15-30x headroom over normal operation while bounding a slow/unreachable
// SerpAPI far tighter than the old 8s (which is what produced this repo's one ~8000ms outlier).
const SEARCH_TIMEOUT_MS = 3000;

export async function searchWeb(query, apiKey, metrics) {
  const key = `${RECENCY_FILTER}:${createHash('sha256').update(apiKey).digest('hex')}:${query}`;
  const cached = getCached(key);
  if (cached) { if(metrics)metrics.cacheHits++; return cached; }
  if(metrics)metrics.cacheMisses++;
  const url = `${SERPAPI_URL}?engine=google&num=${MAX_RESULTS}&q=${encodeURIComponent(query)}&tbs=${RECENCY_FILTER}&api_key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    let response, data;
    try {
      response = await fetch(url, { signal: controller.signal });
      data = await response.json();
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);

    const results = data?.organic_results || [];
    const normalized = results.slice(0, MAX_RESULTS).map((r) => ({
      title: r.title || '',
      snippet: r.snippet || '',
      link: r.link || '',
      date: r.date || '',
    }));
    setCached(key, normalized);
    return normalized;
  } catch (err) {
    // A timeout or any other fetch/API failure falls back to the last successful results for
    // this exact query (up to 24h old, see searchCache.mjs's getStale) rather than surfacing no
    // evidence at all — the caller (evidence.mjs) already tolerates this as a normal facet.
    const stale = getStale(key);
    if (stale) {
      if (metrics) metrics.staleFallbackAt = Math.min(metrics.staleFallbackAt ?? Infinity, stale.fetchedAt);
      return stale.value;
    }
    throw err;
  }
}
