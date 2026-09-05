import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listOpenAICompatibleModels,
  listAnthropicModels,
  listProviderModels,
} from '../../server/providers/listModels.mjs';

describe('listOpenAICompatibleModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs {baseUrl}/models with an Authorization header and returns sorted model ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'ada' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listOpenAICompatibleModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });

    expect(models).toEqual(['ada', 'gpt-4o', 'gpt-4o-mini']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
  });

  it('omits the Authorization header when no apiKey is given (OpenRouter/Ollama case)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await listOpenAICompatibleModels({ baseUrl: 'http://localhost:11434/v1', apiKey: null });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('throws with the provider error message on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listOpenAICompatibleModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'bad' })
    ).rejects.toThrow('invalid api key');
  });

  it('returns an empty array when the response has no data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listOpenAICompatibleModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });

    expect(models).toEqual([]);
  });

  it('rejects private-network base URLs to prevent SSRF', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listOpenAICompatibleModels({ baseUrl: 'http://127.0.0.1:8080/v1', apiKey: null })
    ).rejects.toThrow(/blocked/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listAnthropicModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs the Anthropic models endpoint with x-api-key and anthropic-version headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listAnthropicModels({ apiKey: 'sk-ant-test' });

    expect(models).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect(options.headers['x-api-key']).toBe('sk-ant-test');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('throws with the provider error message on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'authentication_error' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAnthropicModels({ apiKey: 'bad' })).rejects.toThrow('authentication_error');
  });
});

describe('listProviderModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches claude rows to listAnthropicModels', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'claude-sonnet-4-6' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels({ provider_type: 'claude', api_key: 'sk-ant-test' });

    expect(models).toEqual(['claude-sonnet-4-6']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models');
  });

  it('returns an empty array for the shared tier without making a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels({ provider_type: 'shared' });

    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the provider_type default base URL when base_url is not set (e.g. ollama)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels({ provider_type: 'ollama', api_key: null, base_url: null });

    expect(models).toEqual(['llama3.1']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/models');
  });

  it('uses the row base_url for a custom provider_type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gemini-3.6-flash' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels({
      provider_type: 'custom',
      api_key: 'k',
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });

    expect(models).toEqual(['gemini-3.6-flash']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
  });
});
