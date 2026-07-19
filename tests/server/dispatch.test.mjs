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
