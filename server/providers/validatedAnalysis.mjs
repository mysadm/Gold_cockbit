import { parseV3 as parseJsonAnswer } from '../../shared/analystContract.mjs';
import { validateAnalystOutput, BASE_SCHEMA, PERSONALIZED_SCHEMA, MAX_TOKENS } from '../../shared/analystOutputV4.mjs';

// Wired into the real pipeline by server/runAnalysisV4.mjs (Phase 2, behind ANALYST_V4=1) — the
// schema/validate/retry-once/controlled-error machinery Phase 1 built. `attempts` records every
// call's usage/truncation independently: GOLD_COCKPIT_SPEED_PLAN.md Phase 2 asks to "record usage
// per attempt, not summed across retries" (unlike v3's runAnalysisV3.mjs, which accumulates usage
// across correction retries).
export async function runValidatedAnalysis({ provider, prompt, options = {}, runProvider, tier = 'standard', scenarioKeys, evidenceIds = [], onRawAnswer }) {
  const schema = tier === 'personalized' ? PERSONALIZED_SCHEMA : BASE_SCHEMA;
  const jsonSchema = { name: 'analyst_output', schema };
  const maxTokens = MAX_TOKENS[tier] ?? MAX_TOKENS.standard;

  let lastErrors = [];
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const correction = attempt === 0 ? '' : `\nCORRECTION: ${lastErrors.join('; ')}. Fix only these failures and return the full corrected JSON.`;
    const result = await runProvider(provider, prompt + correction, { ...options, jsonSchema, maxTokens });
    onRawAnswer?.(result.text);
    const parsed = parseJsonAnswer(result.text);
    let validation = validateAnalystOutput(parsed, { tier, scenarioKeys, evidenceIds });
    if (result.truncated) validation = { ok: false, errors: [...validation.errors, 'completion was truncated'] };
    attempts.push({ usage: result.usage, truncated: result.truncated === true });
    if (validation.ok) return { ok: true, output: parsed, usage: result.usage, retries: attempt, attempts };
    lastErrors = validation.errors;
  }
  return { ok: false, error: 'validation_failed', errors: lastErrors, retries: attempts.length - 1, attempts };
}
