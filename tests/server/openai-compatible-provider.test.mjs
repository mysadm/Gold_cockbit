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
      max_tokens: 16000,
    });
  });

  it('sends a continuation turn if the first reply has no JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'plain text, no braces' } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"one_liner":"continued"}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatible({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      model: 'gemma4',
      prompt: 'analyze',
    });

    expect(result).toEqual({ text: '{"one_liner":"continued"}', usedWebSearch: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondOptions] = fetchMock.mock.calls[1];
    const secondBody = JSON.parse(secondOptions.body);
    expect(secondBody.messages).toEqual([
      { role: 'user', content: 'analyze' },
      { role: 'assistant', content: 'plain text, no braces' },
      { role: 'user', content: 'Output ONLY the final JSON object now.' },
    ]);
  });

  it('does not send a continuation turn when expectJson:false, even if the reply has no braces (e.g. a plain-text test-connection reply like "OK")', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatible({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      prompt: 'Reply with only the single word: OK',
      expectJson: false,
    });

    expect(result).toEqual({ text: 'OK', usedWebSearch: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a continuation turn when the first reply already has JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"one_liner":"ok"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAICompatible({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      model: 'gemma4',
      prompt: 'analyze',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('extracts the error message from an array-wrapped error body (Gemini\'s OpenAI-compat layer returns [{error:{message}}] instead of {error:{message}})', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => [{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }],
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'bad', model: 'gemini-2.0-flash', prompt: 'x' })
    ).rejects.toThrow('Please pass a valid API key');
  });

  it('falls back to an HTTP status message instead of throwing a JSON-parse error when the error response body is not valid JSON (e.g. an empty 404 from a misconfigured base URL)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKey: 'bad', model: 'gemini-2.0-flash', prompt: 'x' })
    ).rejects.toThrow('HTTP 404');
  });
});
