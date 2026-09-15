import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { runProviderAnalysis } from '../providers/dispatch.mjs';
import { repairAnalysisJson } from './repairAnalysisJson.mjs';
import { validateAnalysis, computeConfidence, NUMBER_OR_PERCENT_RE as NUMBER_OR_PERCENT_RE_FOR_COVERAGE } from './validateAnalysis.mjs';
import { searchWeb } from '../webSearch.mjs';

// No provider_type has any real-time access of its own — Claude's native
// agentic web_search tool was retired (it could run several searches inside
// a single open-ended HTTP call with no evidence IDs and no bound on
// latency), so every provider_type — claude, shared, ollama, openai,
// openrouter, custom — is on equal footing even though the prompt tells the
// model to "use your live web search". So for all of them we run real
// searches ourselves and inject the results into the prompt. A single
// 5-result snippet-only search still reads as thin and generic, so this
// runs several targeted queries (one per facet the prompt actually asks
// about) in parallel and merges/dedupes the results — broader than a single
// query, though still one static pass rather than an iterative one.
// No year is hardcoded into these — searchWeb() already restricts results to
// the past 24 hours (see webSearch.mjs), so a literal year in the query text
// would just be redundant at best and, come next year, a silent staleness
// bug at worst (a query for "...policy decision 2026" keeps matching 2026
// content long after 2026 is over).
const WEB_SEARCH_QUERIES = [
  'gold price today news drivers',
  'Fed interest rate policy decision',
  'central bank gold buying reserves',
  'geopolitical tensions news today Iran Russia Ukraine',
  'Egypt EGP exchange rate gold price today',
];

function evidenceIdFor(index) {
  return `EV-${String(index + 1).padStart(3, '0')}`;
}

// Off only when the user explicitly unchecked the "Web search" toggle in the
// AI settings card — unset (older rows, never-saved settings) defaults on.
function isWebSearchEnabled(providerRow) {
  return providerRow.settings?.webSearch !== false;
}

function formatSearchResults(results) {
  return results
    .map((r, i) => `[${evidenceIdFor(i)}] ${r.title}${r.date ? ` [${r.date}]` : ''} — ${r.snippet} (${r.link})`)
    .join('\n');
}

async function augmentPromptWithSearch(prompt) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { prompt, usedWebSearch: false, evidenceIds: [] };

  try {
    const resultsPerQuery = await Promise.all(
      WEB_SEARCH_QUERIES.map((query) => searchWeb(query, apiKey).catch(() => []))
    );
    const seenLinks = new Set();
    const results = resultsPerQuery.flat().filter((r) => {
      if (!r.link || seenLinks.has(r.link)) return false;
      seenLinks.add(r.link);
      return true;
    });
    if (results.length === 0) return { prompt, usedWebSearch: false, evidenceIds: [] };
    const evidenceIds = results.map((_, i) => evidenceIdFor(i));
    const augmented = `LIVE WEB SEARCH RESULTS (use these as your source of current market/news context). Each result is tagged with a stable evidence ID like [EV-001]. Whenever you state a time-sensitive fact drawn from these results anywhere in your JSON output, cite the ID(s) it came from in brackets at the end of that sentence, e.g. "...rose 2% today [EV-002]." Never invent an ID that is not listed below, and never attach an ID to a claim these results don't actually support:\n${formatSearchResults(results)}\n\n${prompt}`;
    return { prompt: augmented, usedWebSearch: true, evidenceIds };
  } catch {
    return { prompt, usedWebSearch: false, evidenceIds: [] };
  }
}

// Claude Haiku 4.5 pricing (the fixed model behind the shared tier — see
// providers/dispatch.mjs), used only to estimate/log spend, not to bill.
const SHARED_PRICE_PER_M_INPUT = 1.0;
const SHARED_PRICE_PER_M_OUTPUT = 5.0;
const SHARED_COST_WARN_THRESHOLD_USD = 0.01;
const SHARED_DAILY_LIMIT = Number(process.env.SHARED_AI_DAILY_LIMIT) || 2;

function extractBraces(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function isParseableJson(text) {
  const candidate = extractBraces(text);
  if (!candidate) return false;
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

function estimateSharedCostUsd(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens / 1_000_000) * SHARED_PRICE_PER_M_INPUT +
    (usage.output_tokens / 1_000_000) * SHARED_PRICE_PER_M_OUTPUT
  );
}

export function createAnalyzeRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/quota', async (req, res) => {
    const { rows } = await db.query(
      'SELECT provider_type FROM llm_providers WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (rows.length === 0 || rows[0].provider_type !== 'shared') {
      return res.json({ shared: false });
    }
    const { rows: usageRows } = await db.query(
      'SELECT call_count FROM ai_shared_usage WHERE user_id = $1 AND used_on = CURRENT_DATE',
      [userId]
    );
    const used = usageRows.length > 0 ? usageRows[0].call_count : 0;
    res.json({ shared: true, used, limit: SHARED_DAILY_LIMIT });
  });

  router.post('/', async (req, res) => {
    const { prompt, snapshot } = req.body;
    const { rows } = await db.query(
      'SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active provider configured' });
    }

    const provider = rows[0];
    const isShared = provider.provider_type === 'shared';

    if (isShared) {
      const { rows: usageRows } = await db.query(
        'SELECT call_count FROM ai_shared_usage WHERE user_id = $1 AND used_on = CURRENT_DATE',
        [userId]
      );
      const usedToday = usageRows.length > 0 ? usageRows[0].call_count : 0;
      if (usedToday >= SHARED_DAILY_LIMIT) {
        return res.status(402).json({ error: 'Insufficient credit balance' });
      }
    }

    try {
      let effectivePrompt = prompt;
      let injectedWebSearch = false;
      let evidenceIds = [];
      const webSearchEnabled = isWebSearchEnabled(provider);
      if (webSearchEnabled) {
        const augmented = await augmentPromptWithSearch(prompt);
        effectivePrompt = augmented.prompt;
        injectedWebSearch = augmented.usedWebSearch;
        evidenceIds = augmented.evidenceIds;
      }

      const result = await runProviderAnalysis(provider, effectivePrompt);
      result.usedWebSearch = injectedWebSearch;
      let { text } = result;

      // Weaker/local models sometimes forget to close a JSON array or object
      // before starting the next field. Generic JSON repair can't fix this
      // (it doesn't know our schema), but we do, so attempt a targeted repair
      // before falling back to whatever the client does with unparseable text.
      if (!isParseableJson(text)) {
        const repaired = repairAnalysisJson(text);
        if (repaired) text = JSON.stringify(repaired);
      }

      let parsedForValidation = (() => {
        try {
          return JSON.parse(extractBraces(text) || text);
        } catch {
          return null;
        }
      })();
      let validation = validateAnalysis({ parsed: parsedForValidation, rawText: text, evidenceIds, snapshot });

      if (!validation.ok) {
        // One corrective re-prompt, mirroring the existing "output only
        // JSON" retry pattern already used for malformed responses — the
        // model gets one chance to fix the exact errors found, not a
        // free-form do-over. If the retry still fails, we don't loop again;
        // we force a safe, honest downgrade below instead.
        const correctionPrompt = `Your previous response failed these checks:\n${validation.errors.map((e) => `- ${e}`).join('\n')}\nReturn a corrected JSON object that fixes every listed issue. Do not introduce new numbers, dates, or claims beyond what you already stated or what the supplied evidence/snapshot support.`;
        const retryResult = await runProviderAnalysis(provider, `${effectivePrompt}\n\n${correctionPrompt}`);
        let retryText = retryResult.text;
        if (!isParseableJson(retryText)) {
          const repaired = repairAnalysisJson(retryText);
          if (repaired) retryText = JSON.stringify(repaired);
        }
        const retryParsed = (() => {
          try {
            return JSON.parse(extractBraces(retryText) || retryText);
          } catch {
            return null;
          }
        })();
        const retryValidation = validateAnalysis({ parsed: retryParsed, rawText: retryText, evidenceIds, snapshot });
        if (retryValidation.ok) {
          text = retryText;
          parsedForValidation = retryParsed;
          validation = retryValidation;
        } else {
          // Still failing after one correction attempt — force a safe,
          // honest result rather than rendering an unverified analysis.
          validation = retryValidation;
          if (parsedForValidation && typeof parsedForValidation === 'object') {
            parsedForValidation.primary_decision = {
              ...(parsedForValidation.primary_decision || {}),
              action: 'insufficient_evidence',
            };
            text = JSON.stringify(parsedForValidation);
          }
        }
      }

      // Confidence is always computed here from the validated result, never
      // trusted from the model's own self-reported value — see
      // computeConfidence in validateAnalysis.mjs (monotonic: it can only
      // hold or lower the model's reported confidence, never raise it).
      const modelConfidence = parsedForValidation?.primary_decision?.confidence;
      // dca_read is deliberately excluded here, mirroring CLAIM_FIELD_KEYS in
      // validateAnalysis.mjs: its numbers are the user's own plan data (from
      // the snapshot), not an external market claim needing evidence-ID
      // citation, so it legitimately carries evidence_ids: [] even when
      // fully compliant. Counting it as a "claim" here would cap
      // evidenceCoverageRatio below 0.5 for a correct, fully-valid
      // DCA-focused response, silently capping confidence at 'medium' for no
      // real reason.
      const claimFields = [
        parsedForValidation?.weights_reasoning,
        parsedForValidation?.egp_read,
        parsedForValidation?.wallet_read,
        parsedForValidation?.watchlist_read,
        ...(Array.isArray(parsedForValidation?.primary_decision?.reasons) ? parsedForValidation.primary_decision.reasons : []),
      ].filter(Boolean);
      const fieldsWithClaims = claimFields.filter((f) => NUMBER_OR_PERCENT_RE_FOR_COVERAGE.test(f?.text || ''));
      const fieldsWithEvidence = fieldsWithClaims.filter((f) => Array.isArray(f?.evidence_ids) && f.evidence_ids.length > 0);
      const evidenceCoverageRatio = fieldsWithClaims.length === 0 ? 1 : fieldsWithEvidence.length / fieldsWithClaims.length;
      const confidence = computeConfidence({ modelConfidence, errors: validation.errors, evidenceCoverageRatio });
      if (parsedForValidation && typeof parsedForValidation === 'object' && parsedForValidation.primary_decision) {
        parsedForValidation.primary_decision.confidence = confidence;
        text = JSON.stringify(parsedForValidation);
      }

      if (isShared) {
        const cost = estimateSharedCostUsd(result.usage);
        if (cost > SHARED_COST_WARN_THRESHOLD_USD) {
          console.warn(
            `[shared-ai] analysis for user ${userId} cost ~$${cost.toFixed(4)}, above the $${SHARED_COST_WARN_THRESHOLD_USD} target`
          );
        }
        await db.query(
          `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd)
           VALUES ($1, CURRENT_DATE, 1, $2)
           ON CONFLICT (user_id, used_on)
           DO UPDATE SET call_count = ai_shared_usage.call_count + 1, total_cost_usd = ai_shared_usage.total_cost_usd + $2`,
          [userId, cost]
        );
      }

      res.json({ ...result, text, validation });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
