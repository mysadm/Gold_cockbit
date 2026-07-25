import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseIsaghaGoldTable, fetchEgyptGoldPrices, __resetIsaghaCache } from '../../server/isaghaPrices.mjs';

const fixturePath = fileURLToPath(new URL('../fixtures/isagha-prices-gold-table.html', import.meta.url));
const fixtureHtml = readFileSync(fixturePath, 'utf8');

describe('parseIsaghaGoldTable', () => {
  it('parses each karat row with sell/buy prices from a real captured iSagha page', () => {
    const rows = parseIsaghaGoldTable(fixtureHtml);

    const k24 = rows.find((row) => row.karat === '24k');
    expect(k24).toEqual(
      expect.objectContaining({ karat: '24k', sell: 6857.25, buy: 6800, changeAmount: 5.71, changePct: 0.08 })
    );

    const k21 = rows.find((row) => row.karat === '21k');
    expect(k21).toEqual(expect.objectContaining({ karat: '21k', sell: 6000, buy: 5950 }));
  });

  it('parses the gold pound coin row', () => {
    const rows = parseIsaghaGoldTable(fixtureHtml);
    const coin = rows.find((row) => row.karat === 'gold_pound');
    expect(coin).toEqual(expect.objectContaining({ karat: 'gold_pound', sell: 48000, buy: 47600 }));
  });

  it('does not include the troy ounce row (USD-denominated, out of scope)', () => {
    const rows = parseIsaghaGoldTable(fixtureHtml);
    expect(rows.find((row) => row.karat === 'ounce')).toBeUndefined();
  });

  it('returns an empty array when the table structure is not present', () => {
    expect(parseIsaghaGoldTable('<html><body>no table here</body></html>')).toEqual([]);
  });
});

describe('fetchEgyptGoldPrices', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetIsaghaCache();
  });

  it('fetches and parses live prices, tagging the fetchedAt timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => fixtureHtml });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEgyptGoldPrices();

    expect(fetchMock).toHaveBeenCalledWith('https://market.isagha.com/prices', expect.any(Object));
    expect(result.source).toBe('isagha.com');
    expect(result.fetchedAt).toBeTypeOf('string');
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('serves the cached result on a second call within the cache window, without re-fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => fixtureHtml });
    vi.stubGlobal('fetch', fetchMock);

    await fetchEgyptGoldPrices();
    await fetchEgyptGoldPrices();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when the upstream page cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(fetchEgyptGoldPrices()).rejects.toThrow('HTTP 503');
  });

  it('throws a clear error when the page no longer parses (upstream layout changed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html></html>' }));

    await expect(fetchEgyptGoldPrices()).rejects.toThrow(/could not parse/i);
  });
});
