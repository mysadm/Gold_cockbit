import { describe, it, expect, afterEach, vi } from 'vitest';
import { callOpenAICompatible } from '../../server/providers/openaiCompatible.mjs';

describe('callOpenAICompatible', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to {baseUrl}/chat/completions with an Authorization header when apiKey is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"one_liner":"ok"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatible({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      prompt: 'analyze',
    });

    expect(result).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(options.body)).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'analyze' }],
      max_tokens: 4000,
    });
  });

  it('omits the Authorization header when apiKey is not set (Ollama case)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"one_liner":"local"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAICompatible({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      model: 'llama3.1',
      prompt: 'analyze',
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('rejects private-network destinations to prevent SSRF', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'http://127.0.0.1:8080/v1', apiKey: null, model: 'llama3.1', prompt: 'x' })
    ).rejects.toThrow(/blocked/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with the provider error message on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'https://api.openai.com/v1', apiKey: 'bad', model: 'gpt-4o', prompt: 'x' })
    ).rejects.toThrow('invalid api key');
  });

  it('throws with an HTTP status message when the error body has no message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'http://localhost:11434/v1', apiKey: null, model: 'llama3.1', prompt: 'x' })
    ).rejects.toThrow('HTTP 503');
  });
});
