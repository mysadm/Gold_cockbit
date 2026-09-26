import { parseV3 as parseJsonAnswer } from '../../shared/analystContract.mjs';
import { validateAnalystOutput, BASE_SCHEMA, PERSONALIZED_SCHEMA, MAX_TOKENS } from '../../shared/analystOutputV4.mjs';

// Not wired into runAnalysisV3.mjs yet (Phase 2 replaces the prompt and connects this to
// the real pipeline) — this is the schema/validate/retry-once/controlled-error machinery
// Phase 1 asks for, exercised directly by its own unit tests until then.
export async function runValidatedAnalysis({ provider, prompt, options = {}, runProvider, tier = 'standard', scenarioKeys, evidenceIds = [] }) {
  const schema = tier === 'personalized' ? PERSONALIZED_SCHEMA : BASE_SCHEMA;
  const jsonSchema = { name: 'analyst_output', schema };
  const maxTokens = MAX_TOKENS[tier] ?? MAX_TOKENS.standard;

  let lastErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const correction = attempt === 0 ? '' : `\nCORRECTION: ${lastErrors.join('; ')}. Fix only these failures and return the full corrected JSON.`;
    const result = await runProvider(provider, prompt + correction, { ...options, jsonSchema, maxTokens });
    const parsed = parseJsonAnswer(result.text);
    const validation = validateAnalystOutput(parsed, { tier, scenarioKeys, evidenceIds });
    if (validation.ok) return { ok: true, output: parsed, usage: result.usage, retries: attempt };
    lastErrors = validation.errors;
  }
  return { ok: false, error: 'validation_failed', errors: lastErrors };
}
