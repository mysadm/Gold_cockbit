const SERPAPI_URL = 'https://serpapi.com/search.json';
const MAX_RESULTS = 5;

export async function searchWeb(query, apiKey) {
  const url = `${SERPAPI_URL}?engine=google&num=${MAX_RESULTS}&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
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
  }));
}
