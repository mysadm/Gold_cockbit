import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchActiveProvider } from '../../src/api/llmProviders';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchActiveProvider', () => {
  it('maps the whitelisted server fields onto an LlmProvider with safe placeholders', async () => {
    const f = vi.fn().mockResolvedValueOnce(
      json(200, {
        provider: { id: 7, provider_type: 'ollama', label: 'Admin Ollama', model: 'gemma', settings: { webSearch: false }, is_active: true },
      })
    );
    vi.stubGlobal('fetch', f);
    const p = await fetchActiveProvider();
    expect(f).toHaveBeenCalledWith('/api/analyze/provider');
    expect(p).toEqual({
      id: 7,
      provider_type: 'ollama',
      label: 'Admin Ollama',
      model: 'gemma',
      settings: { webSearch: false },
      is_active: true,
      base_url: null,
      created_at: '',
      updated_at: '',
    });
  });

  it('returns null when the admin has no active provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { provider: null })));
    expect(await fetchActiveProvider()).toBeNull();
  });

  it('throws on a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: 'Not signed in' })));
    await expect(fetchActiveProvider()).rejects.toThrow('Not signed in');
  });
});
