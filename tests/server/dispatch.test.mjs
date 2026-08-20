import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';
import { callClaude } from '../../server/providers/claude.mjs';
import { callOpenAICompatible } from '../../server/providers/openaiCompatible.mjs';

vi.mock('../../server/providers/claude.mjs', () => ({
  callClaude: vi.fn(),
}));
vi.mock('../../server/providers/openaiCompatible.mjs', () => ({
  callOpenAICompatible: vi.fn(),
}));

describe('runProviderAnalysis', () => {
  beforeEach(() => {
    callClaude.mockReset();
    callOpenAICompatible.mockReset();
  });

  it('dispatches claude provider_type to callClaude', async () => {
    callClaude.mockResolvedValue({ text: 'claude-result', usedWebSearch: true });

    const result = await runProviderAnalysis(
      { provider_type: 'claude', api_key: 'sk-ant', model: 'claude-sonnet-4-6', base_url: null },
      'prompt text'
    );

    expect(result).toEqual({ text: 'claude-result', usedWebSearch: true });
    expect(callClaude).toHaveBeenCalledWith({ apiKey: 'sk-ant', model: 'claude-sonnet-4-6', prompt: 'prompt text' });
    expect(callOpenAICompatible).not.toHaveBeenCalled();
  });

  it('dispatches openai provider_type to callOpenAICompatible with the default base URL when none is stored', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'openai-result', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'openai', api_key: 'sk-test', model: 'gpt-4o', base_url: null },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      prompt: 'prompt text',
    });
  });

  it('dispatches ollama provider_type to callOpenAICompatible with the default local base URL when none is stored', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'ollama-result', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'ollama', api_key: null, model: 'llama3.1', base_url: null },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      model: 'llama3.1',
      prompt: 'prompt text',
    });
  });

  it('dispatches custom provider_type to callOpenAICompatible using the stored base_url', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'custom-result', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'custom', api_key: 'k', model: 'm', base_url: 'https://my-router.example.com/v1' },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'https://my-router.example.com/v1',
      apiKey: 'k',
      model: 'm',
      prompt: 'prompt text',
    });
  });

  it('dispatches shared provider_type to callClaude with the server-side key, Haiku, and web search disabled', async () => {
    const previousKey = process.env.SHARED_AI_API_KEY;
    process.env.SHARED_AI_API_KEY = 'sk-ant-shared-test';
    try {
      callClaude.mockResolvedValue({ text: 'shared-result', usedWebSearch: false, usage: { input_tokens: 1, output_tokens: 1 } });

      const result = await runProviderAnalysis(
        { provider_type: 'shared', api_key: null, model: 'ignored', base_url: null },
        'prompt text'
      );

      expect(result).toEqual({ text: 'shared-result', usedWebSearch: false, usage: { input_tokens: 1, output_tokens: 1 } });
      expect(callClaude).toHaveBeenCalledWith({
        apiKey: 'sk-ant-shared-test',
        model: 'claude-haiku-4-5',
        prompt: 'prompt text',
        allowWebSearch: false,
      });
      expect(callOpenAICompatible).not.toHaveBeenCalled();
    } finally {
      if (previousKey === undefined) delete process.env.SHARED_AI_API_KEY;
      else process.env.SHARED_AI_API_KEY = previousKey;
    }
  });

  it('throws a clear error when the shared tier is used but SHARED_AI_API_KEY is not configured', async () => {
    const previousKey = process.env.SHARED_AI_API_KEY;
    delete process.env.SHARED_AI_API_KEY;
    try {
      await expect(
        runProviderAnalysis({ provider_type: 'shared', api_key: null, model: 'ignored', base_url: null }, 'prompt text')
      ).rejects.toThrow(/not configured/i);
    } finally {
      if (previousKey !== undefined) process.env.SHARED_AI_API_KEY = previousKey;
    }
  });

  it('prefers a stored base_url over the default for openai/ollama when present', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'x', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'ollama', api_key: null, model: 'llama3.1', base_url: 'http://192.168.1.50:11434/v1' },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.1.50:11434/v1' })
    );
  });
});
