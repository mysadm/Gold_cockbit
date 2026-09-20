import request from 'supertest';
import { hashPassword } from '../../server/auth/password.mjs';

export async function createTestUser(
  db,
  { email, password = 'password123', role = 'user', status = 'active', displayName = null, dailyAiLimit } = {}
) {
  const hash = await hashPassword(password);
  const withLimit = dailyAiLimit !== undefined;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, status, display_name${withLimit ? ', daily_ai_limit' : ''})
     VALUES ($1, $2, $3, $4, $5${withLimit ? ', $6' : ''}) RETURNING id`,
    withLimit ? [email, hash, role, status, displayName, dailyAiLimit] : [email, hash, role, status, displayName]
  );
  return { id: rows[0].id, email, password };
}

export async function signIn(app, { email, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
