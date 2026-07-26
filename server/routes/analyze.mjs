import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { runProviderAnalysis } from '../providers/dispatch.mjs';
import { repairAnalysisJson } from './repairAnalysisJson.mjs';

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

export function createAnalyzeRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.post('/', async (req, res) => {
    const { prompt } = req.body;
    const { rows } = await db.query(
      'SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active provider configured' });
    }

    try {
      const result = await runProviderAnalysis(rows[0], prompt);
      let { text } = result;

      // Weaker/local models sometimes forget to close a JSON array or object
      // before starting the next field. Generic JSON repair can't fix this
      // (it doesn't know our schema), but we do, so attempt a targeted repair
      // before falling back to whatever the client does with unparseable text.
      if (!isParseableJson(text)) {
        const repaired = repairAnalysisJson(text);
        if (repaired) text = JSON.stringify(repaired);
      }

      res.json({ ...result, text });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
