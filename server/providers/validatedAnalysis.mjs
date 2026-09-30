import { parseV3 as parseJsonAnswer } from '../../shared/analystContract.mjs';
import { validateAnalystOutput, BASE_SCHEMA, PERSONALIZED_SCHEMA, MAX_TOKENS } from '../../shared/analystOutputV4.mjs';
import { repairFormatting } from './formatRepair.mjs';

// Wired into the real pipeline by server/runAnalysisV4.mjs (Phase 2, behind ANALYST_V4=1) — the
// schema/validate/retry-once/controlled-error machinery Phase 1 built. `attempts` records every
// call's usage/truncation/errors/repair independently: GOLD_COCKPIT_SPEED_PLAN.md Phase 2 asks to
// "record usage per attempt, not summed across retries" (unlike v3's runAnalysisV3.mjs, which
// accumulates usage across correction retries). `errors` on a successful attempt is always `[]`
// (not omitted), so a retried-but-ultimately-successful run still shows what its failed first
// attempt said — without this, only a run that fails outright has any recorded error text.
//
// A failed attempt is repaired in-code first (formatRepair.mjs: length/count/unknown-field/empty-
// entry fixes only, no model call) and re-validated before falling through to a real retry — a
// truncated completion is never repaired (the JSON itself may be incomplete/unsafe to patch), and
// a repair never fixes a semantic error (weight math, unknown EV-ID, invalid enum, a DCA amount
// over the limit), so those always still need the retry below.
export async function runValidatedAnalysis({ provider, prompt, options = {}, runProvider, tier = 'standard', scenarioKeys, evidenceIds = [], dcaLimitEgp, onRawAnswer }) {
  const schema = tier === 'personalized' ? PERSONALIZED_SCHEMA : BASE_SCHEMA;
  const jsonSchema = { name: 'analyst_output', schema };
  const maxTokens = MAX_TOKENS[tier] ?? MAX_TOKENS.standard;

  let lastErrors = [];
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const correction = attempt === 0 ? '' : `\nCORRECTION: ${lastErrors.join('; ')}. Fix only these failures and return the full corrected JSON.`;
    const result = await runProvider(provider, prompt + correction, { ...options, jsonSchema, maxTokens });
    onRawAnswer?.(result.text);
    let parsed = parseJsonAnswer(result.text);
    let validation = validateAnalystOutput(parsed, { tier, scenarioKeys, evidenceIds, dcaLimitEgp });
    if (result.truncated) validation = { ok: false, errors: [...validation.errors, 'completion was truncated'] };

    let repair = null;
    if (!validation.ok && !result.truncated) {
      const repairResult = repairFormatting(parsed, { tier, scenarioKeys });
      if (repairResult.repaired) {
        repair = repairResult;
        parsed = repairResult.output;
        validation = validateAnalystOutput(parsed, { tier, scenarioKeys, evidenceIds, dcaLimitEgp });
      }
    }

    attempts.push({
      usage: result.usage, truncated: result.truncated === true, errors: validation.errors,
      repaired: repair !== null, repairedFields: repair?.fields ?? [],
    });
    if (validation.ok) return { ok: true, output: parsed, usage: result.usage, retries: attempt, attempts };
    lastErrors = validation.errors;
  }
  return { ok: false, error: 'validation_failed', errors: lastErrors, retries: attempts.length - 1, attempts };
}
