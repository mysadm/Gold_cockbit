import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callClaude } from '../../server/providers/claude.mjs';

describe('callClaude', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns text and usedWebSearch=true on a successful tool-enabled call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"ok"}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: true, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
  });

  it('falls back to a no-tools call if the first call fails, and reports usedWebSearch=false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ error: { message: 'HTTP 500' } }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"fallback"}' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result).toEqual({ text: '{"one_liner":"fallback"}', usedWebSearch: false, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(secondOptions.body).tools).toBeUndefined();
  });

  it('throws the original error if both the tool-enabled and fallback calls fail', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ error: { message: 'first failure' } }) })
      .mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ error: { message: 'second failure' } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' })
    ).rejects.toThrow('first failure');
  });

  it('skips the tools call entirely when allowWebSearch is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: '{"one_liner":"ok"}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5', prompt: 'analyze', allowWebSearch: false });

    expect(result).toEqual({
      text: '{"one_liner":"ok"}',
      usedWebSearch: false,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body).tools).toBeUndefined();
  });

  it('sends a continuation turn if the first reply has no JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'plain text, no braces' }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"continued"}' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result.text).toBe('{"one_liner":"continued"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
