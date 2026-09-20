import { describe, it, expect } from 'vitest';
import { fetchMarketPrices } from '../../server/marketPrices.mjs';

const GOLD_API = 'https://api.gold-api.com/price/XAU';
const GOLDPRICE = 'https://data-asg.goldprice.org/dbXRates/USD';
const BINANCE = 'https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT';
const JSDELIVR = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
const ER_API = 'https://open.er-api.com/v6/latest/USD';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// routes: url -> body | Error | (() => Response|Promise). Unlisted urls reject (no network in tests).
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (!(url in routes)) throw new Error(`unexpected url ${url}`);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (typeof route === 'function') return route();
    return json(route);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const NOW = new Date('2026-09-20T10:00:00.000Z');
const now = () => NOW;
const okFx = { [ER_API]: { rates: { EGP: 48.567 } } };

describe('fetchMarketPrices', () => {
  it('returns the first valid gold feed, rounded like the browser, with FX and retrievedAt', async () => {
    const fetchImpl = fakeFetch({ [GOLD_API]: { price: 4523.6 }, ...okFx });
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out).toEqual({ spot: 4524, usdEgp: 48.57, goldSource: 'gold-api', retrievedAt: NOW.toISOString() });
    expect(fetchImpl.calls).toEqual([GOLD_API, ER_API]);
  });

  it('falls through when the first feed fails', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: new Error('boom'),
      [GOLDPRICE]: { items: [{ xauPrice: 4400.2 }] },
      ...okFx,
    });
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out.goldSource).toBe('goldprice.org');
    expect(out.spot).toBe(4400);
  });

  it('falls through when a feed returns an out-of-range low value (999)', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: { price: 999 },
      [GOLDPRICE]: new Error('down'),
      [BINANCE]: { price: '4350.5' },
      ...okFx,
    });
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out.goldSource).toBe('binance-paxg');
    expect(out.spot).toBe(4351);
  });

  it('rejects 25000 as out of range and uses the jsDelivr daily feed (inverse of XAU per USD)', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: { price: 25000 },
      [GOLDPRICE]: { items: [{ xauPrice: 20000 }] },
      [BINANCE]: { price: 1000 },
      [JSDELIVR]: { usd: { xau: 1 / 4200, egp: 47 } },
      [ER_API]: new Error('down'),
    });
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out.goldSource).toBe('jsdelivr-daily');
    expect(out.spot).toBe(4200);
    expect(out.usdEgp).toBe(47);
  });

  it('throws a clear error with diagnostics when every gold feed fails', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: new Error('boom'),
      [GOLDPRICE]: { items: [] },
      [BINANCE]: { price: 25000 },
      [JSDELIVR]: { usd: {} },
      ...okFx,
    });
    await expect(fetchMarketPrices({ fetchImpl, now })).rejects.toThrow(/^No gold price feed answered: .*gold-api: boom.*goldprice\.org: bad value/s);
  });

  it('uses the jsDelivr FX fallback when er-api fails', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: { price: 4500 },
      [ER_API]: new Error('down'),
      [JSDELIVR]: { usd: { egp: 49.123 } },
    });
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out.usdEgp).toBe(49.12);
  });

  it('uses the FX fallback when er-api answers with an out-of-range rate (20 < fx < 200)', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: { price: 4500 },
      [ER_API]: { rates: { EGP: 5 } },
      [JSDELIVR]: { usd: { egp: 50 } },
    });
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out.usdEgp).toBe(50);
  });

  it('throws when both FX feeds fail', async () => {
    const fetchImpl = fakeFetch({
      [GOLD_API]: { price: 4500 },
      [ER_API]: new Error('down'),
      [JSDELIVR]: { usd: { egp: 500 } },
    });
    await expect(fetchMarketPrices({ fetchImpl, now })).rejects.toThrow('No USD/EGP feed answered');
  });

  it('times out a hanging feed after 6 s and moves on', async () => {
    const never = () => new Promise(() => {});
    const fetchImpl = fakeFetch({ [GOLD_API]: never, [GOLDPRICE]: { items: [{ xauPrice: 4300 }] }, ...okFx });
    const started = Date.now();
    const out = await fetchMarketPrices({ fetchImpl, now });
    expect(out.goldSource).toBe('goldprice.org');
    expect(Date.now() - started).toBeGreaterThanOrEqual(5900);
  }, 15000);
});
