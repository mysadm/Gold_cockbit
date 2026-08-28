import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { runProviderAnalysis } from '../providers/dispatch.mjs';
import { repairAnalysisJson } from './repairAnalysisJson.mjs';
import { searchWeb } from '../webSearch.mjs';

// Only Claude (and the shared tier, which runs on Claude) has a native
// web-search tool, and Claude's version is agentic — it runs several
// searches of its own choosing, can read further into a result, and
// iterates. Every other provider_type — ollama, openai, openrouter, custom —
// has zero real-time access, yet the prompt tells the model to "use your
// live web search". So for all of them we run real searches ourselves and
// inject the results into the prompt. A single 5-result snippet-only search
// still reads as thin and generic next to Claude's multi-query research, so
// this runs several targeted queries (one per facet the prompt actually asks
// about) in parallel and merges/dedupes the results — closer in breadth to
// what Claude gathers on its own, though still one static pass rather than
// an iterative one.
const WEB_SEARCH_QUERIES = [
  'gold price today news drivers',
  'Fed interest rate policy decision 2026',
  'central bank gold buying reserves 2026',
  'geopolitical tensions news today Iran Russia Ukraine',
  'Egypt EGP exchange rate gold price today',
];
const NATIVE_SEARCH_PROVIDER_TYPES = new Set(['claude', 'shared']);

function formatSearchResults(results) {
  return results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.link})`)
    .join('\n');
}

async function augmentPromptWithSearch(prompt) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { prompt, usedWebSearch: false };

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
    if (results.length === 0) return { prompt, usedWebSearch: false };
    const augmented = `LIVE WEB SEARCH RESULTS (use these as your source of current market/news context):\n${formatSearchResults(results)}\n\n${prompt}`;
    return { prompt: augmented, usedWebSearch: true };
  } catch {
    return { prompt, usedWebSearch: false };
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
    const { prompt } = req.body;
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
      if (!NATIVE_SEARCH_PROVIDER_TYPES.has(provider.provider_type)) {
        const augmented = await augmentPromptWithSearch(prompt);
        effectivePrompt = augmented.prompt;
        injectedWebSearch = augmented.usedWebSearch;
      }

      const result = await runProviderAnalysis(provider, effectivePrompt);
      if (!NATIVE_SEARCH_PROVIDER_TYPES.has(provider.provider_type)) {
        result.usedWebSearch = injectedWebSearch;
      }
      let { text } = result;

      // Weaker/local models sometimes forget to close a JSON array or object
      // before starting the next field. Generic JSON repair can't fix this
      // (it doesn't know our schema), but we do, so attempt a targeted repair
      // before falling back to whatever the client does with unparseable text.
      if (!isParseableJson(text)) {
        const repaired = repairAnalysisJson(text);
        if (repaired) text = JSON.stringify(repaired);
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

      res.json({ ...result, text });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
