import { callClaude } from './claude.mjs';
import { callOpenAICompatible } from './openaiCompatible.mjs';

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
};

// The shared tier always uses this specific model (chosen to keep a single
// analysis under the ~1-cent cost target) regardless of what's stored on the
// provider row — the row exists only to hold the "shared" activation state.
const SHARED_TIER_MODEL = 'claude-haiku-4-5';

export async function runProviderAnalysis(providerRow, prompt) {
  if (providerRow.provider_type === 'claude') {
    return callClaude({ apiKey: providerRow.api_key, model: providerRow.model, prompt });
  }

  if (providerRow.provider_type === 'shared') {
    const apiKey = process.env.SHARED_AI_API_KEY;
    if (!apiKey) throw new Error('Shared AI tier is not configured on this server');
    return callClaude({ apiKey, model: SHARED_TIER_MODEL, prompt, allowWebSearch: false });
  }

  const baseUrl = providerRow.base_url || DEFAULT_BASE_URLS[providerRow.provider_type];
  return callOpenAICompatible({
    baseUrl,
    apiKey: providerRow.api_key,
    model: providerRow.model,
    prompt,
  });
}
