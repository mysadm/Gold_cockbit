import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createLlmProvidersRouter } from '../../server/routes/llmProviders.mjs';

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
});

afterEach(async () => {
  await client.end();
});

describe('llm-providers routes', () => {
  it('creates and lists a provider', async () => {
    const createRes = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'ollama', label: 'Home Ollama', base_url: 'http://localhost:11434/v1', model: 'llama3.1' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.label).toBe('Home Ollama');
    expect(createRes.body.is_active).toBe(false);

    const listRes = await request(app).get('/api/llm-providers');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('activates a provider and deactivates the previously active one', async () => {
    const first = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'claude', label: 'Claude', api_key: 'sk-ant-test', model: 'claude-sonnet-4-6' });
    const second = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'openai', label: 'OpenAI', api_key: 'sk-test', model: 'gpt-4o' });

    await request(app).post(`/api/llm-providers/${first.body.id}/activate`).expect(200);

    let list = await request(app).get('/api/llm-providers');
    expect(list.body.find((p) => p.id === first.body.id).is_active).toBe(true);
    expect(list.body.find((p) => p.id === second.body.id).is_active).toBe(false);

    await request(app).post(`/api/llm-providers/${second.body.id}/activate`).expect(200);

    list = await request(app).get('/api/llm-providers');
    expect(list.body.find((p) => p.id === first.body.id).is_active).toBe(false);
    expect(list.body.find((p) => p.id === second.body.id).is_active).toBe(true);
  });

  it('updates a provider', async () => {
    const created = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'custom', label: 'My Custom', base_url: 'http://example.com/v1', api_key: 'k', model: 'm1' });

    const updated = await request(app)
      .put(`/api/llm-providers/${created.body.id}`)
      .send({ provider_type: 'custom', label: 'Renamed', base_url: 'http://example.com/v1', api_key: 'k', model: 'm2' });

    expect(updated.status).toBe(200);
    expect(updated.body.label).toBe('Renamed');
    expect(updated.body.model).toBe('m2');
  });

  it('returns 404 when updating a provider that does not exist', async () => {
    const res = await request(app)
      .put('/api/llm-providers/999999')
      .send({ provider_type: 'ollama', label: 'X', model: 'llama3.1' });

    expect(res.status).toBe(404);
  });

  it('rejects creating a provider with an empty label', async () => {
    const res = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'ollama', label: '', base_url: 'http://localhost:11434/v1', model: 'llama3.1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('rejects creating a provider with an empty model', async () => {
    const res = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'ollama', label: 'Home Ollama', base_url: 'http://localhost:11434/v1', model: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model/i);
  });

  it('rejects updating a provider to have an empty label or model', async () => {
    const created = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'ollama', label: 'Home Ollama', base_url: 'http://localhost:11434/v1', model: 'llama3.1' });

    const res = await request(app)
      .put(`/api/llm-providers/${created.body.id}`)
      .send({ provider_type: 'ollama', label: '  ', base_url: 'http://localhost:11434/v1', model: 'llama3.1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('deletes a provider', async () => {
    const created = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'ollama', label: 'To delete', base_url: 'http://localhost:11434/v1', model: 'llama3.1' });

    await request(app).delete(`/api/llm-providers/${created.body.id}`).expect(204);

    const list = await request(app).get('/api/llm-providers');
    expect(list.body).toHaveLength(0);
  });
});
