import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLlmProvidersRouter } from '../../server/routes/llmProviders.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';

vi.mock('../../server/providers/dispatch.mjs', () => ({
  runProviderAnalysis: vi.fn(),
}));

let app;

beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use('/api/llm-providers', createLlmProvidersRouter({ query: vi.fn() }, 'unused-user-id'));
  runProviderAnalysis.mockReset();
});

describe('POST /api/llm-providers/test', () => {
  it('calls runProviderAnalysis with the submitted fields and a fixed test prompt, returning the reply text', async () => {
    runProviderAnalysis.mockResolvedValue({ text: 'OK', usedWebSearch: false });

    const res = await request(app)
      .post('/api/llm-providers/test')
      .send({ provider_type: 'ollama', base_url: 'http://localhost:11434/v1', api_key: null, model: 'llama3.1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'OK' });
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      { provider_type: 'ollama', base_url: 'http://localhost:11434/v1', api_key: null, model: 'llama3.1' },
      'Reply with only the single word: OK'
    );
  });

  it('returns 502 with the provider error message when the call fails', async () => {
    runProviderAnalysis.mockRejectedValue(new Error('invalid api key'));

    const res = await request(app)
      .post('/api/llm-providers/test')
      .send({ provider_type: 'openai', api_key: 'bad-key', model: 'gpt-4o' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid api key');
  });

  it('does not touch the database', async () => {
    const dbQuery = vi.fn();
    const noDbApp = express();
    noDbApp.use(express.json());
    noDbApp.use('/api/llm-providers', createLlmProvidersRouter({ query: dbQuery }, 'unused-user-id'));
    runProviderAnalysis.mockResolvedValue({ text: 'OK', usedWebSearch: false });

    await request(noDbApp)
      .post('/api/llm-providers/test')
      .send({ provider_type: 'ollama', model: 'llama3.1' });

    expect(dbQuery).not.toHaveBeenCalled();
  });
});
