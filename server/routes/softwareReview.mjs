import { Router } from 'express';
import { runLocalSoftwareReview } from '../softwareReview.mjs';

export function createSoftwareReviewRouter(runReview = runLocalSoftwareReview) {
  const router = Router();

  router.post('/run', async (req, res) => {
    const body = req.body || {};
    const action = body.action || 'review';
    const codeContext = body.code_context;
    const approvedFindingIds = Array.isArray(body.approved_finding_ids) ? body.approved_finding_ids.filter(Boolean) : [];

    if (!['review', 'refactor'].includes(action)) return res.status(400).json({ error: 'action must be review or refactor' });
    if (typeof codeContext !== 'string' || codeContext.trim().length < 20) return res.status(400).json({ error: 'code_context must contain a diff or bounded source excerpt' });
    if (codeContext.length > 120000) return res.status(413).json({ error: 'code_context exceeds 120,000 characters' });
    if (action === 'refactor' && approvedFindingIds.length === 0) return res.status(400).json({ error: 'refactor requires approved_finding_ids' });

    try {
      const result = await runReview({
        action,
        project: body.project || 'Unnamed project',
        scope: body.scope || 'Submitted code context',
        model: body.model,
        codeContext,
        approvedFindingIds,
        reviewReport: body.review_report || '',
      });
      res.json({ ok: true, request_id: body.request_id || null, ...result });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  return router;
}

