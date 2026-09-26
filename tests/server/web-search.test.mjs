import { describe, it, expect, afterEach, vi } from 'vitest';
import { searchWeb } from '../../server/webSearch.mjs';
import { clearSearchCache } from '../../server/searchCache.mjs';

describe('searchWeb', () => {
  afterEach(() => {
    clearSearchCache();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reuses successful results until expiry but never caches empty results', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organic_results: [{ title: 'News', link: 'https://example.com' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const first = await searchWeb('cache', 'key');
    expect(await searchWeb('cache', 'key')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600000);
    await searchWeb('cache', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ organic_results: [] }) });
    await searchWeb('empty', 'key');
    await searchWeb('empty', 'key');
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

  it('throws when the SerpAPI request fails and there is no prior result to fall back to', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid API key' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchWeb('gold price news', 'bad-key')).rejects.toThrow('Invalid API key');
  });

  it('falls back to the last successful (stale) results on timeout instead of throwing', async () => {
    vi.useFakeTimers();
    const good = [{ title: 'Old but usable', snippet: 's', link: 'https://example.com/1', date: '' }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: good }) })
      // Second call: hangs until the AbortController fires, like a real fetch would.
      .mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await searchWeb('stale-query', 'key');
    expect(first).toEqual(good);

    vi.advanceTimersByTime(600_000); // past the 10 min TTL: next call is a real (miss) fetch
    const pending = searchWeb('stale-query', 'key');
    await vi.advanceTimersByTimeAsync(3000); // past SEARCH_TIMEOUT_MS: aborts and falls back
    await expect(pending).resolves.toEqual(good);
  });

  it('falls back on a non-timeout failure too (e.g. a bad API key mid-outage), not just an abort', async () => {
    const good = [{ title: 'Old but usable', snippet: 's', link: 'https://example.com/1', date: '' }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: good }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'HTTP 500' }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb('flaky-query', 'key');
    vi.useFakeTimers();
    vi.advanceTimersByTime(600_000);
    await expect(searchWeb('flaky-query', 'key')).resolves.toEqual(good);
  });

  it('does not fall back once the stale entry is older than 24h', async () => {
    vi.useFakeTimers();
    const good = [{ title: 'Too old now', snippet: 's', link: 'https://example.com/1', date: '' }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: good }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'still down' }) });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb('aging-query', 'key');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await expect(searchWeb('aging-query', 'key')).rejects.toThrow('still down');
  });

  it('records the stale entry\'s original fetch time on metrics.staleFallbackAt', async () => {
    vi.useFakeTimers();
    const good = [{ title: 'x', snippet: 's', link: 'https://example.com/1', date: '' }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: good }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'down' }) });
    vi.stubGlobal('fetch', fetchMock);

    const fetchedAt = Date.now();
    await searchWeb('metrics-query', 'key');
    vi.advanceTimersByTime(600_000);
    const metrics = {};
    await searchWeb('metrics-query', 'key', metrics);
    expect(metrics.staleFallbackAt).toBe(fetchedAt);
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
