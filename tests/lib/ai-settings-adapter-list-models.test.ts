import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGoldCockpitAiAdapter } from '../../src/lib/aiSettingsAdapter';

// localStorage stub — module-level loadCustomProviders()/saveCustomProviders() calls
// touch it even though these tests don't exercise custom-provider persistence.
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

describe('aiSettingsAdapter.listModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches via GET /:id/models when context.connectionId is set (editing a saved connection)', async () => {
    stubLocalStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ['gpt-4o', 'gpt-4o-mini'] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createGoldCockpitAiAdapter();

    const models = await adapter.listModels('openai', { connectionId: '42' });

    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm-providers/42/models');
  });

  it('fetches via POST /models with the typed api key when context.apiKey is set (new/unsaved connection)', async () => {
    stubLocalStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ['claude-sonnet-4-6'] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createGoldCockpitAiAdapter();

    const models = await adapter.listModels('anthropic', { apiKey: 'sk-ant-test' });

    expect(models).toEqual(['claude-sonnet-4-6']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/llm-providers/models');
    const body = JSON.parse(options.body);
    expect(body).toEqual({ provider_type: 'claude', base_url: null, api_key: 'sk-ant-test' });
  });

  it('still attempts a live call with neither connectionId nor apiKey set, working for a keyless provider like OpenRouter', async () => {
    stubLocalStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ['openai/gpt-4o-mini'] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createGoldCockpitAiAdapter();

    const models = await adapter.listModels('openrouter', {});

    expect(models).toEqual(['openai/gpt-4o-mini']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm-providers/models');
  });

  it('falls back to the safety-net list when the live call fails', async () => {
    stubLocalStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'no key yet' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createGoldCockpitAiAdapter();

    const models = await adapter.listModels('gemini', {});

    expect(models.length).toBeGreaterThan(0);
  });

  it('falls back to the safety-net list when the live call returns an empty list', async () => {
    stubLocalStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createGoldCockpitAiAdapter();

    const models = await adapter.listModels('shared', {});

    expect(models).toEqual(['shared']);
  });
});
