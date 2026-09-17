import { searchWeb } from './webSearch.mjs';

export const WEB_SEARCH_QUERIES = [
  'gold price today news drivers', 'Fed interest rate policy decision',
  'central bank gold buying reserves',
  'geopolitical tensions news today Iran Russia Ukraine',
  'Egypt EGP exchange rate gold price today',
];
function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
const bounded = (s, n) => String(s ?? '').replace(/https?:\/\/\S+/g, '').slice(0, n);

export async function collectEvidence(provider, search = searchWeb) {
  const empty = (searchStatus) => ({ searchStatus, usedWebSearch: false, evidenceIds: [], evidenceSources: [], evidencePack: [] });
  if (provider.settings?.webSearch === false) return empty('disabled');
  if (!process.env.SERPAPI_API_KEY) return empty('no_api_key');
  const settled = await Promise.allSettled(WEB_SEARCH_QUERIES.map(q => search(q, process.env.SERPAPI_API_KEY)));
  const failures = settled.filter(r => r.status === 'rejected').length;
  const seen = new Set();
  const facets = settled.map(result => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return [];
    return result.value.flatMap(row => {
      const link = canonicalUrl(row.link);
      if (!link || seen.has(link)) return [];
      seen.add(link);
      return [{ title: bounded(row.title, 160), date: bounded(row.date, 60), snippet: bounded(row.snippet, 320), link }];
    }).slice(0, 2);
  });
  const selected = [0, 1].flatMap(i => facets.flatMap(rows => rows[i] ? [rows[i]] : []));
  if (!selected.length) return empty(failures ? 'failed' : 'no_results');
  const rows = selected.map((row, i) => ({ ...row, id: `EV-${String(i + 1).padStart(3, '0')}` }));
  return {
    searchStatus: failures ? 'partial' : 'ok', usedWebSearch: true,
    evidenceIds: rows.map(r => r.id),
    evidenceSources: rows.map(({ snippet, ...source }) => source),
    evidencePack: rows.map(({ link, ...evidence }) => evidence),
  };
}
