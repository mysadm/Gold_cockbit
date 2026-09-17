import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { runProviderAnalysis } from '../providers/dispatch.mjs';
import { repairAnalysisJson } from './repairAnalysisJson.mjs';
import { validateAnalysis, computeConfidence, NUMBER_OR_PERCENT_RE as NUMBER_OR_PERCENT_RE_FOR_COVERAGE } from './validateAnalysis.mjs';
import { collectEvidence } from '../evidence.mjs';
import { validateSnapshot } from '../analystV3.mjs';
import { runAnalysisV3 } from '../runAnalysisV3.mjs';

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
  router.get('/contract', (req,res) => res.json({version:process.env.ANALYST_CONTRACT_VERSION === 'v3' ? '3' : '2'}));

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
    const isV3 = req.body.contract_version === '3';
    if(isV3) {
      if(process.env.ANALYST_CONTRACT_VERSION !== 'v3')return res.status(409).json({error:'Analyst v3 is not enabled'});
      const errors=validateSnapshot(snapshot);
      if(errors.length)return res.status(400).json({error:errors.join('; ')});
    }
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
      if(isV3) {
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),85000);
        const disconnect=()=>{if(!res.writableEnded)controller.abort();};
        res.on('close',disconnect);
        let output;
        try {output=await runAnalysisV3(provider,snapshot,runProviderAnalysis,{signal:controller.signal});}
        finally {clearTimeout(timeout);res.off('close',disconnect);}
        if(isShared && output.usage) {
          await db.query(`INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd)
            VALUES ($1,CURRENT_DATE,1,$2) ON CONFLICT (user_id, used_on)
            DO UPDATE SET call_count=ai_shared_usage.call_count+1,total_cost_usd=ai_shared_usage.total_cost_usd+$2`,[userId,estimateSharedCostUsd(output.usage)]);
        }
        return res.json(output);
      }
      const evidence = await collectEvidence(provider);
      const { usedWebSearch: injectedWebSearch, evidenceIds, searchStatus, evidenceSources } = evidence;
      const effectivePrompt = evidence.usedWebSearch
        ? `LIVE WEB SEARCH RESULTS. Cite the ID(s) supplied. Never invent an ID.\n${evidence.evidencePack.map(r => `[${r.id}] ${r.title} ${r.date} — ${r.snippet}`).join('\n')}\n\n${prompt}`
        : prompt;

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

      res.json({ ...result, text, validation, searchStatus, evidenceSources });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
