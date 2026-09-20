import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

// tests/helpers/loopback-listen.mjs patches supertest so test requests bind to
// 127.0.0.1 only. If a supertest upgrade keeps the method names but changes
// behaviour, these tests fail instead of the patch silently doing nothing.
const makeApp = () => {
  const app = express();
  app.get('/addr', (req, res) => res.json({ local: req.socket.localAddress }));
  return app;
};

describe('supertest loopback binding', () => {
  it('request(app) reaches the app over 127.0.0.1', async () => {
    const res = await request(makeApp()).get('/addr');
    expect(res.status).toBe(200);
    expect(res.body.local).toBe('127.0.0.1');
  });

  it('request.agent(app) reaches the app over 127.0.0.1', async () => {
    const res = await request.agent(makeApp()).get('/addr');
    expect(res.status).toBe(200);
    expect(res.body.local).toBe('127.0.0.1');
  });
});
