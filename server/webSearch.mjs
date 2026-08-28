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

export async function searchWeb(query, apiKey) {
  const url = `${SERPAPI_URL}?engine=google&num=${MAX_RESULTS}&q=${encodeURIComponent(query)}&tbs=${RECENCY_FILTER}&api_key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  const results = data?.organic_results || [];
  return results.slice(0, MAX_RESULTS).map((r) => ({
    title: r.title || '',
    snippet: r.snippet || '',
    link: r.link || '',
    date: r.date || '',
  }));
}
