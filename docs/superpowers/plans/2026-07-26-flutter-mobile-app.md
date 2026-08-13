# Flutter Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Flutter mobile app (iOS + Android) in a new `flutter_app/` folder that replicates all Gold Cockpit functionality, backed by the existing Express/Postgres API, extended with the four missing DB-backed endpoints (scenarios, tranches, watchlist, alert_rules).

**Architecture:** Backend gets four new Express routers (mirroring the existing `llmProviders.mjs` pattern) plus two seed helpers so a fresh user has scenario/tranche rows to read. The Flutter app is a pure API client: Riverpod providers call feature repositories, which call either `dio` (DB-backed features) or a local price-feed fallback chain (live market data, replicated from `src/App.tsx`'s `pullLive`). No login — single default user, matching current web app behavior.

**Tech Stack:** Node/Express/Postgres (existing, extended) · Flutter 3.24+/Dart 3.5+, `flutter_riverpod` ^2.6.1, `dio` ^5.7.0, `flutter_secure_storage` ^9.2.2, `mocktail` ^1.0.4 (tests).

## Global Constraints

- Every new backend route uses `createApiKeyAuthMiddleware()` exactly like `server/routes/llmProviders.mjs` — no new auth model.
- Every new backend route scopes all queries to the shared `userId`, passed in like the existing routes (never trust a `user_id` from the request body).
- No changes to `price_snapshots`, the auth model, or existing routes (`llm-providers`, `analyze`, `egypt-prices`).
- Flutter app has no login screen — it holds one configured base URL + optional API key (`flutter_secure_storage`) and operates as the single default user.
- No `innerHTML`-style raw-HTML rendering anywhere in Flutter — AI analyst response fields render as plain `Text` widgets only.
- Every feature folder under `flutter_app/lib/features/<name>/` has its own `data/`, `application/`, `presentation/` subfolders; no cross-feature imports except through `core/`.
- Test commands: backend tests run via `npm test` (vitest) from repo root; Flutter tests run via `flutter test` from `flutter_app/`.
- Scope note: `shared_preferences` backs a language toggle (Task 11) persisted across launches and reflected in the app shell's app bar and drawer. Per-screen strings inside individual feature screens (Tasks 12–19) remain hardcoded to English for this iteration — reacting to the toggle everywhere, and a light/dark theme toggle, are deferred to a follow-up plan rather than bundled into an already-large first pass.

---

## Task 1: Scenarios API route

**Files:**
- Create: `server/ensureDefaultScenarios.mjs`
- Create: `server/routes/scenarios.mjs`
- Test: `tests/server/scenarios-routes.test.mjs`
- Test: `tests/server/ensure-default-scenarios.test.mjs`

**Interfaces:**
- Produces: `ensureDefaultScenarios(db, userId): Promise<void>` — idempotent seed of 3 fixed scenario rows if none exist for `userId`.
- Produces: `createScenariosRouter(db, userId): express.Router` with `GET /` and `PATCH /:id`.

- [ ] **Step 1: Write the failing test for the seed helper**

```js
// tests/server/ensure-default-scenarios.test.mjs
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultScenarios', () => {
  it('seeds exactly 3 scenarios for a fresh user', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultScenarios(client, userId);

    const { rows } = await client.query(
      'SELECT name, band_low, band_high, weight_pct, sort_order FROM scenarios WHERE user_id = $1 ORDER BY sort_order',
      [userId]
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['De-escalation', 'Base Case', 'Stagflation Trap']);
    expect(rows.map((r) => Number(r.weight_pct))).toEqual([35, 45, 20]);
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultScenarios(client, userId);
    await ensureDefaultScenarios(client, userId);

    const { rows } = await client.query('SELECT id FROM scenarios WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/ensure-default-scenarios.test.mjs`
Expected: FAIL — `Cannot find module '../../server/ensureDefaultScenarios.mjs'`

- [ ] **Step 3: Implement the seed helper**

```js
// server/ensureDefaultScenarios.mjs
const DEFAULT_SCENARIOS = [
  { name: 'De-escalation', band_low: 5800, band_high: 6300, weight_pct: 35, sort_order: 0 },
  { name: 'Base Case', band_low: 5000, band_high: 5400, weight_pct: 45, sort_order: 1 },
  { name: 'Stagflation Trap', band_low: 3600, band_high: 4000, weight_pct: 20, sort_order: 2 },
];

export async function ensureDefaultScenarios(db, userId) {
  const { rows } = await db.query('SELECT id FROM scenarios WHERE user_id = $1 LIMIT 1', [userId]);
  if (rows.length > 0) return;

  for (const scenario of DEFAULT_SCENARIOS) {
    await db.query(
      `INSERT INTO scenarios (user_id, name, band_low, band_high, weight_pct, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, scenario.name, scenario.band_low, scenario.band_high, scenario.weight_pct, scenario.sort_order]
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/ensure-default-scenarios.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for the route**

```js
// tests/server/scenarios-routes.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { createScenariosRouter } from '../../server/routes/scenarios.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  await ensureDefaultScenarios(client, userId);
  app = express();
  app.use(express.json());
  app.use('/api/scenarios', createScenariosRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('scenarios routes', () => {
  it('lists the seeded scenarios ordered by sort_order', async () => {
    const res = await request(app).get('/api/scenarios');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].name).toBe('De-escalation');
  });

  it('updates weight_pct on a scenario', async () => {
    const list = await request(app).get('/api/scenarios');
    const target = list.body[0];

    const res = await request(app)
      .patch(`/api/scenarios/${target.id}`)
      .send({ weight_pct: 60 });

    expect(res.status).toBe(200);
    expect(Number(res.body.weight_pct)).toBe(60);
  });

  it('rejects a weight_pct above 100', async () => {
    const list = await request(app).get('/api/scenarios');
    const target = list.body[0];

    const res = await request(app)
      .patch(`/api/scenarios/${target.id}`)
      .send({ weight_pct: 150 });

    expect(res.status).toBe(400);
  });

  it('returns 404 when updating a scenario that does not exist', async () => {
    const res = await request(app).patch('/api/scenarios/999999').send({ weight_pct: 40 });
    expect(res.status).toBe(404);
  });

  it('rejects a PATCH with no updatable fields', async () => {
    const list = await request(app).get('/api/scenarios');
    const target = list.body[0];

    const res = await request(app).patch(`/api/scenarios/${target.id}`).send({});
    expect(res.status).toBe(400);
  });

  it('requires a configured API key when GOLD_COCKPIT_API_KEY is set', async () => {
    const previousKey = process.env.GOLD_COCKPIT_API_KEY;
    process.env.GOLD_COCKPIT_API_KEY = 'test-secret';
    try {
      const denied = await request(app).get('/api/scenarios');
      expect(denied.status).toBe(401);
      const allowed = await request(app).get('/api/scenarios').set('x-api-key', 'test-secret');
      expect(allowed.status).toBe(200);
    } finally {
      if (previousKey === undefined) delete process.env.GOLD_COCKPIT_API_KEY;
      else process.env.GOLD_COCKPIT_API_KEY = previousKey;
    }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- tests/server/scenarios-routes.test.mjs`
Expected: FAIL — `Cannot find module '../../server/routes/scenarios.mjs'`

- [ ] **Step 7: Implement the route**

```js
// server/routes/scenarios.mjs
import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, name, band_low, band_high, weight_pct, probability_pct, sort_order, created_at, updated_at';
const UPDATABLE_FIELDS = ['name', 'band_low', 'band_high', 'weight_pct', 'probability_pct', 'sort_order'];

export function createScenariosRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM scenarios WHERE user_id = $1 ORDER BY sort_order`,
      [userId]
    );
    res.json(rows);
  });

  router.patch('/:id', async (req, res) => {
    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => req.body[field]);

    try {
      const { rows } = await db.query(
        `UPDATE scenarios SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
        [...values, req.params.id, userId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Scenario not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23514') return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- tests/server/scenarios-routes.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add server/ensureDefaultScenarios.mjs server/routes/scenarios.mjs tests/server/scenarios-routes.test.mjs tests/server/ensure-default-scenarios.test.mjs
git commit -m "feat: add scenarios API route with default seeding"
```

---

## Task 2: Tranches API route

**Files:**
- Create: `server/ensureDefaultTranches.mjs`
- Create: `server/routes/tranches.mjs`
- Test: `tests/server/tranches-routes.test.mjs`
- Test: `tests/server/ensure-default-tranches.test.mjs`

**Interfaces:**
- Produces: `ensureDefaultTranches(db, userId): Promise<void>` — idempotent seed of 3 fixed tranche rows (40/35/25 plan, all `pending`) if none exist.
- Produces: `createTranchesRouter(db, userId): express.Router` with `GET /` and `PATCH /:id`.

- [ ] **Step 1: Write the failing test for the seed helper**

```js
// tests/server/ensure-default-tranches.test.mjs
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultTranches } from '../../server/ensureDefaultTranches.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultTranches', () => {
  it('seeds exactly 3 tranches with the 40/35/25 plan', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultTranches(client, userId);

    const { rows } = await client.query(
      'SELECT tranche_number, plan_pct, status FROM tranches WHERE user_id = $1 ORDER BY tranche_number',
      [userId]
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.tranche_number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => Number(r.plan_pct))).toEqual([40, 35, 25]);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultTranches(client, userId);
    await ensureDefaultTranches(client, userId);

    const { rows } = await client.query('SELECT id FROM tranches WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/ensure-default-tranches.test.mjs`
Expected: FAIL — `Cannot find module '../../server/ensureDefaultTranches.mjs'`

- [ ] **Step 3: Implement the seed helper**

```js
// server/ensureDefaultTranches.mjs
const DEFAULT_TRANCHES = [
  { tranche_number: 1, plan_pct: 40 },
  { tranche_number: 2, plan_pct: 35 },
  { tranche_number: 3, plan_pct: 25 },
];

export async function ensureDefaultTranches(db, userId) {
  const { rows } = await db.query('SELECT id FROM tranches WHERE user_id = $1 LIMIT 1', [userId]);
  if (rows.length > 0) return;

  for (const tranche of DEFAULT_TRANCHES) {
    await db.query(
      `INSERT INTO tranches (user_id, tranche_number, plan_pct) VALUES ($1, $2, $3)`,
      [userId, tranche.tranche_number, tranche.plan_pct]
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/ensure-default-tranches.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for the route**

```js
// tests/server/tranches-routes.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultTranches } from '../../server/ensureDefaultTranches.mjs';
import { createTranchesRouter } from '../../server/routes/tranches.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  await ensureDefaultTranches(client, userId);
  app = express();
  app.use(express.json());
  app.use('/api/tranches', createTranchesRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('tranches routes', () => {
  it('lists the seeded tranches ordered by tranche_number', async () => {
    const res = await request(app).get('/api/tranches');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((t) => t.tranche_number)).toEqual([1, 2, 3]);
  });

  it('updates status and amount_egp on a tranche', async () => {
    const list = await request(app).get('/api/tranches');
    const target = list.body[0];

    const res = await request(app)
      .patch(`/api/tranches/${target.id}`)
      .send({ status: 'filled', amount_egp: 250000, gram_equivalent: 42.5 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('filled');
    expect(Number(res.body.amount_egp)).toBe(250000);
  });

  it('rejects an invalid status', async () => {
    const list = await request(app).get('/api/tranches');
    const target = list.body[0];

    const res = await request(app).patch(`/api/tranches/${target.id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when updating a tranche that does not exist', async () => {
    const res = await request(app).patch('/api/tranches/999999').send({ status: 'filled' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- tests/server/tranches-routes.test.mjs`
Expected: FAIL — `Cannot find module '../../server/routes/tranches.mjs'`

- [ ] **Step 7: Implement the route**

```js
// server/routes/tranches.mjs
import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, tranche_number, plan_pct, amount_egp, gram_equivalent, status, purchased_at, created_at, updated_at';
const UPDATABLE_FIELDS = ['status', 'amount_egp', 'gram_equivalent', 'purchased_at'];

export function createTranchesRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM tranches WHERE user_id = $1 ORDER BY tranche_number`,
      [userId]
    );
    res.json(rows);
  });

  router.patch('/:id', async (req, res) => {
    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => req.body[field]);

    try {
      const { rows } = await db.query(
        `UPDATE tranches SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
        [...values, req.params.id, userId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Tranche not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23514') return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- tests/server/tranches-routes.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add server/ensureDefaultTranches.mjs server/routes/tranches.mjs tests/server/tranches-routes.test.mjs tests/server/ensure-default-tranches.test.mjs
git commit -m "feat: add tranches API route with default seeding"
```

---

## Task 3: Watchlist API route

**Files:**
- Create: `server/routes/watchlist.mjs`
- Test: `tests/server/watchlist-routes.test.mjs`

**Interfaces:**
- Produces: `createWatchlistRouter(db, userId): express.Router` with `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`.

- [ ] **Step 1: Write the failing test**

```js
// tests/server/watchlist-routes.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createWatchlistRouter } from '../../server/routes/watchlist.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  app = express();
  app.use(express.json());
  app.use('/api/watchlist', createWatchlistRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('watchlist routes', () => {
  it('creates and lists a watchlist item', async () => {
    const createRes = await request(app)
      .post('/api/watchlist')
      .send({ label: 'Oil prices', status: 'support' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.label).toBe('Oil prices');

    const listRes = await request(app).get('/api/watchlist');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('rejects creating an item with an empty label', async () => {
    const res = await request(app).post('/api/watchlist').send({ label: '', status: 'support' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('rejects creating an item with a label over 40 characters', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .send({ label: 'x'.repeat(41), status: 'support' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('updates a watchlist item status', async () => {
    const created = await request(app).post('/api/watchlist').send({ label: 'Fed policy', status: 'watch' });

    const updated = await request(app)
      .patch(`/api/watchlist/${created.body.id}`)
      .send({ status: 'risk' });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('risk');
  });

  it('returns 404 when updating an item that does not exist', async () => {
    const res = await request(app).patch('/api/watchlist/999999').send({ status: 'risk' });
    expect(res.status).toBe(404);
  });

  it('deletes a watchlist item', async () => {
    const created = await request(app).post('/api/watchlist').send({ label: 'To delete', status: 'watch' });

    await request(app).delete(`/api/watchlist/${created.body.id}`).expect(204);

    const list = await request(app).get('/api/watchlist');
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/watchlist-routes.test.mjs`
Expected: FAIL — `Cannot find module '../../server/routes/watchlist.mjs'`

- [ ] **Step 3: Implement the route**

```js
// server/routes/watchlist.mjs
import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, label, status, sort_order, created_at, updated_at';
const UPDATABLE_FIELDS = ['label', 'status', 'sort_order'];

function labelError(label) {
  if (!label || !label.trim()) return 'label is required';
  if (label.length > 40) return 'label must be 40 characters or fewer';
  return null;
}

export function createWatchlistRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM watchlist_items WHERE user_id = $1 ORDER BY sort_order`,
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { label, status, sort_order } = req.body;
    const error = labelError(label);
    if (error) return res.status(400).json({ error });

    const { rows } = await db.query(
      `INSERT INTO watchlist_items (user_id, label, status, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLUMNS}`,
      [userId, label, status, sort_order ?? 0]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    if ('label' in req.body) {
      const error = labelError(req.body.label);
      if (error) return res.status(400).json({ error });
    }

    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => req.body[field]);

    const { rows } = await db.query(
      `UPDATE watchlist_items SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
      [...values, req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Watchlist item not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM watchlist_items WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/watchlist-routes.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/routes/watchlist.mjs tests/server/watchlist-routes.test.mjs
git commit -m "feat: add watchlist API route"
```

---

## Task 4: Alert rules API route

**Files:**
- Create: `server/routes/alertRules.mjs`
- Test: `tests/server/alert-rules-routes.test.mjs`

**Interfaces:**
- Produces: `createAlertRulesRouter(db, userId): express.Router` with `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`.

- [ ] **Step 1: Write the failing test**

```js
// tests/server/alert-rules-routes.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createAlertRulesRouter } from '../../server/routes/alertRules.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  app = express();
  app.use(express.json());
  app.use('/api/alert-rules', createAlertRulesRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('alert rules routes', () => {
  it('creates and lists an alert rule', async () => {
    const createRes = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'band_edge', config: { scenario: 'base', edge: 'low' } });

    expect(createRes.status).toBe(201);
    expect(createRes.body.rule_type).toBe('band_edge');
    expect(createRes.body.active).toBe(true);

    const listRes = await request(app).get('/api/alert-rules');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('rejects an invalid rule_type', async () => {
    const res = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'bogus', config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rule_type/i);
  });

  it('rejects a missing config', async () => {
    const res = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'egp_move' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/config/i);
  });

  it('updates active flag on a rule', async () => {
    const created = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'tranche_window', config: { tranche: 2 } });

    const updated = await request(app)
      .patch(`/api/alert-rules/${created.body.id}`)
      .send({ active: false });

    expect(updated.status).toBe(200);
    expect(updated.body.active).toBe(false);
  });

  it('returns 404 when updating a rule that does not exist', async () => {
    const res = await request(app).patch('/api/alert-rules/999999').send({ active: false });
    expect(res.status).toBe(404);
  });

  it('deletes an alert rule', async () => {
    const created = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'egp_move', config: { threshold_pct: 2 } });

    await request(app).delete(`/api/alert-rules/${created.body.id}`).expect(204);

    const list = await request(app).get('/api/alert-rules');
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/alert-rules-routes.test.mjs`
Expected: FAIL — `Cannot find module '../../server/routes/alertRules.mjs'`

- [ ] **Step 3: Implement the route**

```js
// server/routes/alertRules.mjs
import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, rule_type, config, active, created_at, updated_at';
const UPDATABLE_FIELDS = ['rule_type', 'config', 'active'];
const VALID_RULE_TYPES = ['band_edge', 'egp_move', 'tranche_window'];

function ruleValidationError(ruleType, config) {
  if (!VALID_RULE_TYPES.includes(ruleType)) return 'rule_type must be one of band_edge, egp_move, tranche_window';
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 'config is required and must be an object';
  return null;
}

export function createAlertRulesRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM alert_rules WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { rule_type, config } = req.body;
    const error = ruleValidationError(rule_type, config);
    if (error) return res.status(400).json({ error });

    const { rows } = await db.query(
      `INSERT INTO alert_rules (user_id, rule_type, config) VALUES ($1, $2, $3) RETURNING ${PUBLIC_COLUMNS}`,
      [userId, rule_type, config]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    if ('rule_type' in req.body && !VALID_RULE_TYPES.includes(req.body.rule_type)) {
      return res.status(400).json({ error: 'rule_type must be one of band_edge, egp_move, tranche_window' });
    }

    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => (field === 'config' ? JSON.stringify(req.body[field]) : req.body[field]));

    const { rows } = await db.query(
      `UPDATE alert_rules SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
      [...values, req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Alert rule not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM alert_rules WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/alert-rules-routes.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/routes/alertRules.mjs tests/server/alert-rules-routes.test.mjs
git commit -m "feat: add alert rules API route"
```

---

## Task 5: Mount new routes and seed on startup

**Files:**
- Modify: `server/index.mjs`
- Test: `tests/server/index-routes-smoke.test.mjs`

**Interfaces:**
- Consumes: `ensureDefaultScenarios` (Task 1), `ensureDefaultTranches` (Task 2), `createScenariosRouter` (Task 1), `createTranchesRouter` (Task 2), `createWatchlistRouter` (Task 3), `createAlertRulesRouter` (Task 4).

- [ ] **Step 1: Write the failing smoke test**

```js
// tests/server/index-routes-smoke.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from '../../server/ensureDefaultTranches.mjs';
import { createScenariosRouter } from '../../server/routes/scenarios.mjs';
import { createTranchesRouter } from '../../server/routes/tranches.mjs';
import { createWatchlistRouter } from '../../server/routes/watchlist.mjs';
import { createAlertRulesRouter } from '../../server/routes/alertRules.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;

afterEach(async () => {
  await client.end();
});

describe('full route wiring (mirrors server/index.mjs)', () => {
  beforeEach(async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);
    await ensureDefaultScenarios(client, userId);
    await ensureDefaultTranches(client, userId);

    app = express();
    app.use(express.json());
    app.use('/api/scenarios', createScenariosRouter(client, userId));
    app.use('/api/tranches', createTranchesRouter(client, userId));
    app.use('/api/watchlist', createWatchlistRouter(client, userId));
    app.use('/api/alert-rules', createAlertRulesRouter(client, userId));
  });

  it('serves all four new endpoints', async () => {
    expect((await request(app).get('/api/scenarios')).status).toBe(200);
    expect((await request(app).get('/api/tranches')).status).toBe(200);
    expect((await request(app).get('/api/watchlist')).status).toBe(200);
    expect((await request(app).get('/api/alert-rules')).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/index-routes-smoke.test.mjs`
Expected: FAIL — one or more router modules not found (until Tasks 1–4 are merged; if run after those tasks, this step should already pass — in that case skip to Step 4 and confirm)

- [ ] **Step 3: Wire the routers into server/index.mjs**

```js
// server/index.mjs
import 'dotenv/config';
import express from 'express';
import { getPool } from './pool.mjs';
import { ensureDefaultUser } from './ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from './ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from './ensureDefaultTranches.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';
import { createEgyptPricesRouter } from './routes/egyptPrices.mjs';
import { createScenariosRouter } from './routes/scenarios.mjs';
import { createTranchesRouter } from './routes/tranches.mjs';
import { createWatchlistRouter } from './routes/watchlist.mjs';
import { createAlertRulesRouter } from './routes/alertRules.mjs';

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const userId = await ensureDefaultUser(pool);
await ensureDefaultScenarios(pool, userId);
await ensureDefaultTranches(pool, userId);

const app = express();
app.use(express.json());
app.use('/api/llm-providers', createLlmProvidersRouter(pool, userId));
app.use('/api/analyze', createAnalyzeRouter(pool, userId));
app.use('/api/egypt-prices', createEgyptPricesRouter());
app.use('/api/scenarios', createScenariosRouter(pool, userId));
app.use('/api/tranches', createTranchesRouter(pool, userId));
app.use('/api/watchlist', createWatchlistRouter(pool, userId));
app.use('/api/alert-rules', createAlertRulesRouter(pool, userId));

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/index-routes-smoke.test.mjs`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new ones from Tasks 1–5

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs tests/server/index-routes-smoke.test.mjs
git commit -m "feat: mount scenarios, tranches, watchlist, and alert-rules routes with default seeding"
```

---

## Task 6: Flutter project scaffold

**Files:**
- Create: `flutter_app/` (via `flutter create`)
- Modify: `flutter_app/pubspec.yaml`
- Create: `flutter_app/lib/core/` (empty dirs), `flutter_app/lib/features/` (empty dirs), `flutter_app/lib/l10n/` (empty dir)

**Interfaces:**
- Produces: a runnable Flutter project skeleton at `flutter_app/` with dependencies installed, ready for later tasks to fill in `lib/`.

- [ ] **Step 1: Scaffold the project**

Run from repo root:
```bash
flutter create --org com.goldcockpit --project-name gold_cockpit_mobile flutter_app
```

- [ ] **Step 2: Add dependencies to pubspec.yaml**

Edit `flutter_app/pubspec.yaml` — replace the `dependencies:`/`dev_dependencies:` sections with:

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.6.1
  dio: ^5.7.0
  flutter_secure_storage: ^9.2.2
  shared_preferences: ^2.3.3
  intl: ^0.19.0
  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^5.0.0
  mocktail: ^1.0.4
```

- [ ] **Step 3: Install dependencies**

Run: `cd flutter_app && flutter pub get`
Expected: resolves with no errors

- [ ] **Step 4: Create the folder skeleton**

```bash
mkdir -p flutter_app/lib/core/price_feed
mkdir -p flutter_app/lib/features/market/data flutter_app/lib/features/market/application flutter_app/lib/features/market/presentation
mkdir -p flutter_app/lib/features/calculator/data flutter_app/lib/features/calculator/application flutter_app/lib/features/calculator/presentation
mkdir -p flutter_app/lib/features/scenarios/data flutter_app/lib/features/scenarios/application flutter_app/lib/features/scenarios/presentation
mkdir -p flutter_app/lib/features/tranches/data flutter_app/lib/features/tranches/application flutter_app/lib/features/tranches/presentation
mkdir -p flutter_app/lib/features/watchlist/data flutter_app/lib/features/watchlist/application flutter_app/lib/features/watchlist/presentation
mkdir -p flutter_app/lib/features/llm_providers/data flutter_app/lib/features/llm_providers/application flutter_app/lib/features/llm_providers/presentation
mkdir -p flutter_app/lib/features/egypt_prices/data flutter_app/lib/features/egypt_prices/application flutter_app/lib/features/egypt_prices/presentation
mkdir -p flutter_app/lib/features/ai_analyst/data flutter_app/lib/features/ai_analyst/application flutter_app/lib/features/ai_analyst/presentation
mkdir -p flutter_app/lib/l10n
touch flutter_app/lib/core/.gitkeep
```

- [ ] **Step 5: Verify the default counter app still builds**

Run: `cd flutter_app && flutter analyze`
Expected: "No issues found!"

- [ ] **Step 6: Commit**

```bash
git add flutter_app
git commit -m "chore: scaffold Flutter app with dependencies and folder structure"
```

---

## Task 7: Core config (secure storage abstraction)

**Files:**
- Create: `flutter_app/lib/core/secure_store.dart`
- Create: `flutter_app/lib/core/app_config.dart`
- Test: `flutter_app/test/core/app_config_test.dart`

**Interfaces:**
- Produces: `abstract class SecureStore { Future<String?> read(String key); Future<void> write(String key, String value); }`
- Produces: `class FlutterSecureStore implements SecureStore` (real impl wrapping `flutter_secure_storage`)
- Produces: `class AppConfig` with `Future<String> get baseUrl`, `Future<void> setBaseUrl(String)`, `Future<String?> get apiKey`, `Future<void> setApiKey(String)`, `Future<bool> get isConfigured`, `static const defaultBaseUrl`.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/core/app_config_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }
}

void main() {
  group('AppConfig', () {
    test('baseUrl defaults to defaultBaseUrl when unset', () async {
      final config = AppConfig(FakeSecureStore());
      expect(await config.baseUrl, AppConfig.defaultBaseUrl);
    });

    test('setBaseUrl persists and is read back', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setBaseUrl('http://192.168.1.10:8787');
      expect(await config.baseUrl, 'http://192.168.1.10:8787');
    });

    test('apiKey is null when unset', () async {
      final config = AppConfig(FakeSecureStore());
      expect(await config.apiKey, isNull);
    });

    test('setApiKey persists and is read back', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setApiKey('secret-123');
      expect(await config.apiKey, 'secret-123');
    });

    test('isConfigured is true once a base URL is set (default counts as configured)', () async {
      final config = AppConfig(FakeSecureStore());
      expect(await config.isConfigured, isTrue);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/core/app_config_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:gold_cockpit_mobile/core/app_config.dart'`

- [ ] **Step 3: Implement SecureStore and AppConfig**

```dart
// flutter_app/lib/core/secure_store.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class FlutterSecureStore implements SecureStore {
  const FlutterSecureStore();

  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
}
```

```dart
// flutter_app/lib/core/app_config.dart
import 'secure_store.dart';

class AppConfig {
  AppConfig(this._store);

  static const _baseUrlKey = 'gold_cockpit_base_url';
  static const _apiKeyKey = 'gold_cockpit_api_key';
  static const defaultBaseUrl = 'http://localhost:8787';

  final SecureStore _store;

  Future<String> get baseUrl async => (await _store.read(_baseUrlKey)) ?? defaultBaseUrl;

  Future<void> setBaseUrl(String value) => _store.write(_baseUrlKey, value);

  Future<String?> get apiKey => _store.read(_apiKeyKey);

  Future<void> setApiKey(String value) => _store.write(_apiKeyKey, value);

  Future<bool> get isConfigured async => (await baseUrl).isNotEmpty;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/core/app_config_test.dart`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/core/secure_store.dart flutter_app/lib/core/app_config.dart flutter_app/test/core/app_config_test.dart
git commit -m "feat: add AppConfig for base URL / API key persistence"
```

---

## Task 8: Core API client

**Files:**
- Create: `flutter_app/lib/core/api_client.dart`
- Test: `flutter_app/test/core/api_client_test.dart`

**Interfaces:**
- Consumes: `AppConfig` (Task 7).
- Produces: `Future<void> applyAuth(RequestOptions options, AppConfig config)` (pure, testable auth-header logic).
- Produces: `class ApiClient { ApiClient(AppConfig config); Dio get dio; }` — a `Dio` instance with an interceptor calling `applyAuth`, `connectTimeout` 15s, `receiveTimeout` 90s (matches the 90s AI-analysis timeout in the web app).

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/core/api_client_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/api_client.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  group('applyAuth', () {
    test('sets baseUrl from config and no x-api-key header when apiKey is unset', () async {
      final config = AppConfig(FakeSecureStore());
      final options = RequestOptions(path: '/api/scenarios');

      await applyAuth(options, config);

      expect(options.baseUrl, AppConfig.defaultBaseUrl);
      expect(options.headers.containsKey('x-api-key'), isFalse);
    });

    test('sets x-api-key header when apiKey is configured', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setApiKey('secret-123');
      final options = RequestOptions(path: '/api/scenarios');

      await applyAuth(options, config);

      expect(options.headers['x-api-key'], 'secret-123');
    });
  });

  group('ApiClient', () {
    test('exposes a Dio instance with the auth interceptor attached', () {
      final client = ApiClient(AppConfig(FakeSecureStore()));
      expect(client.dio, isA<Dio>());
      expect(client.dio.interceptors, isNotEmpty);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/core/api_client_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:gold_cockpit_mobile/core/api_client.dart'`

- [ ] **Step 3: Implement ApiClient**

```dart
// flutter_app/lib/core/api_client.dart
import 'package:dio/dio.dart';
import 'app_config.dart';

Future<void> applyAuth(RequestOptions options, AppConfig config) async {
  options.baseUrl = await config.baseUrl;
  final apiKey = await config.apiKey;
  if (apiKey != null && apiKey.isNotEmpty) {
    options.headers['x-api-key'] = apiKey;
  }
}

class ApiClient {
  ApiClient(this._config) : _dio = Dio() {
    _dio.options.connectTimeout = const Duration(seconds: 15);
    _dio.options.receiveTimeout = const Duration(seconds: 90);
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          await applyAuth(options, _config);
          handler.next(options);
        },
      ),
    );
  }

  final AppConfig _config;
  final Dio _dio;

  Dio get dio => _dio;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/core/api_client_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/core/api_client.dart flutter_app/test/core/api_client_test.dart
git commit -m "feat: add ApiClient with x-api-key auth interceptor"
```

---

## Task 9: Domain math helpers

**Files:**
- Create: `flutter_app/lib/core/domain.dart`
- Test: `flutter_app/test/core/domain_test.dart`

**Interfaces:**
- Produces: `double clampValue(double value, double min, double max)`
- Produces: `List<double> rebalanceScenarioWeights(List<double> weights, int changedIndex, double value)` — ports `src/domain.ts:rebalanceScenarioWeights` exactly (3-element list, clamp 10..90, others rescaled to sum to 100).
- Produces: `double calculateWeightedTarget(List<double> weights, double spot)` — ports `src/domain.ts:calculateWeightedTarget` (targets at spot×1.05, spot×1.00, spot×0.95).
- Produces: `class KaratBreakdown { final double twentyFourK; final double twentyOneK; final double eighteenK; }` and `KaratBreakdown calculateKaratBreakdown(double egpAmount, double gram24k, double gram21k, double gram18k)`.
- Produces: `const goldOunceGrams = 31.1035;`
- Produces: `class GramPrices { final double g24; final double g21; final double g18; final double goldPound; }` and `GramPrices calculateGramPrices({required double spotUsd, required double usdEgp, required double premiumPct})` — ports the `g24/g21/g18/pound` formulas from `src/App.tsx:330-333`.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/core/domain_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/domain.dart';

void main() {
  group('clampValue', () {
    test('clamps below min', () => expect(clampValue(5, 10, 90), 10));
    test('clamps above max', () => expect(clampValue(95, 10, 90), 90));
    test('passes through in range', () => expect(clampValue(50, 10, 90), 50));
  });

  group('rebalanceScenarioWeights', () {
    test('rebalances the other two weights to keep the total at 100', () {
      final result = rebalanceScenarioWeights([35, 45, 20], 0, 60);
      expect(result[0], 60);
      expect(result.reduce((a, b) => a + b), 100);
    });

    test('clamps the changed weight to the 10..90 range', () {
      final result = rebalanceScenarioWeights([35, 45, 20], 0, 95);
      expect(result[0], 90);
    });
  });

  group('calculateWeightedTarget', () {
    test('computes the probability-weighted target across the three bands', () {
      final target = calculateWeightedTarget([35, 45, 20], 5000);
      // (35*5250 + 45*5000 + 20*4750) / 100 = 5037.5
      expect(target, closeTo(5037.5, 0.001));
    });
  });

  group('calculateKaratBreakdown', () {
    test('divides the EGP amount by each karat gram price', () {
      final result = calculateKaratBreakdown(10000, 5000, 4375, 3750);
      expect(result.twentyFourK, closeTo(2.0, 0.001));
      expect(result.twentyOneK, closeTo(2.2857, 0.001));
      expect(result.eighteenK, closeTo(2.6667, 0.001));
    });
  });

  group('calculateGramPrices', () {
    test('derives g24/g21/g18/goldPound from spot, EGP rate, and premium', () {
      final result = calculateGramPrices(spotUsd: 5000, usdEgp: 50, premiumPct: 2);
      final expectedG24 = (5000 / goldOunceGrams) * 50 * 1.02;
      expect(result.g24, closeTo(expectedG24, 0.001));
      expect(result.g21, closeTo(expectedG24 * 0.875, 0.001));
      expect(result.g18, closeTo(expectedG24 * 0.75, 0.001));
      expect(result.goldPound, closeTo(expectedG24 * 0.875 * 8, 0.001));
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/core/domain_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:gold_cockpit_mobile/core/domain.dart'`

- [ ] **Step 3: Implement the domain helpers**

```dart
// flutter_app/lib/core/domain.dart
const double goldOunceGrams = 31.1035;

double clampValue(double value, double min, double max) {
  return value < min ? min : (value > max ? max : value);
}

List<double> rebalanceScenarioWeights(List<double> weights, int changedIndex, double value) {
  final next = List<double>.from(weights);
  next[changedIndex] = clampValue(value, 10, 90);

  final changedValue = next[changedIndex];
  final otherTotal = next.asMap().entries.fold<double>(
        0,
        (sum, entry) => sum + (entry.key == changedIndex ? 0 : entry.value),
      );
  final otherTarget = 100 - changedValue;

  final adjusted = next.asMap().entries.map((entry) {
    if (entry.key == changedIndex) return changedValue;
    final share = otherTotal == 0 ? 0.5 : entry.value / otherTotal;
    return (share * otherTarget).roundToDouble();
  }).toList();

  final diff = 100 - adjusted.reduce((sum, item) => sum + item);
  adjusted[0] = clampValue(adjusted[0] + diff, 10, 90);
  return adjusted;
}

double calculateWeightedTarget(List<double> weights, double spot) {
  final targets = [spot * 1.05, spot * 1.0, spot * 0.95];
  var sum = 0.0;
  for (var i = 0; i < weights.length; i++) {
    sum += weights[i] * targets[i];
  }
  return sum / 100;
}

class KaratBreakdown {
  final double twentyFourK;
  final double twentyOneK;
  final double eighteenK;

  const KaratBreakdown({
    required this.twentyFourK,
    required this.twentyOneK,
    required this.eighteenK,
  });
}

KaratBreakdown calculateKaratBreakdown(
  double egpAmount,
  double gram24k,
  double gram21k,
  double gram18k,
) {
  return KaratBreakdown(
    twentyFourK: egpAmount / gram24k,
    twentyOneK: egpAmount / gram21k,
    eighteenK: egpAmount / gram18k,
  );
}

class GramPrices {
  final double g24;
  final double g21;
  final double g18;
  final double goldPound;

  const GramPrices({
    required this.g24,
    required this.g21,
    required this.g18,
    required this.goldPound,
  });
}

GramPrices calculateGramPrices({
  required double spotUsd,
  required double usdEgp,
  required double premiumPct,
}) {
  final g24 = (spotUsd / goldOunceGrams) * usdEgp * (1 + premiumPct / 100);
  final g21 = g24 * 0.875;
  final g18 = g24 * 0.75;
  final goldPound = g21 * 8;
  return GramPrices(g24: g24, g21: g21, g18: g18, goldPound: goldPound);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/core/domain_test.dart`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/core/domain.dart flutter_app/test/core/domain_test.dart
git commit -m "feat: port scenario/karat/gram-price math from src/domain.ts"
```

---

## Task 10: Price feed fallback chain

**Files:**
- Create: `flutter_app/lib/core/price_feed/price_feed.dart`
- Test: `flutter_app/test/core/price_feed/price_feed_test.dart`

**Interfaces:**
- Produces: `class PriceFeedException implements Exception { final List<String> diagnostics; }`
- Produces: `class PriceSourceResult { final double value; final String source; }`
- Produces: `typedef PriceSourceFn = Future<double> Function(Dio dio);`
- Produces: `class PriceSource { final String name; final PriceSourceFn fetch; }`
- Produces: `Future<PriceSourceResult> fetchFromChain(Dio dio, List<PriceSource> sources, {required bool Function(double) isValid, Duration timeout})`
- Produces: `List<PriceSource> spotUsdSources` (gold-api → goldprice.org → binance-paxg → jsdelivr-daily), `List<PriceSource> usdEgpSources` (er-api → jsdelivr), matching the exact endpoints and response paths in `src/App.tsx:412-476`.
- Produces: `Future<PriceSourceResult> fetchSpotUsd(Dio dio)` and `Future<PriceSourceResult> fetchUsdEgp(Dio dio)` — apply the same valid-range checks as the web app (spot: 1000–20000; FX: 20–200).

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/core/price_feed/price_feed_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/price_feed/price_feed.dart';

void main() {
  group('fetchFromChain', () {
    test('returns the first source that succeeds with a valid value', () async {
      final sources = [
        PriceSource('bad', (dio) async => throw Exception('boom')),
        PriceSource('good', (dio) async => 5000),
        PriceSource('unreached', (dio) async => 1),
      ];

      final result = await fetchFromChain(Dio(), sources, isValid: (v) => v > 1000 && v < 20000);

      expect(result.value, 5000);
      expect(result.source, 'good');
    });

    test('skips a source that returns an out-of-range value', () async {
      final sources = [
        PriceSource('out-of-range', (dio) async => 5),
        PriceSource('good', (dio) async => 5000),
      ];

      final result = await fetchFromChain(Dio(), sources, isValid: (v) => v > 1000 && v < 20000);

      expect(result.source, 'good');
    });

    test('throws PriceFeedException with all diagnostics when every source fails', () async {
      final sources = [
        PriceSource('a', (dio) async => throw Exception('err-a')),
        PriceSource('b', (dio) async => 5),
      ];

      await expectLater(
        fetchFromChain(Dio(), sources, isValid: (v) => v > 1000 && v < 20000),
        throwsA(isA<PriceFeedException>()),
      );
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/core/price_feed/price_feed_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:gold_cockpit_mobile/core/price_feed/price_feed.dart'`

- [ ] **Step 3: Implement the price feed chain and source lists**

```dart
// flutter_app/lib/core/price_feed/price_feed.dart
import 'dart:async';
import 'package:dio/dio.dart';

class PriceSourceResult {
  final double value;
  final String source;
  const PriceSourceResult(this.value, this.source);
}

class PriceFeedException implements Exception {
  final List<String> diagnostics;
  const PriceFeedException(this.diagnostics);

  @override
  String toString() => 'All price sources failed: ${diagnostics.join('; ')}';
}

typedef PriceSourceFn = Future<double> Function(Dio dio);

class PriceSource {
  final String name;
  final PriceSourceFn fetch;
  const PriceSource(this.name, this.fetch);
}

Future<PriceSourceResult> fetchFromChain(
  Dio dio,
  List<PriceSource> sources, {
  required bool Function(double) isValid,
  Duration timeout = const Duration(seconds: 6),
}) async {
  final diagnostics = <String>[];

  for (final source in sources) {
    try {
      final value = await source.fetch(dio).timeout(timeout);
      if (isValid(value)) {
        return PriceSourceResult(value, source.name);
      }
      diagnostics.add('${source.name}: bad value');
    } catch (error) {
      diagnostics.add('${source.name}: $error');
    }
  }

  throw PriceFeedException(diagnostics);
}

final List<PriceSource> spotUsdSources = [
  PriceSource('gold-api', (dio) async {
    final r = await dio.get('https://api.gold-api.com/price/XAU');
    return (r.data['price'] as num).toDouble();
  }),
  PriceSource('goldprice.org', (dio) async {
    final r = await dio.get('https://data-asg.goldprice.org/dbXRates/USD');
    return (r.data['items'][0]['xauPrice'] as num).toDouble();
  }),
  PriceSource('binance-paxg', (dio) async {
    final r = await dio.get('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
    return double.parse(r.data['price'] as String);
  }),
  PriceSource('jsdelivr-daily', (dio) async {
    final r = await dio.get(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    );
    final perUsd = (r.data['usd']['xau'] as num).toDouble();
    if (perUsd == 0) throw Exception('zero xau-per-usd');
    return 1 / perUsd;
  }),
];

final List<PriceSource> usdEgpSources = [
  PriceSource('er-api', (dio) async {
    final r = await dio.get('https://open.er-api.com/v6/latest/USD');
    return (r.data['rates']['EGP'] as num).toDouble();
  }),
  PriceSource('jsdelivr', (dio) async {
    final r = await dio.get(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    );
    return (r.data['usd']['egp'] as num).toDouble();
  }),
];

bool isValidSpot(double value) => value > 1000 && value < 20000;
bool isValidFx(double value) => value > 20 && value < 200;

Future<PriceSourceResult> fetchSpotUsd(Dio dio) =>
    fetchFromChain(dio, spotUsdSources, isValid: isValidSpot);

Future<PriceSourceResult> fetchUsdEgp(Dio dio) =>
    fetchFromChain(dio, usdEgpSources, isValid: isValidFx);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/core/price_feed/price_feed_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add flutter_app/lib/core/price_feed/price_feed.dart flutter_app/test/core/price_feed/price_feed_test.dart
git commit -m "feat: add price feed fallback chain for spot USD and USD/EGP"
```

---

## Task 11: l10n strings and app shell

**Files:**
- Create: `flutter_app/lib/l10n/strings.dart`
- Create: `flutter_app/lib/core/setup_screen.dart`
- Modify: `flutter_app/lib/main.dart`
- Test: `flutter_app/test/core/setup_screen_test.dart`

**Interfaces:**
- Produces: `enum AppLanguage { ar, en }`
- Produces: `class Strings { final AppLanguage lang; String get eyebrow; String get title; ... }` covering labels needed by the screens built in Tasks 12–19 (home/eyebrow/title, karat labels g24/g21/g18/goldPound, scenario names, watchlist signal labels, AI labels, settings labels). Not a full port of every tooltip string in `src/App.tsx`'s `T` object — only what the implemented screens use.
- Produces: `class LanguagePreference { Future<AppLanguage> get language; Future<void> setLanguage(AppLanguage); }` backed by `shared_preferences`, and `final languageProvider = StateNotifierProvider<LanguageController, AppLanguage>(...)` so the app shell and screens can read/toggle the current language reactively.
- Produces: `class SetupScreen extends ConsumerWidget` — prompts for base URL / API key when `AppConfig.isConfigured` is false; on save, calls `AppConfig.setBaseUrl` / `setApiKey` and navigates to the app shell.
- Produces: `void main()` wraps `MyApp` in `ProviderScope`; `MyApp` is a `MaterialApp` with a `Scaffold` + `Drawer` listing the 8 feature screens (Market, Scenarios, DCA, Watchlist, Calculator, Egypt Prices, AI Analyst, Settings) as named routes — screens themselves are stub `Placeholder()` widgets until Tasks 12–19 replace them. The app bar includes a language-toggle action bound to `languageProvider`.

- [ ] **Step 1: Write the failing test for the setup screen**

```dart
// flutter_app/test/core/setup_screen_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/core/setup_screen.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  testWidgets('saving the form persists base URL and API key', (tester) async {
    final store = FakeSecureStore();
    final config = AppConfig(store);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [appConfigProvider.overrideWithValue(config)],
        child: const MaterialApp(home: SetupScreen()),
      ),
    );

    await tester.enterText(find.byKey(const Key('baseUrlField')), 'http://192.168.1.5:8787');
    await tester.enterText(find.byKey(const Key('apiKeyField')), 'my-secret');
    await tester.tap(find.byKey(const Key('saveButton')));
    await tester.pumpAndSettle();

    expect(await config.baseUrl, 'http://192.168.1.5:8787');
    expect(await config.apiKey, 'my-secret');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/core/setup_screen_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:gold_cockpit_mobile/core/setup_screen.dart'`

- [ ] **Step 3: Implement l10n strings**

```dart
// flutter_app/lib/l10n/strings.dart
enum AppLanguage { ar, en }

class Strings {
  final AppLanguage lang;
  const Strings(this.lang);

  bool get isAr => lang == AppLanguage.ar;

  String get eyebrow => isAr ? 'غرفة عمليات الذهب' : 'GOLD HEDGE COCKPIT';
  String get title => isAr ? 'غرفة عمليات الذهب' : 'Gold Cockpit';

  String get marketTab => isAr ? 'السوق' : 'Market';
  String get scenariosTab => isAr ? 'السيناريوهات' : 'Scenarios';
  String get dcaTab => isAr ? 'خطة الدخول' : 'DCA Plan';
  String get watchTab => isAr ? 'لوحة المتابعة' : 'Watchlist';
  String get calcTab => isAr ? 'الحاسبة' : 'Calculator';
  String get egyptTab => isAr ? 'السوق المصري' : 'Egypt Prices';
  String get aiTab => isAr ? 'المحلل الذكي' : 'AI Analyst';
  String get settingsTab => isAr ? 'الإعدادات' : 'Settings';

  String get g24 => isAr ? 'جرام 24' : '24k gram';
  String get g21 => isAr ? 'جرام 21' : '21k gram';
  String get g18 => isAr ? 'جرام 18' : '18k gram';
  String get goldPound => isAr ? 'الجنيه الذهب' : 'Gold pound';
  String get ounce => isAr ? 'الأونصة' : 'Ounce';

  String get scenarioDeescalation => isAr ? 'التهدئة' : 'De-escalation';
  String get scenarioBase => isAr ? 'السيناريو الأساسي' : 'Base Case';
  String get scenarioStagflation => isAr ? 'فخ الركود التضخمي' : 'Stagflation Trap';
  String get weightedTargetLabel => isAr ? 'السعر المستهدف المرجّح' : 'Probability-weighted target';

  String get signalSupport => isAr ? 'داعم' : 'Support';
  String get signalWatch => isAr ? 'مراقبة' : 'Watch';
  String get signalRisk => isAr ? 'خطر' : 'Risk';
  String get addWatchItemHint => isAr ? 'متغير جديد…' : 'New variable…';
  String get addButton => isAr ? 'أضف' : 'Add';
  String get deleteButton => isAr ? 'حذف' : 'Delete';

  String get aiGoButton => isAr ? 'حلّل السوق' : 'Analyze the market';
  String get aiTrendsHeading => isAr ? 'اللي حرّك السوق' : 'What moved the market';
  String get aiWeightsHeading => isAr ? 'الأوزان المقترحة' : 'Suggested weights';
  String get aiTrancheHeading => isAr ? 'قرار الدفعة الثانية' : 'Tranche 2 call';
  String get aiEgpHeading => isAr ? 'قراءة الجنيه' : 'EGP read';
  String get aiApplyButton => isAr ? 'طبّق الأوزان دي' : 'Apply these weights';
  String get aiNoProvider => isAr ? 'مفيش مزوّد مُفعّل' : 'No active provider';

  String get settingsHeading => isAr ? 'إعدادات نموذج الذكاء الاصطناعي' : 'AI Model Settings';
  String get settingsLabelField => isAr ? 'الاسم' : 'Label';
  String get settingsModelField => isAr ? 'الموديل' : 'Model';
  String get settingsBaseUrlField => isAr ? 'رابط الخادم' : 'Base URL';
  String get settingsApiKeyField => isAr ? 'مفتاح API' : 'API key';
  String get settingsSaveButton => isAr ? 'حفظ' : 'Save';
  String get settingsActivateButton => isAr ? 'تفعيل' : 'Set active';
  String get settingsTestButton => isAr ? 'اختبار الاتصال' : 'Test connection';

  String get connectionSetupHeading => isAr ? 'إعداد الاتصال' : 'Connection setup';
  String get baseUrlFieldLabel => isAr ? 'عنوان الخادم' : 'Server base URL';
  String get apiKeyFieldLabel => isAr ? 'مفتاح API (اختياري)' : 'API key (optional)';
  String get saveButton => isAr ? 'حفظ' : 'Save';
}
```

- [ ] **Step 4: Implement the setup screen**

```dart
// flutter_app/lib/core/setup_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app_config.dart';
import 'secure_store.dart';
import '../l10n/strings.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig(const FlutterSecureStore()));

class SetupScreen extends ConsumerStatefulWidget {
  const SetupScreen({super.key});

  @override
  ConsumerState<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends ConsumerState<SetupScreen> {
  final _baseUrlController = TextEditingController(text: AppConfig.defaultBaseUrl);
  final _apiKeyController = TextEditingController();

  @override
  void dispose() {
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const strings = Strings(AppLanguage.en);
    final config = ref.watch(appConfigProvider);

    return Scaffold(
      appBar: AppBar(title: Text(strings.connectionSetupHeading)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              key: const Key('baseUrlField'),
              controller: _baseUrlController,
              decoration: InputDecoration(labelText: strings.baseUrlFieldLabel),
            ),
            TextField(
              key: const Key('apiKeyField'),
              controller: _apiKeyController,
              decoration: InputDecoration(labelText: strings.apiKeyFieldLabel),
              obscureText: true,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('saveButton'),
              onPressed: () async {
                await config.setBaseUrl(_baseUrlController.text);
                if (_apiKeyController.text.isNotEmpty) {
                  await config.setApiKey(_apiKeyController.text);
                }
              },
              child: Text(strings.saveButton),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/core/setup_screen_test.dart`
Expected: PASS (1 test)

- [ ] **Step 6: Write the failing test for the language preference**

```dart
// flutter_app/test/core/language_preference_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/l10n/strings.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('LanguagePreference', () {
    test('defaults to English when unset', () async {
      final prefs = await SharedPreferences.getInstance();
      final preference = LanguagePreference(prefs);
      expect(await preference.language, AppLanguage.en);
    });

    test('setLanguage persists and is read back', () async {
      final prefs = await SharedPreferences.getInstance();
      final preference = LanguagePreference(prefs);

      await preference.setLanguage(AppLanguage.ar);

      expect(await preference.language, AppLanguage.ar);
    });
  });

  group('LanguageController', () {
    test('starts with the persisted language and updates on toggle', () async {
      SharedPreferences.setMockInitialValues({'gold_cockpit_language': 'ar'});
      final prefs = await SharedPreferences.getInstance();
      final controller = LanguageController(LanguagePreference(prefs));
      await controller.load();

      expect(controller.state, AppLanguage.ar);

      await controller.setLanguage(AppLanguage.en);
      expect(controller.state, AppLanguage.en);
      expect(await LanguagePreference(prefs).language, AppLanguage.en);
    });
  });
}
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/core/language_preference_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:gold_cockpit_mobile/core/language_preference.dart'`

- [ ] **Step 8: Implement the language preference and controller**

```dart
// flutter_app/lib/core/language_preference.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../l10n/strings.dart';

class LanguagePreference {
  LanguagePreference(this._prefs);

  static const _key = 'gold_cockpit_language';

  final SharedPreferences _prefs;

  Future<AppLanguage> get language async {
    final stored = _prefs.getString(_key);
    return stored == 'ar' ? AppLanguage.ar : AppLanguage.en;
  }

  Future<void> setLanguage(AppLanguage value) async {
    await _prefs.setString(_key, value == AppLanguage.ar ? 'ar' : 'en');
  }
}

class LanguageController extends StateNotifier<AppLanguage> {
  LanguageController(this._preference) : super(AppLanguage.en);

  final LanguagePreference _preference;

  Future<void> load() async {
    state = await _preference.language;
  }

  Future<void> setLanguage(AppLanguage value) async {
    await _preference.setLanguage(value);
    state = value;
  }
}

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('overridden in main() with the resolved SharedPreferences instance');
});

final languageProvider = StateNotifierProvider<LanguageController, AppLanguage>((ref) {
  final controller = LanguageController(LanguagePreference(ref.watch(sharedPreferencesProvider)));
  controller.load();
  return controller;
});
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/core/language_preference_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 10: Implement the app shell in main.dart, wired to the language provider**

```dart
// flutter_app/lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/language_preference.dart';
import 'l10n/strings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(
    ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: const MyApp(),
    ),
  );
}

class MyApp extends ConsumerWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final language = ref.watch(languageProvider);
    final strings = Strings(language);
    return MaterialApp(
      title: strings.title,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFFC9A227)),
      home: const AppShell(),
    );
  }
}

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final language = ref.watch(languageProvider);
    final strings = Strings(language);

    final destinations = <_ShellDestination>[
      _ShellDestination(strings.marketTab, const Placeholder()),
      _ShellDestination(strings.scenariosTab, const Placeholder()),
      _ShellDestination(strings.dcaTab, const Placeholder()),
      _ShellDestination(strings.watchTab, const Placeholder()),
      _ShellDestination(strings.calcTab, const Placeholder()),
      _ShellDestination(strings.egyptTab, const Placeholder()),
      _ShellDestination(strings.aiTab, const Placeholder()),
      _ShellDestination(strings.settingsTab, const Placeholder()),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(destinations[_selectedIndex].label),
        actions: [
          IconButton(
            key: const Key('languageToggle'),
            icon: const Icon(Icons.translate),
            onPressed: () {
              final next = language == AppLanguage.en ? AppLanguage.ar : AppLanguage.en;
              ref.read(languageProvider.notifier).setLanguage(next);
            },
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          children: [
            DrawerHeader(child: Text(strings.title)),
            for (var i = 0; i < destinations.length; i++)
              ListTile(
                title: Text(destinations[i].label),
                selected: i == _selectedIndex,
                onTap: () {
                  setState(() => _selectedIndex = i);
                  Navigator.pop(context);
                },
              ),
          ],
        ),
      ),
      body: destinations[_selectedIndex].screen,
    );
  }
}

class _ShellDestination {
  final String label;
  final Widget screen;
  const _ShellDestination(this.label, this.screen);
}
```

- [ ] **Step 11: Run the widget smoke check**

Run: `cd flutter_app && flutter analyze`
Expected: "No issues found!"

- [ ] **Step 12: Commit**

```bash
git add flutter_app/lib/l10n/strings.dart flutter_app/lib/core/setup_screen.dart flutter_app/lib/core/language_preference.dart flutter_app/lib/main.dart flutter_app/test/core/setup_screen_test.dart flutter_app/test/core/language_preference_test.dart
git commit -m "feat: add l10n strings, language preference, setup screen, and app shell navigation"
```

---

## Task 12: Feature — Market

**Files:**
- Create: `flutter_app/lib/features/market/data/market_repository.dart`
- Create: `flutter_app/lib/features/market/application/market_providers.dart`
- Create: `flutter_app/lib/features/market/presentation/market_screen.dart`
- Test: `flutter_app/test/features/market/market_repository_test.dart`

**Interfaces:**
- Consumes: `fetchSpotUsd`, `fetchUsdEgp`, `PriceSourceResult` (Task 10); `calculateGramPrices`, `GramPrices` (Task 9).
- Produces: `class MarketSnapshot { final double spotUsd; final double usdEgp; final String spotSource; final GramPrices gramPrices; }`
- Produces: `class MarketRepository { Future<MarketSnapshot> fetchSnapshot(Dio dio, {required double premiumPct}); }`
- Produces: `final marketSnapshotProvider = FutureProvider.family<MarketSnapshot, double>(...)` keyed by premium percent.
- Produces: `class MarketScreen extends ConsumerWidget`.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/market/market_repository_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/market/data/market_repository.dart';

void main() {
  test('fetchSnapshot combines spot/FX prices into gram prices', () async {
    final repo = MarketRepository(
      fetchSpot: (dio) async => 5000,
      fetchFx: (dio) async => 50,
      fetchSpotSource: (dio) async => 'gold-api',
    );

    final snapshot = await repo.fetchSnapshot(Dio(), premiumPct: 2);

    expect(snapshot.spotUsd, 5000);
    expect(snapshot.usdEgp, 50);
    expect(snapshot.spotSource, 'gold-api');
    expect(snapshot.gramPrices.g24, greaterThan(0));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/market/market_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the repository**

```dart
// flutter_app/lib/features/market/data/market_repository.dart
import 'package:dio/dio.dart';
import '../../../core/domain.dart';
import '../../../core/price_feed/price_feed.dart';

class MarketSnapshot {
  final double spotUsd;
  final double usdEgp;
  final String spotSource;
  final GramPrices gramPrices;

  const MarketSnapshot({
    required this.spotUsd,
    required this.usdEgp,
    required this.spotSource,
    required this.gramPrices,
  });
}

typedef _FetchValue = Future<double> Function(Dio dio);
typedef _FetchSource = Future<String> Function(Dio dio);

class MarketRepository {
  final _FetchValue _fetchSpot;
  final _FetchValue _fetchFx;
  final _FetchSource _fetchSpotSource;

  MarketRepository({
    _FetchValue? fetchSpot,
    _FetchValue? fetchFx,
    _FetchSource? fetchSpotSource,
  })  : _fetchSpot = fetchSpot ?? ((dio) async => (await fetchSpotUsd(dio)).value),
        _fetchFx = fetchFx ?? ((dio) async => (await fetchUsdEgp(dio)).value),
        _fetchSpotSource = fetchSpotSource ?? ((dio) async => (await fetchSpotUsd(dio)).source);

  Future<MarketSnapshot> fetchSnapshot(Dio dio, {required double premiumPct}) async {
    final spot = await _fetchSpot(dio);
    final fx = await _fetchFx(dio);
    final source = await _fetchSpotSource(dio);
    final gramPrices = calculateGramPrices(spotUsd: spot, usdEgp: fx, premiumPct: premiumPct);
    return MarketSnapshot(spotUsd: spot, usdEgp: fx, spotSource: source, gramPrices: gramPrices);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/market/market_repository_test.dart`
Expected: PASS (1 test)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/market/application/market_providers.dart
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/market_repository.dart';

final _dioProvider = Provider<Dio>((ref) => Dio());

final marketRepositoryProvider = Provider<MarketRepository>((ref) => MarketRepository());

final marketSnapshotProvider = FutureProvider.family<MarketSnapshot, double>((ref, premiumPct) {
  final repository = ref.watch(marketRepositoryProvider);
  final dio = ref.watch(_dioProvider);
  return repository.fetchSnapshot(dio, premiumPct: premiumPct);
});
```

```dart
// flutter_app/lib/features/market/presentation/market_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/market_providers.dart';
import '../../../l10n/strings.dart';

class MarketScreen extends ConsumerWidget {
  const MarketScreen({super.key, this.premiumPct = 0});

  final double premiumPct;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const strings = Strings(AppLanguage.en);
    final snapshotAsync = ref.watch(marketSnapshotProvider(premiumPct));

    return snapshotAsync.when(
      data: (snapshot) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${strings.ounce}: \$${snapshot.spotUsd.toStringAsFixed(0)} (${snapshot.spotSource})'),
          const SizedBox(height: 8),
          Text('${strings.g24}: ${snapshot.gramPrices.g24.toStringAsFixed(0)} EGP'),
          Text('${strings.g21}: ${snapshot.gramPrices.g21.toStringAsFixed(0)} EGP'),
          Text('${strings.g18}: ${snapshot.gramPrices.g18.toStringAsFixed(0)} EGP'),
          Text('${strings.goldPound}: ${snapshot.gramPrices.goldPound.toStringAsFixed(0)} EGP'),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`, replace the market destination's `Placeholder()`:
```dart
import 'features/market/presentation/market_screen.dart';
// ...
_ShellDestination(strings.marketTab, const MarketScreen()),
```
Change `AppShell` to `ConsumerStatefulWidget`/`ConsumerState` if not already, since later tasks will need `ref` in the shell too — do this conversion now:
```dart
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});
  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  // body unchanged from Task 11 aside from the base class
}
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/market flutter_app/lib/main.dart flutter_app/test/features/market
git commit -m "feat: add market feature (live spot/EGP/gram prices)"
```

---

## Task 13: Feature — Calculator

**Files:**
- Create: `flutter_app/lib/features/calculator/presentation/calculator_screen.dart`
- Test: `flutter_app/test/features/calculator/calculator_screen_test.dart`

**Interfaces:**
- Consumes: `calculateKaratBreakdown`, `KaratBreakdown` (Task 9).
- Produces: `class CalculatorScreen extends StatefulWidget` — takes gram24/21/18 prices as constructor params (from the market feature's last snapshot, passed by the app shell), an EGP amount text field, and shows the karat breakdown live as the user types.

No repository/provider layer needed — this feature is pure client-side math, no API calls (per spec: "calculator" has no `data/` layer).

- [ ] **Step 1: Write the failing widget test**

```dart
// flutter_app/test/features/calculator/calculator_screen_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/calculator/presentation/calculator_screen.dart';

void main() {
  testWidgets('entering an EGP amount shows the karat breakdown', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: CalculatorScreen(gram24k: 5000, gram21k: 4375, gram18k: 3750),
      ),
    );

    await tester.enterText(find.byKey(const Key('amountField')), '10000');
    await tester.pump();

    expect(find.textContaining('2.00'), findsOneWidget); // 10000 / 5000 = 2.00g at 24k
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/calculator/calculator_screen_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the screen**

```dart
// flutter_app/lib/features/calculator/presentation/calculator_screen.dart
import 'package:flutter/material.dart';
import '../../../core/domain.dart';
import '../../../l10n/strings.dart';

class CalculatorScreen extends StatefulWidget {
  const CalculatorScreen({
    super.key,
    required this.gram24k,
    required this.gram21k,
    required this.gram18k,
  });

  final double gram24k;
  final double gram21k;
  final double gram18k;

  @override
  State<CalculatorScreen> createState() => _CalculatorScreenState();
}

class _CalculatorScreenState extends State<CalculatorScreen> {
  final _controller = TextEditingController();
  KaratBreakdown? _breakdown;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    final amount = double.tryParse(value);
    setState(() {
      _breakdown = amount == null
          ? null
          : calculateKaratBreakdown(amount, widget.gram24k, widget.gram21k, widget.gram18k);
    });
  }

  @override
  Widget build(BuildContext context) {
    const strings = Strings(AppLanguage.en);
    final breakdown = _breakdown;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          TextField(
            key: const Key('amountField'),
            controller: _controller,
            keyboardType: TextInputType.number,
            onChanged: _onChanged,
            decoration: const InputDecoration(labelText: 'EGP amount'),
          ),
          const SizedBox(height: 16),
          if (breakdown != null) ...[
            Text('${strings.g24}: ${breakdown.twentyFourK.toStringAsFixed(2)}g'),
            Text('${strings.g21}: ${breakdown.twentyOneK.toStringAsFixed(2)}g'),
            Text('${strings.g18}: ${breakdown.eighteenK.toStringAsFixed(2)}g'),
          ],
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/calculator/calculator_screen_test.dart`
Expected: PASS (1 test)

- [ ] **Step 5: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/calculator/presentation/calculator_screen.dart';
// ...
_ShellDestination(strings.calcTab, const CalculatorScreen(gram24k: 0, gram21k: 0, gram18k: 0)),
```
(Wiring live gram prices from the market snapshot into this placeholder-value screen happens in Task 20, when all screens are connected together.)

- [ ] **Step 6: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 7: Commit**

```bash
git add flutter_app/lib/features/calculator flutter_app/lib/main.dart flutter_app/test/features/calculator
git commit -m "feat: add karat purchase calculator feature"
```

---

## Task 14: Feature — Scenarios

**Files:**
- Create: `flutter_app/lib/features/scenarios/data/scenarios_repository.dart`
- Create: `flutter_app/lib/features/scenarios/application/scenarios_providers.dart`
- Create: `flutter_app/lib/features/scenarios/presentation/scenarios_screen.dart`
- Test: `flutter_app/test/features/scenarios/scenarios_repository_test.dart`

**Interfaces:**
- Consumes: `ApiClient` (Task 8); `calculateWeightedTarget`, `rebalanceScenarioWeights` (Task 9); backend `GET /api/scenarios`, `PATCH /api/scenarios/:id` (Task 1).
- Produces: `class Scenario { final int id; final String name; final double? bandLow; final double? bandHigh; final double weightPct; final double? probabilityPct; final int sortOrder; }` with `Scenario.fromJson`.
- Produces: `class ScenariosRepository { Future<List<Scenario>> fetchAll(Dio dio); Future<Scenario> updateWeight(Dio dio, int id, double weightPct); }`
- Produces: `final scenariosListProvider = FutureProvider<List<Scenario>>(...)`; `final scenariosRepositoryProvider = Provider<ScenariosRepository>(...)`.
- Produces: `class ScenariosScreen extends ConsumerWidget`.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/scenarios/scenarios_repository_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/scenarios/data/scenarios_repository.dart';

void main() {
  group('Scenario.fromJson', () {
    test('parses a scenario row from the API', () {
      final scenario = Scenario.fromJson({
        'id': 1,
        'name': 'De-escalation',
        'band_low': '5800.00',
        'band_high': '6300.00',
        'weight_pct': '35.00',
        'probability_pct': null,
        'sort_order': 0,
      });

      expect(scenario.id, 1);
      expect(scenario.name, 'De-escalation');
      expect(scenario.bandLow, 5800.0);
      expect(scenario.weightPct, 35.0);
      expect(scenario.probabilityPct, isNull);
    });
  });

  group('ScenariosRepository', () {
    test('fetchAll GETs /api/scenarios and parses the list', () async {
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'GET /api/scenarios': (options) => [
                {
                  'id': 1,
                  'name': 'Base Case',
                  'band_low': '5000',
                  'band_high': '5400',
                  'weight_pct': '45',
                  'probability_pct': null,
                  'sort_order': 1,
                }
              ],
        });

      final repo = ScenariosRepository();
      final result = await repo.fetchAll(dio);

      expect(result, hasLength(1));
      expect(result.first.name, 'Base Case');
    });
  });
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._responses);
  final Map<String, dynamic Function(RequestOptions)> _responses;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final key = '${options.method} ${options.path}';
    final handler = _responses[key];
    if (handler == null) throw Exception('no fake response for $key');
    final data = handler(options);
    final bytes = utf8.encode(jsonEncode(data));
    return ResponseBody.fromBytes(bytes, 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }
}
```

Add the two missing imports at the top of the test file: `import 'dart:convert';` and `import 'dart:typed_data';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/scenarios/scenarios_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the model and repository**

```dart
// flutter_app/lib/features/scenarios/data/scenarios_repository.dart
import 'package:dio/dio.dart';

class Scenario {
  final int id;
  final String name;
  final double? bandLow;
  final double? bandHigh;
  final double weightPct;
  final double? probabilityPct;
  final int sortOrder;

  const Scenario({
    required this.id,
    required this.name,
    required this.bandLow,
    required this.bandHigh,
    required this.weightPct,
    required this.probabilityPct,
    required this.sortOrder,
  });

  factory Scenario.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic v) => v == null ? null : double.parse(v.toString());
    return Scenario(
      id: json['id'] as int,
      name: json['name'] as String,
      bandLow: toDouble(json['band_low']),
      bandHigh: toDouble(json['band_high']),
      weightPct: toDouble(json['weight_pct'])!,
      probabilityPct: toDouble(json['probability_pct']),
      sortOrder: json['sort_order'] as int,
    );
  }
}

class ScenariosRepository {
  Future<List<Scenario>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/scenarios');
    return (response.data as List).map((row) => Scenario.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<Scenario> updateWeight(Dio dio, int id, double weightPct) async {
    final response = await dio.patch('/api/scenarios/$id', data: {'weight_pct': weightPct});
    return Scenario.fromJson(response.data as Map<String, dynamic>);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/scenarios/scenarios_repository_test.dart`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/scenarios/application/scenarios_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
import '../../../core/setup_screen.dart';
import '../data/scenarios_repository.dart';

final scenariosRepositoryProvider = Provider<ScenariosRepository>((ref) => ScenariosRepository());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(ref.watch(appConfigProvider)));

final scenariosListProvider = FutureProvider<List<Scenario>>((ref) {
  final repository = ref.watch(scenariosRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
```

```dart
// flutter_app/lib/features/scenarios/presentation/scenarios_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/domain.dart';
import '../application/scenarios_providers.dart';

class ScenariosScreen extends ConsumerWidget {
  const ScenariosScreen({super.key, this.spot = 0});

  final double spot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scenariosAsync = ref.watch(scenariosListProvider);

    return scenariosAsync.when(
      data: (scenarios) {
        final weights = scenarios.map((s) => s.weightPct).toList();
        final weightedTarget = spot > 0 ? calculateWeightedTarget(weights, spot) : 0.0;

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (spot > 0) Text('Weighted target: \$${weightedTarget.toStringAsFixed(0)}'),
            const SizedBox(height: 8),
            for (final scenario in scenarios)
              ListTile(
                title: Text(scenario.name),
                subtitle: scenario.bandLow != null && scenario.bandHigh != null
                    ? Text('\$${scenario.bandLow!.toStringAsFixed(0)}–\$${scenario.bandHigh!.toStringAsFixed(0)}')
                    : null,
                trailing: Text('${scenario.weightPct.toStringAsFixed(0)}%'),
              ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/scenarios/presentation/scenarios_screen.dart';
// ...
_ShellDestination(strings.scenariosTab, const ScenariosScreen()),
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/scenarios flutter_app/lib/main.dart flutter_app/test/features/scenarios
git commit -m "feat: add scenarios feature backed by /api/scenarios"
```

---

## Task 15: Feature — Tranches (DCA)

**Files:**
- Create: `flutter_app/lib/features/tranches/data/tranches_repository.dart`
- Create: `flutter_app/lib/features/tranches/application/tranches_providers.dart`
- Create: `flutter_app/lib/features/tranches/presentation/tranches_screen.dart`
- Test: `flutter_app/test/features/tranches/tranches_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider` (Task 14); backend `GET /api/tranches`, `PATCH /api/tranches/:id` (Task 2).
- Produces: `class Tranche { final int id; final int trancheNumber; final double planPct; final double? amountEgp; final double? gramEquivalent; final String status; final DateTime? purchasedAt; }` with `Tranche.fromJson`.
- Produces: `class TranchesRepository { Future<List<Tranche>> fetchAll(Dio dio); Future<Tranche> updateStatus(Dio dio, int id, String status); }`
- Produces: `final tranchesListProvider = FutureProvider<List<Tranche>>(...)`.
- Produces: `class TranchesScreen extends ConsumerWidget`.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/tranches/tranches_repository_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/tranches/data/tranches_repository.dart';

void main() {
  group('Tranche.fromJson', () {
    test('parses a tranche row from the API', () {
      final tranche = Tranche.fromJson({
        'id': 1,
        'tranche_number': 1,
        'plan_pct': '40.00',
        'amount_egp': null,
        'gram_equivalent': null,
        'status': 'pending',
        'purchased_at': null,
      });

      expect(tranche.id, 1);
      expect(tranche.trancheNumber, 1);
      expect(tranche.planPct, 40.0);
      expect(tranche.status, 'pending');
      expect(tranche.purchasedAt, isNull);
    });

    test('parses purchased_at as a DateTime when present', () {
      final tranche = Tranche.fromJson({
        'id': 1,
        'tranche_number': 1,
        'plan_pct': '40.00',
        'amount_egp': '250000.00',
        'gram_equivalent': '42.5',
        'status': 'filled',
        'purchased_at': '2026-06-15T10:00:00.000Z',
      });

      expect(tranche.amountEgp, 250000.0);
      expect(tranche.gramEquivalent, 42.5);
      expect(tranche.purchasedAt, DateTime.parse('2026-06-15T10:00:00.000Z'));
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/tranches/tranches_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the model and repository**

```dart
// flutter_app/lib/features/tranches/data/tranches_repository.dart
import 'package:dio/dio.dart';

class Tranche {
  final int id;
  final int trancheNumber;
  final double planPct;
  final double? amountEgp;
  final double? gramEquivalent;
  final String status;
  final DateTime? purchasedAt;

  const Tranche({
    required this.id,
    required this.trancheNumber,
    required this.planPct,
    required this.amountEgp,
    required this.gramEquivalent,
    required this.status,
    required this.purchasedAt,
  });

  factory Tranche.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic v) => v == null ? null : double.parse(v.toString());
    return Tranche(
      id: json['id'] as int,
      trancheNumber: json['tranche_number'] as int,
      planPct: toDouble(json['plan_pct'])!,
      amountEgp: toDouble(json['amount_egp']),
      gramEquivalent: toDouble(json['gram_equivalent']),
      status: json['status'] as String,
      purchasedAt: json['purchased_at'] == null ? null : DateTime.parse(json['purchased_at'] as String),
    );
  }
}

class TranchesRepository {
  Future<List<Tranche>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/tranches');
    return (response.data as List).map((row) => Tranche.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<Tranche> updateStatus(Dio dio, int id, String status) async {
    final response = await dio.patch('/api/tranches/$id', data: {'status': status});
    return Tranche.fromJson(response.data as Map<String, dynamic>);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/tranches/tranches_repository_test.dart`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/tranches/application/tranches_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/tranches_repository.dart';

final tranchesRepositoryProvider = Provider<TranchesRepository>((ref) => TranchesRepository());

final tranchesListProvider = FutureProvider<List<Tranche>>((ref) {
  final repository = ref.watch(tranchesRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
```

```dart
// flutter_app/lib/features/tranches/presentation/tranches_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/tranches_providers.dart';

class TranchesScreen extends ConsumerWidget {
  const TranchesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tranchesAsync = ref.watch(tranchesListProvider);

    return tranchesAsync.when(
      data: (tranches) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final tranche in tranches)
            ListTile(
              title: Text('Tranche ${tranche.trancheNumber} · ${tranche.planPct.toStringAsFixed(0)}%'),
              subtitle: Text(tranche.status),
              trailing: tranche.amountEgp != null ? Text('${tranche.amountEgp!.toStringAsFixed(0)} EGP') : null,
            ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/tranches/presentation/tranches_screen.dart';
// ...
_ShellDestination(strings.dcaTab, const TranchesScreen()),
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/tranches flutter_app/lib/main.dart flutter_app/test/features/tranches
git commit -m "feat: add DCA tranches feature backed by /api/tranches"
```

---

## Task 16: Feature — Watchlist

**Files:**
- Create: `flutter_app/lib/features/watchlist/data/watchlist_repository.dart`
- Create: `flutter_app/lib/features/watchlist/application/watchlist_providers.dart`
- Create: `flutter_app/lib/features/watchlist/presentation/watchlist_screen.dart`
- Test: `flutter_app/test/features/watchlist/watchlist_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider` (Task 14); backend `GET/POST/PATCH/DELETE /api/watchlist` (Task 3).
- Produces: `class WatchlistItem { final int id; final String label; final String status; final int sortOrder; }` with `WatchlistItem.fromJson`.
- Produces: `class WatchlistRepository { Future<List<WatchlistItem>> fetchAll(Dio dio); Future<WatchlistItem> create(Dio dio, {required String label, required String status}); Future<WatchlistItem> updateStatus(Dio dio, int id, String status); Future<void> delete(Dio dio, int id); }`
- Produces: `final watchlistListProvider = FutureProvider<List<WatchlistItem>>(...)`, `final watchlistControllerProvider = ...` for mutation actions triggering a refresh.
- Produces: `class WatchlistScreen extends ConsumerWidget` — tap-to-cycle status (support → watch → risk → support), swipe/button to delete, text field + add button to create.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/watchlist/watchlist_repository_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/watchlist/data/watchlist_repository.dart';

void main() {
  group('WatchlistItem.fromJson', () {
    test('parses a watchlist item row from the API', () {
      final item = WatchlistItem.fromJson({
        'id': 1,
        'label': 'Oil prices',
        'status': 'support',
        'sort_order': 0,
      });

      expect(item.id, 1);
      expect(item.label, 'Oil prices');
      expect(item.status, 'support');
    });
  });

  group('nextStatus', () {
    test('cycles support -> watch -> risk -> support', () {
      expect(nextStatus('support'), 'watch');
      expect(nextStatus('watch'), 'risk');
      expect(nextStatus('risk'), 'support');
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/watchlist/watchlist_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the model and repository**

```dart
// flutter_app/lib/features/watchlist/data/watchlist_repository.dart
import 'package:dio/dio.dart';

class WatchlistItem {
  final int id;
  final String label;
  final String status;
  final int sortOrder;

  const WatchlistItem({
    required this.id,
    required this.label,
    required this.status,
    required this.sortOrder,
  });

  factory WatchlistItem.fromJson(Map<String, dynamic> json) {
    return WatchlistItem(
      id: json['id'] as int,
      label: json['label'] as String,
      status: json['status'] as String,
      sortOrder: json['sort_order'] as int,
    );
  }
}

String nextStatus(String status) {
  switch (status) {
    case 'support':
      return 'watch';
    case 'watch':
      return 'risk';
    default:
      return 'support';
  }
}

class WatchlistRepository {
  Future<List<WatchlistItem>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/watchlist');
    return (response.data as List).map((row) => WatchlistItem.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<WatchlistItem> create(Dio dio, {required String label, required String status}) async {
    final response = await dio.post('/api/watchlist', data: {'label': label, 'status': status});
    return WatchlistItem.fromJson(response.data as Map<String, dynamic>);
  }

  Future<WatchlistItem> updateStatus(Dio dio, int id, String status) async {
    final response = await dio.patch('/api/watchlist/$id', data: {'status': status});
    return WatchlistItem.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> delete(Dio dio, int id) => dio.delete('/api/watchlist/$id');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/watchlist/watchlist_repository_test.dart`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/watchlist/application/watchlist_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/watchlist_repository.dart';

final watchlistRepositoryProvider = Provider<WatchlistRepository>((ref) => WatchlistRepository());

final watchlistListProvider =
    FutureProvider.autoDispose<List<WatchlistItem>>((ref) {
  final repository = ref.watch(watchlistRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
```

```dart
// flutter_app/lib/features/watchlist/presentation/watchlist_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
import '../application/watchlist_providers.dart';
import '../data/watchlist_repository.dart';

class WatchlistScreen extends ConsumerStatefulWidget {
  const WatchlistScreen({super.key});

  @override
  ConsumerState<WatchlistScreen> createState() => _WatchlistScreenState();
}

class _WatchlistScreenState extends ConsumerState<WatchlistScreen> {
  final _newItemController = TextEditingController();

  @override
  void dispose() {
    _newItemController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final itemsAsync = ref.watch(watchlistListProvider);
    final repository = ref.watch(watchlistRepositoryProvider);
    final dio = ref.watch(apiClientProvider).dio;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('newItemField'),
                  controller: _newItemController,
                  decoration: const InputDecoration(hintText: 'New variable…'),
                ),
              ),
              IconButton(
                key: const Key('addButton'),
                icon: const Icon(Icons.add),
                onPressed: () async {
                  if (_newItemController.text.trim().isEmpty) return;
                  await repository.create(dio, label: _newItemController.text.trim(), status: 'watch');
                  _newItemController.clear();
                  ref.invalidate(watchlistListProvider);
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: itemsAsync.when(
            data: (items) => ListView(
              children: [
                for (final item in items)
                  ListTile(
                    title: Text(item.label),
                    subtitle: Text(item.status),
                    onTap: () async {
                      await repository.updateStatus(dio, item.id, nextStatus(item.status));
                      ref.invalidate(watchlistListProvider);
                    },
                    trailing: IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () async {
                        await repository.delete(dio, item.id);
                        ref.invalidate(watchlistListProvider);
                      },
                    ),
                  ),
              ],
            ),
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stack) => Center(child: Text('$error')),
          ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/watchlist/presentation/watchlist_screen.dart';
// ...
_ShellDestination(strings.watchTab, const WatchlistScreen()),
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/watchlist flutter_app/lib/main.dart flutter_app/test/features/watchlist
git commit -m "feat: add watchlist feature backed by /api/watchlist"
```

---

## Task 17: Feature — LLM Providers (Settings)

**Files:**
- Create: `flutter_app/lib/features/llm_providers/data/llm_providers_repository.dart`
- Create: `flutter_app/lib/features/llm_providers/application/llm_providers_providers.dart`
- Create: `flutter_app/lib/features/llm_providers/presentation/llm_providers_screen.dart`
- Test: `flutter_app/test/features/llm_providers/llm_providers_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider` (Task 14); backend `GET/POST/PUT/DELETE /api/llm-providers`, `POST /api/llm-providers/:id/activate`, `POST /api/llm-providers/test` (existing, unchanged).
- Produces: `class LlmProvider { final int id; final String providerType; final String label; final String? baseUrl; final String model; final bool isActive; }` with `LlmProvider.fromJson`.
- Produces: `class LlmProvidersRepository` with `fetchAll`, `create`, `update`, `delete`, `activate`, `test` — mirrors `src/api/llmProviders.ts` field-for-field (`provider_type`, `label`, `base_url`, `api_key`, `model`).
- Produces: `final llmProvidersListProvider = FutureProvider<List<LlmProvider>>(...)`.
- Produces: `class LlmProvidersScreen extends ConsumerWidget` — list with activate/edit/delete, a form to add a new provider, and a "Test connection" action.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/llm_providers/llm_providers_repository_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/llm_providers/data/llm_providers_repository.dart';

void main() {
  group('LlmProvider.fromJson', () {
    test('parses a provider row from the API', () {
      final provider = LlmProvider.fromJson({
        'id': 1,
        'provider_type': 'claude',
        'label': 'Claude prod',
        'base_url': null,
        'model': 'claude-sonnet-4-6',
        'is_active': true,
      });

      expect(provider.id, 1);
      expect(provider.providerType, 'claude');
      expect(provider.isActive, isTrue);
      expect(provider.baseUrl, isNull);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/llm_providers/llm_providers_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the model and repository**

```dart
// flutter_app/lib/features/llm_providers/data/llm_providers_repository.dart
import 'package:dio/dio.dart';

class LlmProvider {
  final int id;
  final String providerType;
  final String label;
  final String? baseUrl;
  final String model;
  final bool isActive;

  const LlmProvider({
    required this.id,
    required this.providerType,
    required this.label,
    required this.baseUrl,
    required this.model,
    required this.isActive,
  });

  factory LlmProvider.fromJson(Map<String, dynamic> json) {
    return LlmProvider(
      id: json['id'] as int,
      providerType: json['provider_type'] as String,
      label: json['label'] as String,
      baseUrl: json['base_url'] as String?,
      model: json['model'] as String,
      isActive: json['is_active'] as bool,
    );
  }
}

class LlmProvidersRepository {
  Future<List<LlmProvider>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/llm-providers');
    return (response.data as List).map((row) => LlmProvider.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<LlmProvider> create(
    Dio dio, {
    required String providerType,
    required String label,
    String? baseUrl,
    String? apiKey,
    required String model,
  }) async {
    final response = await dio.post('/api/llm-providers', data: {
      'provider_type': providerType,
      'label': label,
      'base_url': baseUrl,
      'api_key': apiKey,
      'model': model,
    });
    return LlmProvider.fromJson(response.data as Map<String, dynamic>);
  }

  Future<LlmProvider> update(
    Dio dio,
    int id, {
    required String providerType,
    required String label,
    String? baseUrl,
    String? apiKey,
    required String model,
  }) async {
    final response = await dio.put('/api/llm-providers/$id', data: {
      'provider_type': providerType,
      'label': label,
      'base_url': baseUrl,
      'api_key': apiKey,
      'model': model,
    });
    return LlmProvider.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> delete(Dio dio, int id) => dio.delete('/api/llm-providers/$id');

  Future<LlmProvider> activate(Dio dio, int id) async {
    final response = await dio.post('/api/llm-providers/$id/activate');
    return LlmProvider.fromJson(response.data as Map<String, dynamic>);
  }

  Future<String> test(
    Dio dio, {
    required String providerType,
    String? baseUrl,
    String? apiKey,
    required String model,
  }) async {
    final response = await dio.post('/api/llm-providers/test', data: {
      'provider_type': providerType,
      'base_url': baseUrl,
      'api_key': apiKey,
      'model': model,
    });
    return response.data['text'] as String;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/llm_providers/llm_providers_repository_test.dart`
Expected: PASS (1 test)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/llm_providers/application/llm_providers_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/llm_providers_repository.dart';

final llmProvidersRepositoryProvider = Provider<LlmProvidersRepository>((ref) => LlmProvidersRepository());

final llmProvidersListProvider = FutureProvider.autoDispose<List<LlmProvider>>((ref) {
  final repository = ref.watch(llmProvidersRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
```

```dart
// flutter_app/lib/features/llm_providers/presentation/llm_providers_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
import '../application/llm_providers_providers.dart';

class LlmProvidersScreen extends ConsumerStatefulWidget {
  const LlmProvidersScreen({super.key});

  @override
  ConsumerState<LlmProvidersScreen> createState() => _LlmProvidersScreenState();
}

class _LlmProvidersScreenState extends ConsumerState<LlmProvidersScreen> {
  final _labelController = TextEditingController();
  final _modelController = TextEditingController();
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();
  String _providerType = 'claude';

  @override
  void dispose() {
    _labelController.dispose();
    _modelController.dispose();
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final providersAsync = ref.watch(llmProvidersListProvider);
    final repository = ref.watch(llmProvidersRepositoryProvider);
    final dio = ref.watch(apiClientProvider).dio;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        providersAsync.when(
          data: (providers) => Column(
            children: [
              for (final provider in providers)
                ListTile(
                  title: Text(provider.label),
                  subtitle: Text('${provider.providerType} · ${provider.model}'),
                  trailing: Wrap(
                    spacing: 8,
                    children: [
                      if (provider.isActive)
                        const Chip(label: Text('Active'))
                      else
                        TextButton(
                          onPressed: () async {
                            await repository.activate(dio, provider.id);
                            ref.invalidate(llmProvidersListProvider);
                          },
                          child: const Text('Set active'),
                        ),
                      IconButton(
                        icon: const Icon(Icons.delete),
                        onPressed: () async {
                          await repository.delete(dio, provider.id);
                          ref.invalidate(llmProvidersListProvider);
                        },
                      ),
                    ],
                  ),
                ),
            ],
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stack) => Text('$error'),
        ),
        const Divider(),
        DropdownButton<String>(
          value: _providerType,
          items: const [
            DropdownMenuItem(value: 'claude', child: Text('Claude')),
            DropdownMenuItem(value: 'openai', child: Text('OpenAI')),
            DropdownMenuItem(value: 'ollama', child: Text('Ollama (local)')),
            DropdownMenuItem(value: 'custom', child: Text('Custom')),
          ],
          onChanged: (value) => setState(() => _providerType = value ?? _providerType),
        ),
        TextField(controller: _labelController, decoration: const InputDecoration(labelText: 'Label')),
        TextField(controller: _modelController, decoration: const InputDecoration(labelText: 'Model')),
        TextField(controller: _baseUrlController, decoration: const InputDecoration(labelText: 'Base URL')),
        TextField(
          controller: _apiKeyController,
          decoration: const InputDecoration(labelText: 'API key'),
          obscureText: true,
        ),
        ElevatedButton(
          key: const Key('saveProviderButton'),
          onPressed: () async {
            await repository.create(
              dio,
              providerType: _providerType,
              label: _labelController.text,
              baseUrl: _baseUrlController.text.isEmpty ? null : _baseUrlController.text,
              apiKey: _apiKeyController.text.isEmpty ? null : _apiKeyController.text,
              model: _modelController.text,
            );
            ref.invalidate(llmProvidersListProvider);
          },
          child: const Text('Save'),
        ),
      ],
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/llm_providers/presentation/llm_providers_screen.dart';
// ...
_ShellDestination(strings.settingsTab, const LlmProvidersScreen()),
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/llm_providers flutter_app/lib/main.dart flutter_app/test/features/llm_providers
git commit -m "feat: add LLM providers (settings) feature backed by /api/llm-providers"
```

---

## Task 18: Feature — Egypt Prices

**Files:**
- Create: `flutter_app/lib/features/egypt_prices/data/egypt_prices_repository.dart`
- Create: `flutter_app/lib/features/egypt_prices/application/egypt_prices_providers.dart`
- Create: `flutter_app/lib/features/egypt_prices/presentation/egypt_prices_screen.dart`
- Test: `flutter_app/test/features/egypt_prices/egypt_prices_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider` (Task 14); backend `GET /api/egypt-prices` (existing, unchanged) — response shape matches `src/api/egyptPrices.ts`'s `EgyptGoldSnapshot`.
- Produces: `class EgyptGoldRow { final String karat; final double sell; final double buy; final double? changeAmount; final double? changePct; }`, `class EgyptGoldSnapshot { final String source; final DateTime fetchedAt; final List<EgyptGoldRow> rows; }` with `fromJson` factories.
- Produces: `class EgyptPricesRepository { Future<EgyptGoldSnapshot> fetch(Dio dio); }`
- Produces: `final egyptPricesProvider = FutureProvider<EgyptGoldSnapshot>(...)`.
- Produces: `class EgyptPricesScreen extends ConsumerWidget`.

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/egypt_prices/egypt_prices_repository_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/egypt_prices/data/egypt_prices_repository.dart';

void main() {
  group('EgyptGoldSnapshot.fromJson', () {
    test('parses the source, fetchedAt, and rows', () {
      final snapshot = EgyptGoldSnapshot.fromJson({
        'source': 'isagha',
        'fetchedAt': '2026-07-26T10:00:00.000Z',
        'rows': [
          {'karat': '24k', 'sell': 5100.0, 'buy': 5050.0, 'changeAmount': 10.0, 'changePct': 0.2},
          {'karat': 'gold_pound', 'sell': 40800.0, 'buy': 40400.0, 'changeAmount': null, 'changePct': null},
        ],
      });

      expect(snapshot.source, 'isagha');
      expect(snapshot.rows, hasLength(2));
      expect(snapshot.rows[0].karat, '24k');
      expect(snapshot.rows[1].changeAmount, isNull);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/egypt_prices/egypt_prices_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the model and repository**

```dart
// flutter_app/lib/features/egypt_prices/data/egypt_prices_repository.dart
import 'package:dio/dio.dart';

class EgyptGoldRow {
  final String karat;
  final double sell;
  final double buy;
  final double? changeAmount;
  final double? changePct;

  const EgyptGoldRow({
    required this.karat,
    required this.sell,
    required this.buy,
    required this.changeAmount,
    required this.changePct,
  });

  factory EgyptGoldRow.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic v) => v == null ? null : double.parse(v.toString());
    return EgyptGoldRow(
      karat: json['karat'] as String,
      sell: toDouble(json['sell'])!,
      buy: toDouble(json['buy'])!,
      changeAmount: toDouble(json['changeAmount']),
      changePct: toDouble(json['changePct']),
    );
  }
}

class EgyptGoldSnapshot {
  final String source;
  final DateTime fetchedAt;
  final List<EgyptGoldRow> rows;

  const EgyptGoldSnapshot({required this.source, required this.fetchedAt, required this.rows});

  factory EgyptGoldSnapshot.fromJson(Map<String, dynamic> json) {
    return EgyptGoldSnapshot(
      source: json['source'] as String,
      fetchedAt: DateTime.parse(json['fetchedAt'] as String),
      rows: (json['rows'] as List).map((row) => EgyptGoldRow.fromJson(row as Map<String, dynamic>)).toList(),
    );
  }
}

class EgyptPricesRepository {
  Future<EgyptGoldSnapshot> fetch(Dio dio) async {
    final response = await dio.get('/api/egypt-prices');
    return EgyptGoldSnapshot.fromJson(response.data as Map<String, dynamic>);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/egypt_prices/egypt_prices_repository_test.dart`
Expected: PASS (1 test)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/egypt_prices/application/egypt_prices_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/egypt_prices_repository.dart';

final egyptPricesRepositoryProvider = Provider<EgyptPricesRepository>((ref) => EgyptPricesRepository());

final egyptPricesProvider = FutureProvider.autoDispose<EgyptGoldSnapshot>((ref) {
  final repository = ref.watch(egyptPricesRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetch(dio);
});
```

```dart
// flutter_app/lib/features/egypt_prices/presentation/egypt_prices_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/egypt_prices_providers.dart';

class EgyptPricesScreen extends ConsumerWidget {
  const EgyptPricesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshotAsync = ref.watch(egyptPricesProvider);

    return snapshotAsync.when(
      data: (snapshot) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Source: ${snapshot.source}'),
          const SizedBox(height: 8),
          for (final row in snapshot.rows)
            ListTile(
              title: Text(row.karat),
              subtitle: Text('Sell ${row.sell.toStringAsFixed(0)} · Buy ${row.buy.toStringAsFixed(0)}'),
              trailing: row.changePct != null ? Text('${row.changePct!.toStringAsFixed(2)}%') : null,
            ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/egypt_prices/presentation/egypt_prices_screen.dart';
// ...
_ShellDestination(strings.egyptTab, const EgyptPricesScreen()),
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/egypt_prices flutter_app/lib/main.dart flutter_app/test/features/egypt_prices
git commit -m "feat: add Egypt prices feature backed by /api/egypt-prices"
```

---

## Task 19: Feature — AI Analyst

**Files:**
- Create: `flutter_app/lib/features/ai_analyst/data/ai_analyst_repository.dart`
- Create: `flutter_app/lib/features/ai_analyst/application/ai_analyst_providers.dart`
- Create: `flutter_app/lib/features/ai_analyst/presentation/ai_analyst_screen.dart`
- Test: `flutter_app/test/features/ai_analyst/ai_analyst_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider` (Task 14); backend `POST /api/analyze` (existing, unchanged) — request `{prompt: String}`, response `{text: String, usedWebSearch: bool}` per `src/api/llmProviders.ts:analyzeViaBackend`. `Scenario` list (Task 14) and `WatchlistItem` list (Task 16) to build the prompt.
- Produces: `class AnalysisResult { final String oneLiner; final List<String> trends; final Map<String, int>? suggestedWeights; final String? weightsReasoning; final String? trancheVerdict; final String? trancheReasoning; final String? egpRead; }` with `AnalysisResult.fromJson` (parses the JSON embedded in the backend's `text` field, tolerating missing fields — mirrors the defensive parsing in `src/App.tsx:154-167`).
- Produces: `String buildAnalysisPrompt({required double spot, required double usdEgp, required List<Scenario> scenarios, required List<WatchlistItem> watchlist, required String langName})` — ports the prompt template from `src/App.tsx:756-789` (framework, live state, scenario weights, watchlist, task/response-schema instructions).
- Produces: `class AiAnalystRepository { Future<AnalysisResult> analyze(Dio dio, String prompt); }`
- Produces: `class AiAnalystScreen extends ConsumerStatefulWidget` — a button that builds the prompt from current scenarios/watchlist/spot and calls the repository, then renders `AnalysisResult` fields as plain `Text` widgets (no HTML rendering).

- [ ] **Step 1: Write the failing test**

```dart
// flutter_app/test/features/ai_analyst/ai_analyst_repository_test.dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/ai_analyst/data/ai_analyst_repository.dart';
import 'package:gold_cockpit_mobile/features/scenarios/data/scenarios_repository.dart';
import 'package:gold_cockpit_mobile/features/watchlist/data/watchlist_repository.dart';

void main() {
  group('AnalysisResult.fromJson', () {
    test('parses a full analysis JSON payload', () {
      final json = jsonDecode('''
      {
        "one_liner": "Hedge holding steady",
        "trends": ["Fed pivot expected", "CB buying continues"],
        "suggested_weights": {"deesc": 30, "base": 50, "stag": 20},
        "weights_reasoning": "CB buying dominates",
        "tranche2": {"verdict": "deploy", "reasoning": "Window is open"},
        "egp_read": "Pound stable this week"
      }
      ''') as Map<String, dynamic>;

      final result = AnalysisResult.fromJson(json);

      expect(result.oneLiner, 'Hedge holding steady');
      expect(result.trends, hasLength(2));
      expect(result.suggestedWeights, {'deesc': 30, 'base': 50, 'stag': 20});
      expect(result.trancheVerdict, 'deploy');
      expect(result.egpRead, 'Pound stable this week');
    });

    test('tolerates missing optional fields', () {
      final result = AnalysisResult.fromJson({'one_liner': 'Minimal'});
      expect(result.oneLiner, 'Minimal');
      expect(result.trends, isEmpty);
      expect(result.suggestedWeights, isNull);
      expect(result.trancheVerdict, isNull);
    });
  });

  group('buildAnalysisPrompt', () {
    test('includes spot, EGP rate, scenario weights, and watchlist in the prompt', () {
      final scenarios = [
        Scenario(id: 1, name: 'De-escalation', bandLow: 5800, bandHigh: 6300, weightPct: 35, probabilityPct: null, sortOrder: 0),
      ];
      final watchlist = [
        WatchlistItem(id: 1, label: 'Oil prices', status: 'support', sortOrder: 0),
      ];

      final prompt = buildAnalysisPrompt(
        spot: 5000,
        usdEgp: 50,
        scenarios: scenarios,
        watchlist: watchlist,
        langName: 'English',
      );

      expect(prompt, contains('5000'));
      expect(prompt, contains('50'));
      expect(prompt, contains('De-escalation'));
      expect(prompt, contains('Oil prices'));
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/features/ai_analyst/ai_analyst_repository_test.dart`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the model, prompt builder, and repository**

```dart
// flutter_app/lib/features/ai_analyst/data/ai_analyst_repository.dart
import 'dart:convert';
import 'package:dio/dio.dart';
import '../../scenarios/data/scenarios_repository.dart';
import '../../watchlist/data/watchlist_repository.dart';

class AnalysisResult {
  final String oneLiner;
  final List<String> trends;
  final Map<String, int>? suggestedWeights;
  final String? weightsReasoning;
  final String? trancheVerdict;
  final String? trancheReasoning;
  final String? egpRead;

  const AnalysisResult({
    required this.oneLiner,
    required this.trends,
    required this.suggestedWeights,
    required this.weightsReasoning,
    required this.trancheVerdict,
    required this.trancheReasoning,
    required this.egpRead,
  });

  factory AnalysisResult.fromJson(Map<String, dynamic> json) {
    final tranche2 = json['tranche2'] as Map<String, dynamic>?;
    final suggested = json['suggested_weights'] as Map<String, dynamic>?;

    return AnalysisResult(
      oneLiner: json['one_liner'] as String? ?? '',
      trends: (json['trends'] as List?)?.map((t) => t.toString()).toList() ?? [],
      suggestedWeights: suggested?.map((key, value) => MapEntry(key, (value as num).toInt())),
      weightsReasoning: json['weights_reasoning'] as String?,
      trancheVerdict: tranche2?['verdict'] as String?,
      trancheReasoning: tranche2?['reasoning'] as String?,
      egpRead: json['egp_read'] as String?,
    );
  }
}

String buildAnalysisPrompt({
  required double spot,
  required double usdEgp,
  required List<Scenario> scenarios,
  required List<WatchlistItem> watchlist,
  required String langName,
}) {
  final scenarioContext = scenarios
      .map((s) => '${s.name} (currently weighted ${s.weightPct.toStringAsFixed(0)}%, price band \$${s.bandLow}-\$${s.bandHigh})')
      .join(' | ');
  final watchContext = watchlist.map((w) => '${w.label}=${w.status}').join(', ');

  return '''
You are a senior precious-metals strategist advising a Cairo-based CIO on his personal gold hedge (EGP-denominated savings, 6-12 month horizon).

LIVE COCKPIT STATE (today):
- XAU/USD spot: \$$spot
- USD/EGP: $usdEgp
- Current scenario framework: $scenarioContext
- Watchlist assessment: $watchContext

TASK: Web-search the latest (last 1-2 weeks) on gold price drivers, Fed rate expectations, and EGP/USD. Then produce your analysis in $langName.

Respond with ONLY this JSON (no fences, no preamble). All string values in $langName:
{
 "one_liner": "single sharp sentence: the state of his hedge right now",
 "trends": ["3-4 items, each: what happened + direction of impact on gold"],
 "suggested_weights": {"deesc": int, "base": int, "stag": int},
 "weights_reasoning": "2-3 sentences: why these weights vs his current ones",
 "tranche2": {"verdict": "deploy" | "partial" | "wait", "reasoning": "2-3 sentences with an explicit trigger condition"},
 "egp_read": "2 sentences on the pound layer of his hedge"
}
Weights must sum to 100.
''';
}

class AiAnalystRepository {
  Future<AnalysisResult> analyze(Dio dio, String prompt) async {
    final response = await dio.post('/api/analyze', data: {'prompt': prompt});
    final text = response.data['text'] as String;
    return AnalysisResult.fromJson(jsonDecode(text) as Map<String, dynamic>);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/features/ai_analyst/ai_analyst_repository_test.dart`
Expected: PASS (4 tests)

- [ ] **Step 5: Implement the provider and screen**

```dart
// flutter_app/lib/features/ai_analyst/application/ai_analyst_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/ai_analyst_repository.dart';

final aiAnalystRepositoryProvider = Provider<AiAnalystRepository>((ref) => AiAnalystRepository());
```

```dart
// flutter_app/lib/features/ai_analyst/presentation/ai_analyst_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
import '../../scenarios/application/scenarios_providers.dart';
import '../../watchlist/application/watchlist_providers.dart';
import '../application/ai_analyst_providers.dart';
import '../data/ai_analyst_repository.dart';

class AiAnalystScreen extends ConsumerStatefulWidget {
  const AiAnalystScreen({super.key, this.spot = 0, this.usdEgp = 0});

  final double spot;
  final double usdEgp;

  @override
  ConsumerState<AiAnalystScreen> createState() => _AiAnalystScreenState();
}

class _AiAnalystScreenState extends ConsumerState<AiAnalystScreen> {
  AnalysisResult? _result;
  String? _error;
  bool _loading = false;

  Future<void> _analyze() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final scenarios = await ref.read(scenariosListProvider.future);
      final watchlist = await ref.read(watchlistListProvider.future);
      final prompt = buildAnalysisPrompt(
        spot: widget.spot,
        usdEgp: widget.usdEgp,
        scenarios: scenarios,
        watchlist: watchlist,
        langName: 'English',
      );
      final repository = ref.read(aiAnalystRepositoryProvider);
      final dio = ref.read(apiClientProvider).dio;
      final result = await repository.analyze(dio, prompt);
      setState(() => _result = result);
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ElevatedButton(
          key: const Key('analyzeButton'),
          onPressed: _loading ? null : _analyze,
          child: Text(_loading ? 'Analyzing…' : 'Analyze the market'),
        ),
        if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
        if (result != null) ...[
          const SizedBox(height: 16),
          Text(result.oneLiner, style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('What moved the market', style: TextStyle(fontWeight: FontWeight.w600)),
          for (final trend in result.trends) Text('• $trend'),
          if (result.weightsReasoning != null) ...[
            const SizedBox(height: 8),
            const Text('Suggested weights', style: TextStyle(fontWeight: FontWeight.w600)),
            Text(result.weightsReasoning!),
          ],
          if (result.trancheReasoning != null) ...[
            const SizedBox(height: 8),
            Text('Tranche 2 call: ${result.trancheVerdict ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(result.trancheReasoning!),
          ],
          if (result.egpRead != null) ...[
            const SizedBox(height: 8),
            const Text('EGP read', style: TextStyle(fontWeight: FontWeight.w600)),
            Text(result.egpRead!),
          ],
        ],
      ],
    );
  }
}
```

- [ ] **Step 6: Wire into the app shell**

In `flutter_app/lib/main.dart`:
```dart
import 'features/ai_analyst/presentation/ai_analyst_screen.dart';
// ...
_ShellDestination(strings.aiTab, const AiAnalystScreen()),
```

- [ ] **Step 7: Run analyze and tests**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: no analyzer issues, all tests pass

- [ ] **Step 8: Commit**

```bash
git add flutter_app/lib/features/ai_analyst flutter_app/lib/main.dart flutter_app/test/features/ai_analyst
git commit -m "feat: add AI analyst feature backed by /api/analyze"
```

---

## Task 20: Wire shared live state across screens

**Files:**
- Modify: `flutter_app/lib/main.dart`
- Test: `flutter_app/test/app_shell_test.dart`

**Interfaces:**
- Consumes: `marketSnapshotProvider` (Task 12), `scenariosListProvider` (Task 14).
- Produces: `AppShell` reads the market snapshot once (premium 0%) at the shell level and passes `spot`/`usdEgp`/gram prices down into `CalculatorScreen` and `AiAnalystScreen` via constructor params, instead of each screen hardcoding `0`.

- [ ] **Step 1: Write the failing widget test**

```dart
// flutter_app/test/app_shell_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/main.dart';

void main() {
  testWidgets('AppShell renders the market tab by default with a drawer listing all sections', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
        child: const MyApp(),
      ),
    );
    await tester.pump();

    expect(find.byType(Scaffold), findsWidgets);

    final scaffoldState = tester.state<ScaffoldState>(find.byType(Scaffold).first);
    scaffoldState.openDrawer();
    await tester.pumpAndSettle();

    expect(find.text('Market'), findsWidgets);
    expect(find.text('Scenarios'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flutter_app && flutter test test/app_shell_test.dart`
Expected: FAIL if the calculator/AI screens still take hardcoded `0` params and the market data isn't threaded through — the drawer assertions should already pass from Task 11, but this test locks in the full-shell contract before the wiring change; if it already passes, proceed to Step 3 regardless to complete the wiring.

- [ ] **Step 3: Thread the market snapshot into the shell**

Replace the body of `_AppShellState` in `flutter_app/lib/main.dart` (keep the `main()`, `MyApp`, and language-toggle wiring from Task 11 exactly as they are — only `AppShell`/`_AppShellState`/`_ShellDestination` change):

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'core/language_preference.dart';
import 'l10n/strings.dart';
import 'features/market/presentation/market_screen.dart';
import 'features/market/application/market_providers.dart';
import 'features/scenarios/presentation/scenarios_screen.dart';
import 'features/tranches/presentation/tranches_screen.dart';
import 'features/watchlist/presentation/watchlist_screen.dart';
import 'features/calculator/presentation/calculator_screen.dart';
import 'features/egypt_prices/presentation/egypt_prices_screen.dart';
import 'features/ai_analyst/presentation/ai_analyst_screen.dart';
import 'features/llm_providers/presentation/llm_providers_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(
    ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: const MyApp(),
    ),
  );
}

class MyApp extends ConsumerWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final language = ref.watch(languageProvider);
    final strings = Strings(language);
    return MaterialApp(
      title: strings.title,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFFC9A227)),
      home: const AppShell(),
    );
  }
}

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final language = ref.watch(languageProvider);
    final strings = Strings(language);

    final marketAsync = ref.watch(marketSnapshotProvider(0));
    final spot = marketAsync.value?.spotUsd ?? 0;
    final usdEgp = marketAsync.value?.usdEgp ?? 0;
    final gramPrices = marketAsync.value?.gramPrices;

    final destinations = <_ShellDestination>[
      _ShellDestination(strings.marketTab, const MarketScreen()),
      _ShellDestination(strings.scenariosTab, ScenariosScreen(spot: spot)),
      _ShellDestination(strings.dcaTab, const TranchesScreen()),
      _ShellDestination(strings.watchTab, const WatchlistScreen()),
      _ShellDestination(
        strings.calcTab,
        CalculatorScreen(
          gram24k: gramPrices?.g24 ?? 0,
          gram21k: gramPrices?.g21 ?? 0,
          gram18k: gramPrices?.g18 ?? 0,
        ),
      ),
      _ShellDestination(strings.egyptTab, const EgyptPricesScreen()),
      _ShellDestination(strings.aiTab, AiAnalystScreen(spot: spot, usdEgp: usdEgp)),
      _ShellDestination(strings.settingsTab, const LlmProvidersScreen()),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(destinations[_selectedIndex].label),
        actions: [
          IconButton(
            key: const Key('languageToggle'),
            icon: const Icon(Icons.translate),
            onPressed: () {
              final next = language == AppLanguage.en ? AppLanguage.ar : AppLanguage.en;
              ref.read(languageProvider.notifier).setLanguage(next);
            },
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          children: [
            DrawerHeader(child: Text(strings.title)),
            for (var i = 0; i < destinations.length; i++)
              ListTile(
                title: Text(destinations[i].label),
                selected: i == _selectedIndex,
                onTap: () {
                  setState(() => _selectedIndex = i);
                  Navigator.pop(context);
                },
              ),
          ],
        ),
      ),
      body: destinations[_selectedIndex].screen,
    );
  }
}

class _ShellDestination {
  final String label;
  final Widget screen;
  const _ShellDestination(this.label, this.screen);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd flutter_app && flutter test test/app_shell_test.dart`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full Flutter test suite and analyzer**

Run: `cd flutter_app && flutter analyze && flutter test`
Expected: "No issues found!" and all tests pass

- [ ] **Step 6: Commit**

```bash
git add flutter_app/lib/main.dart flutter_app/test/app_shell_test.dart
git commit -m "feat: thread live market snapshot into calculator, scenarios, and AI analyst screens"
```

---

## Task 21: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test` (from repo root)
Expected: all tests pass, including Tasks 1–5's new tests

- [ ] **Step 2: Run the full Flutter test suite**

Run: `cd flutter_app && flutter test`
Expected: all tests pass, including Tasks 7–20's new tests

- [ ] **Step 3: Run the Flutter analyzer**

Run: `cd flutter_app && flutter analyze`
Expected: "No issues found!"

- [ ] **Step 4: Confirm the backend starts and serves the new routes**

Run (from repo root, with a reachable `DATABASE_URL` configured): `npm run migrate && npm run server`
Then in another terminal: `curl http://localhost:8787/api/scenarios` and `curl http://localhost:8787/api/tranches`
Expected: both return JSON arrays with 3 seeded rows each; stop the server after confirming (Ctrl+C)

- [ ] **Step 5: Confirm the Flutter app builds for both target platforms**

Run: `cd flutter_app && flutter build apk --debug` and `flutter build ios --debug --no-codesign`
Expected: both builds succeed (iOS build requires a macOS host with Xcode installed)

- [ ] **Step 6: Commit any final fixups**

If Steps 1–5 required any code changes to pass, stage and commit them with a message describing what was fixed. If no changes were needed, this task requires no commit.
