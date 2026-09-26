import { callClaude } from './claude.mjs';
import { callOpenAICompatible } from './openaiCompatible.mjs';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT } from '../prompts/legacyGoldMarketAnalyst.mjs';

export const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

// The shared tier always uses this specific model (chosen to keep a single
// analysis under the ~1-cent cost target) regardless of what's stored on the
// provider row — the row exists only to hold the "shared" activation state.
const SHARED_TIER_MODEL = 'claude-haiku-4-5';

export async function runProviderAnalysis(providerRow, prompt, { expectJson = true, system = GOLD_MARKET_ANALYST_SYSTEM_PROMPT, compact = false, signal, jsonSchema, maxTokens: maxTokensOverride } = {}) {
  const temperature = !providerRow.settings?.extra?.omitTemperature && typeof providerRow.settings?.temperature === 'number' ? providerRow.settings.temperature : undefined;
  // The adapter preserves legacy limits and clamps compact output independently. An explicit
  // override (V4's measured per-tier cap) takes precedence over whatever the provider row stores.
  const maxTokens = typeof maxTokensOverride === 'number' ? maxTokensOverride : (typeof providerRow.settings?.maxTokens === 'number' ? providerRow.settings.maxTokens : undefined);

  if (providerRow.provider_type === 'claude') {
    return callClaude({
      apiKey: providerRow.api_key,
      model: providerRow.model,
      prompt,
      temperature,
      maxTokens,
      expectJson,
      system,
      compact, signal, jsonSchema,
    });
  }

  if (providerRow.provider_type === 'shared') {
    const apiKey = process.env.SHARED_AI_API_KEY;
    if (!apiKey) throw new Error('Shared AI tier is not configured on this server');
    return callClaude({ apiKey, model: SHARED_TIER_MODEL, prompt, expectJson, system, compact, signal, jsonSchema });
  }

  const baseUrl = providerRow.base_url || DEFAULT_BASE_URLS[providerRow.provider_type];
  const tokenLimitParameter = providerRow.settings?.extra?.tokenLimitParameter || (compact && providerRow.provider_type === 'openai' ? 'max_completion_tokens' : 'max_tokens');
  return callOpenAICompatible({
    baseUrl,
    apiKey: providerRow.api_key,
    model: providerRow.model,
    prompt,
    temperature,
    maxTokens,
    expectJson,
    system,
    compact, signal, jsonSchema,
    tokenLimitParameter,
  });
}
