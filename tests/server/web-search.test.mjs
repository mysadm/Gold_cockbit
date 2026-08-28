import { describe, it, expect, afterEach, vi } from 'vitest';
import { searchWeb } from '../../server/webSearch.mjs';

describe('searchWeb', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns up to 5 organic results with title/snippet/link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [
          { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1' },
          { title: 'Central banks keep buying gold', snippet: 'Demand stays strong', link: 'https://example.com/2' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchWeb('gold price news', 'serp-test-key');

    expect(results).toEqual([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1', date: '' },
      { title: 'Central banks keep buying gold', snippet: 'Demand stays strong', link: 'https://example.com/2', date: '' },
    ]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('serpapi.com/search.json');
    expect(url).toContain('api_key=serp-test-key');
    expect(url).toContain('q=gold%20price%20news');
  });

  it('restricts results to the past 24 hours so evergreen/stale pages do not outrank actual news', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organic_results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb('gold price news', 'serp-test-key');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('tbs=qdr:d');
  });

  it('carries through the result date when SerpAPI provides one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [
          { title: 'Gold falls on Fed comments', snippet: 'Prices dropped 2%', link: 'https://example.com/1', date: '4 hours ago' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchWeb('gold price news', 'serp-test-key');

    expect(results[0].date).toBe('4 hours ago');
  });

  it('returns an empty array when there are no organic results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchWeb('obscure query', 'serp-test-key');

    expect(results).toEqual([]);
  });

  it('throws when the SerpAPI request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid API key' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchWeb('gold price news', 'bad-key')).rejects.toThrow('Invalid API key');
  });

  it('caps results at 5 even when SerpAPI returns more', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i}`,
          snippet: `Snippet ${i}`,
          link: `https://example.com/${i}`,
        })),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchWeb('gold price news', 'serp-test-key');

    expect(results).toHaveLength(5);
  });
});
