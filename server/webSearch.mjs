import { createHash } from 'node:crypto';
import { getCached, setCached } from './searchCache.mjs';
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
const SEARCH_TIMEOUT_MS = 8000;

export async function searchWeb(query, apiKey) {
  const key = `${RECENCY_FILTER}:${createHash('sha256').update(apiKey).digest('hex')}:${query}`;
  const cached = getCached(key);
  if (cached) return cached;
  const url = `${SERPAPI_URL}?engine=google&num=${MAX_RESULTS}&q=${encodeURIComponent(query)}&tbs=${RECENCY_FILTER}&api_key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response, data;
  try {
    response = await fetch(url, { signal: controller.signal });
    data = await response.json();
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  const results = data?.organic_results || [];
  const normalized = results.slice(0, MAX_RESULTS).map((r) => ({
    title: r.title || '',
    snippet: r.snippet || '',
    link: r.link || '',
    date: r.date || '',
  }));
  setCached(key, normalized);
  return normalized;
}
