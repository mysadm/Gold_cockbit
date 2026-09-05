import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLlmProvidersRouter } from '../../server/routes/llmProviders.mjs';
import { listProviderModels } from '../../server/providers/listModels.mjs';

vi.mock('../../server/providers/listModels.mjs', () => ({
  listProviderModels: vi.fn(),
}));

let app;

beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use('/api/llm-providers', createLlmProvidersRouter({ query: vi.fn() }, 'unused-user-id'));
  listProviderModels.mockReset();
});

describe('POST /api/llm-providers/models', () => {
  it('calls listProviderModels with the submitted draft fields and returns the model list', async () => {
    listProviderModels.mockResolvedValue(['gpt-4o', 'gpt-4o-mini']);

    const res = await request(app)
      .post('/api/llm-providers/models')
      .send({ provider_type: 'openai', base_url: null, api_key: 'sk-test', model: '' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: ['gpt-4o', 'gpt-4o-mini'] });
    expect(listProviderModels).toHaveBeenCalledWith({
      provider_type: 'openai',
      base_url: null,
      api_key: 'sk-test',
    });
  });

  it('returns 502 with the provider error message when the call fails', async () => {
    listProviderModels.mockRejectedValue(new Error('invalid api key'));

    const res = await request(app)
      .post('/api/llm-providers/models')
      .send({ provider_type: 'openai', api_key: 'bad-key' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid api key');
  });

  it('does not touch the database', async () => {
    const dbQuery = vi.fn();
    const noDbApp = express();
    noDbApp.use(express.json());
    noDbApp.use('/api/llm-providers', createLlmProvidersRouter({ query: dbQuery }, 'unused-user-id'));
    listProviderModels.mockResolvedValue([]);

    await request(noDbApp).post('/api/llm-providers/models').send({ provider_type: 'ollama' });

    expect(dbQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/llm-providers/:id/models', () => {
  it('resolves the saved connection and lists its models using the stored api_key', async () => {
    const dbQuery = vi.fn().mockResolvedValue({
      rows: [{ provider_type: 'openai', base_url: null, api_key: 'sk-secret', model: 'gpt-4o-mini', settings: {} }],
    });
    const idApp = express();
    idApp.use(express.json());
    idApp.use('/api/llm-providers', createLlmProvidersRouter({ query: dbQuery }, 'user-1'));
    listProviderModels.mockResolvedValue(['gpt-4o-mini']);

    const res = await request(idApp).get('/api/llm-providers/42/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: ['gpt-4o-mini'] });
    expect(listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ provider_type: 'openai', api_key: 'sk-secret' })
    );
  });

  it('returns 404 for an unknown or foreign connection id', async () => {
    const dbQuery = vi.fn().mockResolvedValue({ rows: [] });
    const idApp = express();
    idApp.use(express.json());
    idApp.use('/api/llm-providers', createLlmProvidersRouter({ query: dbQuery }, 'user-1'));

    const res = await request(idApp).get('/api/llm-providers/999999/models');
    expect(res.status).toBe(404);
  });

  it('returns 502 with the provider error message when the call fails', async () => {
    const dbQuery = vi.fn().mockResolvedValue({
      rows: [{ provider_type: 'openai', base_url: null, api_key: 'bad-key', model: 'gpt-4o-mini', settings: {} }],
    });
    const idApp = express();
    idApp.use(express.json());
    idApp.use('/api/llm-providers', createLlmProvidersRouter({ query: dbQuery }, 'user-1'));
    listProviderModels.mockRejectedValue(new Error('invalid api key'));

    const res = await request(idApp).get('/api/llm-providers/42/models');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid api key');
  });
});
