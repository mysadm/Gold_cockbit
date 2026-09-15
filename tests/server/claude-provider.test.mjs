import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callClaude } from '../../server/providers/claude.mjs';

describe('callClaude', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns text and usedWebSearch=false, and never sends a tools field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"ok"}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: false, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tools).toBeUndefined();
  });

  it('propagates the error and does not retry when the call fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, text: async () => JSON.stringify({ error: { message: 'HTTP 500' } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' })
    ).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a continuation turn if the first reply has no JSON, still without a tools field', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'plain text, no braces' }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"continued"}' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result.text).toBe('{"one_liner":"continued"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(secondOptions.body).tools).toBeUndefined();
  });

  it('does not send a continuation turn when expectJson:false, even for a brace-free reply like "OK"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      prompt: 'Reply with only the single word: OK',
      expectJson: false,
    });

    expect(result.text).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
