// Server-side port of the browser's live price feeds (`pullLive` in src/App.tsx).
// Feed order, value ranges (gold 1000-20000, USD/EGP 20-200), the 6 s timeout
// and the FX fallback chain are copied verbatim so the scheduled analysis sees
// the same market the user's browser would.

const FEED_TIMEOUT_MS = 6000;

const JSDELIVR_USD_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';

function withTimeout(promise, ms = FEED_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function fetchMarketPrices({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const goldFeeds = [
    { name: 'gold-api', fn: async () => {
      const r = await fetchImpl('https://api.gold-api.com/price/XAU');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return Number(j.price);
    } },
    { name: 'goldprice.org', fn: async () => {
      const r = await fetchImpl('https://data-asg.goldprice.org/dbXRates/USD');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return Number(j?.items?.[0]?.xauPrice);
    } },
    { name: 'binance-paxg', fn: async () => {
      const r = await fetchImpl('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return Number(j.price);
    } },
    { name: 'jsdelivr-daily', fn: async () => {
      const r = await fetchImpl(JSDELIVR_USD_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const perUsd = Number(j?.usd?.xau);
      return perUsd ? 1 / perUsd : 0;
    } },
  ];

  const diag = [];
  let goldValue = 0;
  let goldSource = '';
  for (const feed of goldFeeds) {
    try {
      const value = await withTimeout(feed.fn());
      if (value && value > 1000 && value < 20000) {
        goldValue = value;
        goldSource = feed.name;
        diag.push(`${feed.name}: OK ($${Math.round(value)})`);
        break;
      }
      diag.push(`${feed.name}: bad value`);
    } catch (error) {
      diag.push(`${feed.name}: ${error?.message || 'error'}`);
    }
  }
  if (!goldValue) throw new Error(`No gold price feed answered: ${diag.join('; ')}`);

  const fxFeeds = [
    { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', pick: (j) => Number(j?.rates?.EGP) },
    { name: 'jsdelivr-daily', url: JSDELIVR_USD_URL, pick: (j) => Number(j?.usd?.egp) },
  ];
  const fxDiag = [];
  let fxValue = 0;
  for (const feed of fxFeeds) {
    try {
      const value = await withTimeout((async () => {
        const r = await fetchImpl(feed.url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return feed.pick(await r.json());
      })());
      if (value && value > 20 && value < 200) {
        fxValue = value;
        break;
      }
      fxDiag.push(`${feed.name}: bad value`);
    } catch (error) {
      fxDiag.push(`${feed.name}: ${error?.message || 'error'}`);
    }
  }
  if (!fxValue) throw new Error(`No USD/EGP feed answered: ${fxDiag.join('; ')}`);

  return {
    spot: Math.round(goldValue),
    usdEgp: round2(fxValue),
    goldSource,
    retrievedAt: now().toISOString(),
  };
}
