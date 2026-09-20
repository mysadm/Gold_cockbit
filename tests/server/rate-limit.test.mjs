import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../../server/auth/rateLimit.mjs';

describe('createRateLimiter', () => {
  it('allows up to max requests per window, then 429s with Retry-After', async () => {
    let t = 1_000;
    const app = express();
    app.use(createRateLimiter({ max: 2, windowMs: 60_000, now: () => t }));
    app.get('/', (req, res) => res.json({ ok: true }));
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    const blocked = await request(app).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    t += 61_000;
    expect((await request(app).get('/')).status).toBe(200);
  });
});
