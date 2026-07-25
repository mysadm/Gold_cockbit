const ISAGHA_PRICES_URL = 'https://market.isagha.com/prices';
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const KARAT_LABELS = {
  'عيار 24': '24k',
  'عيار 22': '22k',
  'عيار 21': '21k',
  'عيار 18': '18k',
  'جنيه ذهب': 'gold_pound',
};

function parseEgpNumber(cellHtml) {
  const match = cellHtml.match(/([\d.,]+)\s*ج\.م/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ''));
}

function parseChangeAmount(cellHtml) {
  const match = cellHtml.match(/(-?[\d.,]+)\s*ج\.م/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function parseChangePct(cellHtml) {
  const match = cellHtml.match(/(-?[\d.,]+)\s*%/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

// Schema-specific HTML parsing, not a generic HTML parser: iSagha's gold price
// table has a fixed 7-column row shape (purity, sell, sell-gap, buy, buy-gap,
// change amount, change %), so a targeted regex per row is more robust to
// their exact markup than pulling in a full DOM/HTML parser dependency.
export function parseIsaghaGoldTable(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const labelMatch = rowHtml.match(/<span>([^<]+)<\/span>\s*<\/span>\s*<\/td>/);
    if (!labelMatch) continue;
    const karat = KARAT_LABELS[labelMatch[1].trim()];
    if (!karat) continue; // skips the troy-ounce (USD) row and anything unrecognized

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 7) continue;

    const sell = parseEgpNumber(cells[1]);
    const buy = parseEgpNumber(cells[3]);
    if (sell === null || buy === null) continue;

    rows.push({
      karat,
      sell,
      buy,
      changeAmount: parseChangeAmount(cells[5]),
      changePct: parseChangePct(cells[6]),
    });
  }
  return rows;
}

let cache = null; // { rows, fetchedAt: number }

export function __resetIsaghaCache() {
  cache = null;
}

export async function fetchEgyptGoldPrices() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { source: 'isagha.com', fetchedAt: new Date(cache.fetchedAt).toISOString(), rows: cache.rows };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(ISAGHA_PRICES_URL, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch iSagha prices: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rows = parseIsaghaGoldTable(html);
  if (rows.length === 0) {
    throw new Error('Could not parse iSagha gold price table — the page layout may have changed');
  }

  cache = { rows, fetchedAt: Date.now() };
  return { source: 'isagha.com', fetchedAt: new Date(cache.fetchedAt).toISOString(), rows };
}
