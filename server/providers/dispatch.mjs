import { callClaude } from './claude.mjs';
import { callOpenAICompatible } from './openaiCompatible.mjs';

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
};

export async function runProviderAnalysis(providerRow, prompt) {
  if (providerRow.provider_type === 'claude') {
    return callClaude({ apiKey: providerRow.api_key, model: providerRow.model, prompt });
  }

  const baseUrl = providerRow.base_url || DEFAULT_BASE_URLS[providerRow.provider_type];
  return callOpenAICompatible({
    baseUrl,
    apiKey: providerRow.api_key,
    model: providerRow.model,
    prompt,
  });
}
