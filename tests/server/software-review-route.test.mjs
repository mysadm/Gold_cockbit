import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSoftwareReviewRouter } from '../../server/routes/softwareReview.mjs';

function appWith(runReview) {
  const app = express();
  app.use(express.json());
  app.use('/api/software-review', createSoftwareReviewRouter(runReview));
  return app;
}

describe('software review route', () => {
  it('validates code context', async () => {
    const response = await request(appWith(vi.fn())).post('/api/software-review/run').send({ action: 'review' });
    expect(response.status).toBe(400);
  });

  it('requires approval IDs for refactoring', async () => {
    const response = await request(appWith(vi.fn())).post('/api/software-review/run').send({ action: 'refactor', code_context: 'const enoughContext = true;' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/approved_finding_ids/);
  });

  it('passes a normalized local review request to the service', async () => {
    const runReview = vi.fn().mockResolvedValue({ action: 'review', model: 'local', reportMarkdown: '# Report' });
    const response = await request(appWith(runReview)).post('/api/software-review/run').send({ project: 'gold', code_context: 'const enoughContext = true;' });
    expect(response.status).toBe(200);
    expect(response.body.reportMarkdown).toBe('# Report');
    expect(runReview).toHaveBeenCalledWith(expect.objectContaining({ action: 'review', project: 'gold' }));
  });
});
