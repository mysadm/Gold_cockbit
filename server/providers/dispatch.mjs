import { callClaude } from './claude.mjs';
import { callOpenAICompatible } from './openaiCompatible.mjs';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT } from '../prompts/goldMarketAnalyst.mjs';

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

// The shared tier always uses this specific model (chosen to keep a single
// analysis under the ~1-cent cost target) regardless of what's stored on the
// provider row — the row exists only to hold the "shared" activation state.
const SHARED_TIER_MODEL = 'claude-haiku-4-5';

export async function runProviderAnalysis(providerRow, prompt, { expectJson = true, system = GOLD_MARKET_ANALYST_SYSTEM_PROMPT } = {}) {
  const temperature = typeof providerRow.settings?.temperature === 'number' ? providerRow.settings.temperature : undefined;
  // maxTokens from user settings is only ever applied as a ceiling *increase* — the
  // fixed 16000 floor in callClaude/callOpenAICompatible protects the multi-field JSON
  // schema the analysis prompt returns from being truncated (see comment there).
  const maxTokens = typeof providerRow.settings?.maxTokens === 'number' ? providerRow.settings.maxTokens : undefined;

  if (providerRow.provider_type === 'claude') {
    return callClaude({ apiKey: providerRow.api_key, model: providerRow.model, prompt, temperature, maxTokens, expectJson, system });
  }

  if (providerRow.provider_type === 'shared') {
    const apiKey = process.env.SHARED_AI_API_KEY;
    if (!apiKey) throw new Error('Shared AI tier is not configured on this server');
    return callClaude({ apiKey, model: SHARED_TIER_MODEL, prompt, allowWebSearch: false, expectJson, system });
  }

  const baseUrl = providerRow.base_url || DEFAULT_BASE_URLS[providerRow.provider_type];
  return callOpenAICompatible({
    baseUrl,
    apiKey: providerRow.api_key,
    model: providerRow.model,
    prompt,
    temperature,
    maxTokens,
    expectJson,
    system,
  });
}
