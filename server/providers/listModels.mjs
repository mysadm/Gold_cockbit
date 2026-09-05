import { validateBaseUrl } from './openaiCompatible.mjs';
import { ANTHROPIC_VERSION } from './claude.mjs';
import { DEFAULT_BASE_URLS } from './dispatch.mjs';

const ANTHROPIC_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models';

export async function listOpenAICompatibleModels({ baseUrl, apiKey }) {
  const safeBaseUrl = await validateBaseUrl(baseUrl);
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${safeBaseUrl}/models`, { headers });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }

  return (data?.data ?? []).map((model) => model.id).sort();
}

export async function listAnthropicModels({ apiKey }) {
  const response = await fetch(ANTHROPIC_MODELS_ENDPOINT, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }

  return (data?.data ?? []).map((model) => model.id).sort();
}

export async function listProviderModels(providerRow) {
  if (providerRow.provider_type === 'claude') {
    return listAnthropicModels({ apiKey: providerRow.api_key });
  }

  if (providerRow.provider_type === 'shared') {
    return [];
  }

  const baseUrl = providerRow.base_url || DEFAULT_BASE_URLS[providerRow.provider_type];
  return listOpenAICompatibleModels({ baseUrl, apiKey: providerRow.api_key });
}
