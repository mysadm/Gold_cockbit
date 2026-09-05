import { describe, it, expect, afterEach, vi } from 'vitest';
import { listModelsForDraft, listModelsById } from '../../src/api/llmProviders';

describe('listModelsForDraft', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the draft fields to /api/llm-providers/models and returns the model list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ['gpt-4o', 'gpt-4o-mini'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listModelsForDraft({ provider_type: 'openai', api_key: 'sk-test' });

    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/llm-providers/models');
    expect(JSON.parse(options.body)).toEqual({ provider_type: 'openai', api_key: 'sk-test' });
  });

  it('throws with the server error message on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'invalid api key' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listModelsForDraft({ provider_type: 'openai', api_key: 'bad' })).rejects.toThrow('invalid api key');
  });
});

describe('listModelsById', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /api/llm-providers/:id/models and returns the model list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ['claude-sonnet-4-6'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listModelsById(42);

    expect(models).toEqual(['claude-sonnet-4-6']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm-providers/42/models');
  });
});
