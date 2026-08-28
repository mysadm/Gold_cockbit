import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createLlmProvidersRouter } from '../../server/routes/llmProviders.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';

vi.mock('../../server/providers/dispatch.mjs', () => ({
  runProviderAnalysis: vi.fn(),
}));

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  app = express();
  app.use(express.json());
  app.use('/api/llm-providers', createLlmProvidersRouter(client, userId));
  runProviderAnalysis.mockReset();
});

afterEach(async () => {
  await client.end();
});

describe('POST /api/llm-providers/:id/test', () => {
  it('tests a saved connection using its stored api_key without exposing it back to the client', async () => {
    const createRes = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'openai', label: 'OpenAI prod', api_key: 'sk-secret', model: 'gpt-4o-mini' });
    const id = createRes.body.id;

    runProviderAnalysis.mockResolvedValue({ text: 'OK', usedWebSearch: false });

    const res = await request(app).post(`/api/llm-providers/${id}/test`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'OK' });
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ provider_type: 'openai', api_key: 'sk-secret', model: 'gpt-4o-mini' }),
      'Reply with only the single word: OK',
      { expectJson: false }
    );
  });

  it('returns 404 for an unknown or foreign connection id', async () => {
    const res = await request(app).post('/api/llm-providers/999999/test');
    expect(res.status).toBe(404);
  });

  it('returns 502 with the provider error message when the call fails', async () => {
    const createRes = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'openai', label: 'OpenAI prod', api_key: 'bad-key', model: 'gpt-4o-mini' });
    const id = createRes.body.id;

    runProviderAnalysis.mockRejectedValue(new Error('invalid api key'));

    const res = await request(app).post(`/api/llm-providers/${id}/test`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid api key');
  });
});
