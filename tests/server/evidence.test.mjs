import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectEvidence } from '../../server/evidence.mjs';
afterEach(() => vi.unstubAllEnvs());
describe('provider-neutral evidence', () => {
  it('preserves partial successes, bounds input and rejects unsafe URLs', async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'test');
    const search = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue([
      { title:'News', snippet:'x'.repeat(600), link:'https://example.com/news?utm_source=x', date:'today' },
      { title:'unsafe', link:'javascript:alert(1)' },
    ]);
    const result = await collectEvidence({}, search);
    expect(result.searchStatus).toBe('partial');
    expect(result.evidenceSources).toHaveLength(1);
    expect(result.evidenceSources[0].link).toBe('https://example.com/news');
    expect(result.evidencePack[0].snippet).toHaveLength(320);
    expect(JSON.stringify(result.evidencePack)).not.toContain('https://');
  });
  it('keeps identical ordering across all provider types and caps each facet', async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'test');
    const search = async q => Array.from({length:5}, (_,i) => ({title:q,link:`https://example.com/${encodeURIComponent(q)}/${i}`}));
    const first = await collectEvidence({provider_type:'claude'}, search);
    expect(first.evidencePack).toHaveLength(10);
    for (const provider_type of ['shared','openai','openrouter','ollama','custom']) {
      expect(await collectEvidence({provider_type}, search)).toEqual(first);
    }
  });
  it.each(['disabled','no_api_key','no_results','failed'])('reports %s', async status => {
    vi.stubEnv('SERPAPI_API_KEY', status === 'no_api_key' ? '' : 'test');
    const result = await collectEvidence({ settings: {webSearch:status !== 'disabled'} }, async () => {
      if(status === 'failed') throw new Error('offline');
      return [];
    });
    expect(result.searchStatus).toBe(status);
    expect(result.usedWebSearch).toBe(false);
  });
});
