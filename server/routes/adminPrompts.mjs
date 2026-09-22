import { Router } from 'express';
import { createRateLimiter } from '../auth/rateLimit.mjs';
import { MAX_PASSWORD_LENGTH, verifyPassword } from '../auth/password.mjs';
import { REQUIRED_OUTPUT_KEYS } from '../prompts/buildAnalysisPrompt.mjs';
import { withSamplePortfolio } from '../marketSnapshot.mjs';
import { loadSchedule } from '../analysisScheduler.mjs';
import { produceMarketAnalysis } from '../standardAnalysis.mjs';
import {
  MAX_PROMPT_LENGTH, isKind, normalizeDraft, loadPrompts, savePrompt, resetPrompt,
  recordTest, hasPassedTest, clearTest, withAppRules, APP_RULES,
} from '../analystPrompts.mjs';

// Mounted at /api/admin/prompts behind requireAuth + requireAdmin. There are two prompts,
// "standard" and "personalized", each saved and tested on its own.
// Editing is locked behind the admin's own password: every save and every reset must carry it.
// A wrong password is a 403, never a 401, because the client treats any 401 as "signed out".
const PREVIEW_CHARS = 1200;
// Errors that mean the model answered in some other layout altogether.
const WRONG_LAYOUT = /^(schema_version must be 3|primary_decision required|response: unknown fields|response must be a JSON object)$/;
const WRONG_LAYOUT_HINT = "The model did not answer in the app's required format. Check that the instructions box does not describe a different JSON layout: the layout belongs only in the output format box, and it must keep the required keys.";

export function createAdminPromptsRouter(db, { adminId, deps = {}, signRateLimit = { max: 10, windowMs: 15 * 60 * 1000 } } = {}) {
  const router = Router();
  const limitSigning = createRateLimiter(signRateLimit);
  let testing = false;

  const view = async () => ({
    ...(await loadPrompts(db)),
    // The top-level keys an output format must keep: the app's validator and display depend on them.
    requiredKeys: REQUIRED_OUTPUT_KEYS,
    // Appended to every saved prompt; shown read-only.
    lockedRules: APP_RULES,
    maxLength: MAX_PROMPT_LENGTH,
  });

  async function signed(req, res) {
    const password = req.body?.password;
    if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) {
      res.status(400).json({ error: 'Enter your password to sign this change' });
      return false;
    }
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await verifyPassword(password, rows[0]?.password_hash))) {
      res.status(403).json({ error: 'Wrong password' });
      return false;
    }
    return true;
  }

  router.get('/', async (req, res) => {
    res.json(await view());
  });

  router.param('kind', (req, res, next, kind) => {
    if (!isKind(kind)) return res.status(404).json({ error: 'Unknown prompt' });
    next();
  });

  // Runs a real analysis with the draft and throws the result away. The standard prompt runs on
  // the real market snapshot; the personalized one on the same data plus a sample portfolio. A
  // save is only accepted afterwards, for exactly this text.
  router.post('/:kind/test', async (req, res) => {
    const { kind } = req.params;
    let draft;
    try {
      draft = normalizeDraft(kind, req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (testing) return res.status(409).json({ error: 'A prompt test is already running' });
    testing = true;
    try {
      const schedule = await loadSchedule(db);
      let output;
      let rawAnswer = null;
      try {
        ({ output } = await produceMarketAnalysis({
          db, adminId, schedule, deps, prompts: { system: withAppRules(draft.text), format: draft.format }, decorate: kind === 'personalized' ? withSamplePortfolio : undefined,
          onRawAnswer: (text) => { rawAnswer = text; },
        }));
      } catch (err) {
        await clearTest(db, kind);
        return res.status(502).json({ error: String(err?.message || err).slice(0, 500) });
      }
      const status = output.result?.status ?? null;
      // The validator reports the same problem once per item; show each message once.
      const errors = [...new Set(output.validation?.errors ?? [])];
      let reason = null;
      if (output.validation?.ok !== true) reason = `The answer failed validation: ${errors.join('; ') || 'unknown error'}`;
      else if (status === 'insufficient_evidence') reason = 'The model answered "insufficient evidence" with this prompt and output format.';
      const passed = reason === null;
      await recordTest(db, kind, draft, { passed, by: req.user.email });
      const decision = output.result?.primary_decision;
      res.json({
        passed, reason, status, errors, sample: kind === 'personalized',
        hint: !passed && errors.some((e) => WRONG_LAYOUT.test(e)) ? WRONG_LAYOUT_HINT : null,
        // What the model actually wrote, so a rejected format can be diagnosed. Test only, never stored.
        answerPreview: !passed && typeof rawAnswer === 'string' ? rawAnswer.slice(0, PREVIEW_CHARS) : null,
        action: decision?.action ?? null, confidence: decision?.confidence ?? null, headline: decision?.headline ?? null,
        totalMs: output.metrics?.totalMs ?? null,
      });
    } finally {
      testing = false;
    }
  });

  router.put('/:kind', limitSigning, async (req, res) => {
    const { kind } = req.params;
    let draft;
    try {
      draft = normalizeDraft(kind, req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!(await signed(req, res))) return;
    if (!(await hasPassedTest(db, kind, draft))) {
      return res.status(409).json({ error: 'Test this exact prompt successfully before saving (a test is valid for 30 minutes)' });
    }
    await savePrompt(db, kind, draft, { by: req.user.email });
    await clearTest(db, kind);
    console.info(`[analyst-prompts] ${kind} saved by ${req.user.email}`);
    res.json(await view());
  });

  router.post('/:kind/reset', limitSigning, async (req, res) => {
    const { kind } = req.params;
    if (!(await signed(req, res))) return;
    await resetPrompt(db, kind);
    await clearTest(db, kind);
    console.info(`[analyst-prompts] ${kind} reset to default by ${req.user.email}`);
    res.json(await view());
  });

  return router;
}
