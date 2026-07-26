# Gold Price Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a local Postgres database for Gold Cockpit with a migration runner and all 7 tables from the approved schema design (users, price_snapshots, feed_diagnostics, watchlist_items, scenarios, tranches, alert_rules).

**Architecture:** Plain `.sql` migration files applied in filename order by a small custom Node/ESM runner (`db/migrate-runner.mjs`) using the `pg` package, tracked in a `schema_migrations` table it creates itself. No migration framework — matches this project's existing "small custom store over a library" philosophy. Tests run against a real local Postgres test database (`gold_cockpit_test`), resetting the schema between runs and asserting shape via `information_schema`/`pg_catalog`.

**Tech Stack:** Postgres 15 (Homebrew, local), Node.js ESM (`"type": "module"` already set), `pg` (new dependency), `vitest` (new dependency), `dotenv` (new dependency).

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-19-gold-price-database-schema-design.md` — every column, type, constraint, and index below is copied from it verbatim.
- Retention: no expiry/downsampling logic for `price_snapshots` (explicit user decision — keep everything).
- Multi-user from the start: every per-user table has `user_id UUID REFERENCES users(id) ON DELETE CASCADE`.
- `price_snapshots` and `feed_diagnostics` are global (no `user_id`) and must never cascade-delete when a user is removed.
- Out of scope for this plan: `alert_events` table, LLM provider settings, any UI code, the ingestion script itself (only the schema it writes into).

---

## File Structure

```
gold-cockpit/
├── .env.example                          # DATABASE_URL / TEST_DATABASE_URL template
├── .gitignore                            # new — node_modules, .env, dist, tsbuildinfo
├── db/
│   ├── connection.mjs                    # pg Client factory from a connection string
│   ├── migrate-runner.mjs                # runMigrations(connectionString, migrationsDir)
│   └── migrate.mjs                       # CLI entry: node db/migrate.mjs
├── migrations/
│   ├── 0001_create_updated_at_trigger_fn.sql
│   ├── 0002_create_users.sql
│   ├── 0003_create_price_snapshots.sql
│   ├── 0004_create_feed_diagnostics.sql
│   ├── 0005_create_watchlist_items.sql
│   ├── 0006_create_scenarios.sql
│   ├── 0007_create_tranches.sql
│   └── 0008_create_alert_rules.sql
├── tests/
│   ├── helpers/
│   │   └── test-db.mjs                   # resetAndMigrate() against TEST_DATABASE_URL
│   └── db/
│       ├── fixtures/
│       │   ├── 0001_create_scratch.sql
│       │   └── 0002_alter_scratch.sql
│       ├── migrate-runner.test.mjs
│       ├── users.test.mjs
│       ├── price-snapshots.test.mjs
│       ├── feed-diagnostics.test.mjs
│       ├── watchlist-items.test.mjs
│       ├── scenarios.test.mjs
│       ├── tranches.test.mjs
│       └── alert-rules.test.mjs
├── vitest.config.mjs                     # new
└── package.json                          # add deps + "test" script
```

---

### Task 1: Environment setup, migration runner, git init

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `db/connection.mjs`
- Create: `db/migrate-runner.mjs`
- Create: `db/migrate.mjs`
- Create: `vitest.config.mjs`
- Create: `tests/helpers/test-db.mjs`
- Create: `tests/db/fixtures/0001_create_scratch.sql`
- Create: `tests/db/fixtures/0002_alter_scratch.sql`
- Create: `tests/db/migrate-runner.test.mjs`
- Modify: `package.json` (add `pg`, `dotenv`, `vitest` deps + `"test"` and `"migrate"` scripts)

**Interfaces:**
- Produces: `runMigrations(connectionString: string, migrationsDir: URL | string): Promise<string[]>` — returns the list of migration filenames that were newly applied (empty array if none pending). Exported from `db/migrate-runner.mjs`.
- Produces: `getClient(connectionString: string): pg.Client` — from `db/connection.mjs`, a thin wrapper so later scripts don't import `pg` directly.
- Produces: `resetAndMigrate(migrationsDir: URL | string): Promise<pg.Client>` from `tests/helpers/test-db.mjs` — drops and recreates the `public` schema on `TEST_DATABASE_URL`, runs `runMigrations` against it, and returns a connected `pg.Client` for the caller to run assertions with (caller is responsible for `client.end()`).

- [ ] **Step 1: Confirm Postgres is running and create the dev + test databases**

```bash
brew services start postgresql@15
```

Expected: `Successfully started ... postgresql@15` (or `already started` if it was already running).

```bash
createdb gold_cockpit_dev
createdb gold_cockpit_test
psql -l | grep gold_cockpit
```

Expected: both `gold_cockpit_dev` and `gold_cockpit_test` listed.

- [ ] **Step 2: Initialize git and add `.gitignore`**

```bash
cd "/Users/mys/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Ai small apps/gold cockpit "
git init
```

Create `.gitignore`:

```
node_modules/
dist/
.env
*.tsbuildinfo
```

```bash
git add .gitignore
git commit -m "chore: initialize git repository"
```

- [ ] **Step 3: Add dependencies**

```bash
npm install pg dotenv
npm install --save-dev vitest
```

Expected: `package.json` `dependencies` gains `pg`, `dotenv`; `devDependencies` gains `vitest`.

- [ ] **Step 4: Add `.env.example` and scripts to `package.json`**

Create `.env.example`:

```
DATABASE_URL=postgres://localhost:5432/gold_cockpit_dev
TEST_DATABASE_URL=postgres://localhost:5432/gold_cockpit_test
```

Copy it to a real `.env` (gitignored, not committed):

```bash
cp .env.example .env
```

Add to `package.json` `"scripts"`:

```json
"migrate": "node db/migrate.mjs",
"test": "vitest run"
```

- [ ] **Step 5: Write `vitest.config.mjs`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
    testTimeout: 15000,
  },
});
```

- [ ] **Step 6: Write the failing test for the migration runner**

Create `tests/db/fixtures/0001_create_scratch.sql`:

```sql
CREATE TABLE scratch (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL
);
```

Create `tests/db/fixtures/0002_alter_scratch.sql`:

```sql
ALTER TABLE scratch ADD COLUMN note TEXT;
```

Create `tests/db/migrate-runner.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { runMigrations } from '../../db/migrate-runner.mjs';

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url);
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

let client;

beforeEach(async () => {
  client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
});

afterEach(async () => {
  await client.end();
});

describe('runMigrations', () => {
  it('applies all pending migrations in filename order and records them', async () => {
    const applied = await runMigrations(TEST_DB_URL, FIXTURES_DIR);

    expect(applied).toEqual([
      '0001_create_scratch.sql',
      '0002_alter_scratch.sql',
    ]);

    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'scratch' ORDER BY ordinal_position"
    );
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'label', 'note']);
  });

  it('is idempotent — running twice applies nothing the second time', async () => {
    await runMigrations(TEST_DB_URL, FIXTURES_DIR);
    const secondRun = await runMigrations(TEST_DB_URL, FIXTURES_DIR);

    expect(secondRun).toEqual([]);
  });

  it('records applied filenames in schema_migrations', async () => {
    await runMigrations(TEST_DB_URL, FIXTURES_DIR);

    const { rows } = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    expect(rows.map((r) => r.filename)).toEqual([
      '0001_create_scratch.sql',
      '0002_alter_scratch.sql',
    ]);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
npm test -- migrate-runner
```

Expected: FAIL — `Cannot find module '../../db/migrate-runner.mjs'` (or similar import error), since the runner doesn't exist yet.

- [ ] **Step 8: Implement `db/connection.mjs`**

```js
import { Client } from 'pg';

export function getClient(connectionString) {
  return new Client({ connectionString });
}
```

- [ ] **Step 9: Implement `db/migrate-runner.mjs`**

```js
import { readdir, readFile } from 'node:fs/promises';
import { getClient } from './connection.mjs';

export async function runMigrations(connectionString, migrationsDir) {
  const client = getClient(connectionString);
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const allFiles = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.filename));

    const pending = allFiles.filter((name) => !alreadyApplied.has(name));

    for (const filename of pending) {
      const sql = await readFile(new URL(filename, migrationsDir), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${err.message}`);
      }
    }

    return pending;
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 10: Implement `db/migrate.mjs` (CLI entry)**

```js
import 'dotenv/config';
import { runMigrations } from './migrate-runner.mjs';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

const applied = await runMigrations(process.env.DATABASE_URL, MIGRATIONS_DIR);

if (applied.length === 0) {
  console.log('No pending migrations.');
} else {
  console.log(`Applied ${applied.length} migration(s):`);
  applied.forEach((name) => console.log(`  - ${name}`));
}
```

- [ ] **Step 11: Run the test to verify it passes**

```bash
npm test -- migrate-runner
```

Expected: PASS — all 3 tests in `migrate-runner.test.mjs` green.

- [ ] **Step 12: Write `tests/helpers/test-db.mjs`**

```js
import { runMigrations } from '../../db/migrate-runner.mjs';
import { getClient } from '../../db/connection.mjs';

export async function resetAndMigrate(migrationsDir) {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const resetClient = getClient(testDbUrl);
  await resetClient.connect();
  await resetClient.query('DROP SCHEMA public CASCADE');
  await resetClient.query('CREATE SCHEMA public');
  await resetClient.end();

  await runMigrations(testDbUrl, migrationsDir);

  const client = getClient(testDbUrl);
  await client.connect();
  return client;
}
```

- [ ] **Step 13: Commit**

```bash
git add .gitignore .env.example db/ vitest.config.mjs tests/ package.json package-lock.json
git commit -m "feat: add migration runner and test infrastructure"
```

---

### Task 2: `users` table + reusable `updated_at` trigger function

**Files:**
- Create: `migrations/0001_create_updated_at_trigger_fn.sql`
- Create: `migrations/0002_create_users.sql`
- Create: `tests/db/users.test.mjs`

**Interfaces:**
- Consumes: `resetAndMigrate(migrationsDir)` from Task 1 (`tests/helpers/test-db.mjs`).
- Produces: Postgres function `set_updated_at()` — reused by every later table with an `updated_at` column (watchlist_items, scenarios, tranches, alert_rules).
- Produces: `users` table (`id`, `email`, `display_name`, `preferred_lang`, `theme`, `created_at`, `updated_at`) — referenced by `user_id` FKs in every later per-user table.

- [ ] **Step 1: Write the failing test**

Create `tests/db/users.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('users table', () => {
  it('has the expected columns, defaults, and constraints', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'email',
      'display_name',
      'preferred_lang',
      'theme',
      'created_at',
      'updated_at',
    ]);

    const preferredLang = columns.find((c) => c.column_name === 'preferred_lang');
    expect(preferredLang.column_default).toBe("'en'::text");

    const theme = columns.find((c) => c.column_name === 'theme');
    expect(theme.column_default).toBe("'light'::text");
  });

  it('rejects duplicate emails', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    await client.query("INSERT INTO users (email) VALUES ('a@example.com')");

    await expect(
      client.query("INSERT INTO users (email) VALUES ('a@example.com')")
    ).rejects.toThrow(/duplicate key value/);
  });

  it('rejects an invalid preferred_lang', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    await expect(
      client.query(
        "INSERT INTO users (email, preferred_lang) VALUES ('b@example.com', 'fr')"
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('sets updated_at automatically on UPDATE via the shared trigger function', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(
      "INSERT INTO users (email) VALUES ('c@example.com') RETURNING id, updated_at"
    );
    const { id, updated_at: originalUpdatedAt } = rows[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.query("UPDATE users SET display_name = 'C' WHERE id = $1", [id]);

    const { rows: after } = await client.query(
      'SELECT updated_at FROM users WHERE id = $1',
      [id]
    );
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- users
```

Expected: FAIL — `relation "users" does not exist`.

- [ ] **Step 3: Write the migrations**

Create `migrations/0001_create_updated_at_trigger_fn.sql`:

```sql
CREATE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Create `migrations/0002_create_users.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    preferred_lang TEXT NOT NULL DEFAULT 'en' CHECK (preferred_lang IN ('ar', 'en')),
    theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'vault')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- users
```

Expected: PASS — all 4 tests in `users.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0001_create_updated_at_trigger_fn.sql migrations/0002_create_users.sql tests/db/users.test.mjs
git commit -m "feat: add users table and shared updated_at trigger"
```

---

### Task 3: `price_snapshots` table

**Files:**
- Create: `migrations/0003_create_price_snapshots.sql`
- Create: `tests/db/price-snapshots.test.mjs`

**Interfaces:**
- Consumes: `resetAndMigrate(migrationsDir)` from Task 1.
- Produces: `price_snapshots` table (global, no `user_id`) — referenced by `feed_diagnostics.snapshot_id` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/db/price-snapshots.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('price_snapshots table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'price_snapshots'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'fetched_at',
      'xau_usd',
      'usd_egp',
      'gram_24k_egp',
      'gram_22k_egp',
      'gram_21k_egp',
      'gram_18k_egp',
      'gold_pound_egp',
      'souq_dollar_egp',
      'souq_spread_pct',
      'calibration_premium_pct',
      'created_at',
    ]);

    const nullable = Object.fromEntries(
      columns.map((c) => [c.column_name, c.is_nullable])
    );
    expect(nullable.xau_usd).toBe('NO');
    expect(nullable.souq_dollar_egp).toBe('YES');
  });

  it('inserts a full snapshot row', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(`
      INSERT INTO price_snapshots
        (fetched_at, xau_usd, usd_egp, gram_24k_egp, gram_22k_egp, gram_21k_egp, gram_18k_egp, gold_pound_egp)
      VALUES (now(), 2400.5000, 47.8000, 3700.1200, 3391.7700, 3237.6000, 2775.0900, 25939.0000)
      RETURNING id
    `);

    expect(rows).toHaveLength(1);
  });

  it('has an index on fetched_at', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'price_snapshots' AND indexname = 'idx_price_snapshots_fetched_at'
    `);

    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- price-snapshots
```

Expected: FAIL — `relation "price_snapshots" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0003_create_price_snapshots.sql`:

```sql
CREATE TABLE price_snapshots (
    id BIGSERIAL PRIMARY KEY,
    fetched_at TIMESTAMPTZ NOT NULL,
    xau_usd NUMERIC(12, 4) NOT NULL,
    usd_egp NUMERIC(12, 4) NOT NULL,
    gram_24k_egp NUMERIC(12, 4) NOT NULL,
    gram_22k_egp NUMERIC(12, 4) NOT NULL,
    gram_21k_egp NUMERIC(12, 4) NOT NULL,
    gram_18k_egp NUMERIC(12, 4) NOT NULL,
    gold_pound_egp NUMERIC(12, 4) NOT NULL,
    souq_dollar_egp NUMERIC(12, 4),
    souq_spread_pct NUMERIC(8, 4),
    calibration_premium_pct NUMERIC(8, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_snapshots_fetched_at ON price_snapshots (fetched_at DESC);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- price-snapshots
```

Expected: PASS — all 3 tests in `price-snapshots.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_create_price_snapshots.sql tests/db/price-snapshots.test.mjs
git commit -m "feat: add price_snapshots table"
```

---

### Task 4: `feed_diagnostics` table

**Files:**
- Create: `migrations/0004_create_feed_diagnostics.sql`
- Create: `tests/db/feed-diagnostics.test.mjs`

**Interfaces:**
- Consumes: `price_snapshots(id)` from Task 3 as the FK target for `snapshot_id`.
- Produces: `feed_diagnostics` table — standalone, nothing later depends on it.

- [ ] **Step 1: Write the failing test**

Create `tests/db/feed-diagnostics.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('feed_diagnostics table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'feed_diagnostics'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'snapshot_id',
      'feed_type',
      'source_name',
      'success',
      'latency_ms',
      'error_message',
      'attempted_at',
      'detail',
    ]);
  });

  it('allows snapshot_id to be null for a fully failed pull', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(`
      INSERT INTO feed_diagnostics (feed_type, source_name, success)
      VALUES ('gold', 'metals-api', false)
      RETURNING id, snapshot_id
    `);

    expect(rows[0].snapshot_id).toBeNull();
  });

  it('cascade-deletes when the parent snapshot is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: snapshotRows } = await client.query(`
      INSERT INTO price_snapshots
        (fetched_at, xau_usd, usd_egp, gram_24k_egp, gram_22k_egp, gram_21k_egp, gram_18k_egp, gold_pound_egp)
      VALUES (now(), 2400.5, 47.8, 3700.12, 3391.77, 3237.6, 2775.09, 25939.0)
      RETURNING id
    `);
    const snapshotId = snapshotRows[0].id;

    await client.query(
      `INSERT INTO feed_diagnostics (snapshot_id, feed_type, source_name, success)
       VALUES ($1, 'gold', 'metals-api', true)`,
      [snapshotId]
    );

    await client.query('DELETE FROM price_snapshots WHERE id = $1', [snapshotId]);

    const { rows } = await client.query(
      'SELECT * FROM feed_diagnostics WHERE snapshot_id = $1',
      [snapshotId]
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid feed_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    await expect(
      client.query(
        "INSERT INTO feed_diagnostics (feed_type, source_name, success) VALUES ('crypto', 'x', true)"
      )
    ).rejects.toThrow(/violates check constraint/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- feed-diagnostics
```

Expected: FAIL — `relation "feed_diagnostics" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0004_create_feed_diagnostics.sql`:

```sql
CREATE TABLE feed_diagnostics (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT REFERENCES price_snapshots(id) ON DELETE CASCADE,
    feed_type TEXT NOT NULL CHECK (feed_type IN ('gold', 'fx')),
    source_name TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    latency_ms INTEGER,
    error_message TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    detail JSONB
);

CREATE INDEX idx_feed_diagnostics_snapshot_id ON feed_diagnostics (snapshot_id);
CREATE INDEX idx_feed_diagnostics_attempted_at ON feed_diagnostics (attempted_at DESC);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- feed-diagnostics
```

Expected: PASS — all 4 tests in `feed-diagnostics.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0004_create_feed_diagnostics.sql tests/db/feed-diagnostics.test.mjs
git commit -m "feat: add feed_diagnostics table"
```

---

### Task 5: `watchlist_items` table

**Files:**
- Create: `migrations/0005_create_watchlist_items.sql`
- Create: `tests/db/watchlist-items.test.mjs`

**Interfaces:**
- Consumes: `users(id)` from Task 2 as the FK target; `set_updated_at()` trigger function from Task 2.
- Produces: `watchlist_items` table — standalone, nothing later depends on it.

- [ ] **Step 1: Write the failing test**

Create `tests/db/watchlist-items.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

async function makeUser(client, email) {
  const { rows } = await client.query(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email]
  );
  return rows[0].id;
}

describe('watchlist_items table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'watchlist_items'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'label',
      'status',
      'sort_order',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects a label longer than 40 characters', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'watch1@example.com');

    const longLabel = 'x'.repeat(41);
    await expect(
      client.query(
        'INSERT INTO watchlist_items (user_id, label, status) VALUES ($1, $2, $3)',
        [userId, longLabel, 'neutral']
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'watch2@example.com');

    await client.query(
      'INSERT INTO watchlist_items (user_id, label, status) VALUES ($1, $2, $3)',
      [userId, 'Fed rate decision', 'bullish']
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM watchlist_items WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });

  it('updates updated_at automatically', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'watch3@example.com');

    const { rows } = await client.query(
      `INSERT INTO watchlist_items (user_id, label, status)
       VALUES ($1, 'CBE reserves', 'neutral') RETURNING id, updated_at`,
      [userId]
    );
    const { id, updated_at: original } = rows[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.query("UPDATE watchlist_items SET status = 'bearish' WHERE id = $1", [id]);

    const { rows: after } = await client.query(
      'SELECT updated_at FROM watchlist_items WHERE id = $1',
      [id]
    );
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
      new Date(original).getTime()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- watchlist-items
```

Expected: FAIL — `relation "watchlist_items" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0005_create_watchlist_items.sql`:

```sql
CREATE TABLE watchlist_items (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (char_length(label) <= 40),
    status TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_items_user_id ON watchlist_items (user_id, sort_order);

CREATE TRIGGER watchlist_items_set_updated_at
    BEFORE UPDATE ON watchlist_items
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- watchlist-items
```

Expected: PASS — all 4 tests in `watchlist-items.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0005_create_watchlist_items.sql tests/db/watchlist-items.test.mjs
git commit -m "feat: add watchlist_items table"
```

---

### Task 6: `scenarios` table

**Files:**
- Create: `migrations/0006_create_scenarios.sql`
- Create: `tests/db/scenarios.test.mjs`

**Interfaces:**
- Consumes: `users(id)` from Task 2; `set_updated_at()` trigger function from Task 2.
- Produces: `scenarios` table — standalone, nothing later depends on it.

- [ ] **Step 1: Write the failing test**

Create `tests/db/scenarios.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

async function makeUser(client, email) {
  const { rows } = await client.query(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email]
  );
  return rows[0].id;
}

describe('scenarios table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'scenarios'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'name',
      'band_low',
      'band_high',
      'weight_pct',
      'probability_pct',
      'sort_order',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects a weight_pct above 100', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'scenario1@example.com');

    await expect(
      client.query(
        'INSERT INTO scenarios (user_id, name, weight_pct) VALUES ($1, $2, $3)',
        [userId, 'Bull case', 150]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('rejects a negative weight_pct', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'scenario2@example.com');

    await expect(
      client.query(
        'INSERT INTO scenarios (user_id, name, weight_pct) VALUES ($1, $2, $3)',
        [userId, 'Bear case', -5]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'scenario3@example.com');

    await client.query(
      'INSERT INTO scenarios (user_id, name, weight_pct) VALUES ($1, $2, $3)',
      [userId, 'Base case', 50]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM scenarios WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- scenarios
```

Expected: FAIL — `relation "scenarios" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0006_create_scenarios.sql`:

```sql
CREATE TABLE scenarios (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    band_low NUMERIC(12, 4),
    band_high NUMERIC(12, 4),
    weight_pct NUMERIC(5, 2) NOT NULL CHECK (weight_pct BETWEEN 0 AND 100),
    probability_pct NUMERIC(5, 2),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_user_id ON scenarios (user_id);

CREATE TRIGGER scenarios_set_updated_at
    BEFORE UPDATE ON scenarios
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- scenarios
```

Expected: PASS — all 4 tests in `scenarios.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0006_create_scenarios.sql tests/db/scenarios.test.mjs
git commit -m "feat: add scenarios table"
```

---

### Task 7: `tranches` table

**Files:**
- Create: `migrations/0007_create_tranches.sql`
- Create: `tests/db/tranches.test.mjs`

**Interfaces:**
- Consumes: `users(id)` from Task 2; `set_updated_at()` trigger function from Task 2.
- Produces: `tranches` table — standalone, nothing later depends on it.

- [ ] **Step 1: Write the failing test**

Create `tests/db/tranches.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

async function makeUser(client, email) {
  const { rows } = await client.query(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email]
  );
  return rows[0].id;
}

describe('tranches table', () => {
  it('has the expected columns and default status', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'tranches'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'tranche_number',
      'plan_pct',
      'amount_egp',
      'gram_equivalent',
      'status',
      'purchased_at',
      'created_at',
      'updated_at',
    ]);

    const status = columns.find((c) => c.column_name === 'status');
    expect(status.column_default).toBe("'pending'::text");
  });

  it('rejects a tranche_number outside 1..3', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'tranche1@example.com');

    await expect(
      client.query(
        'INSERT INTO tranches (user_id, tranche_number, plan_pct) VALUES ($1, $2, $3)',
        [userId, 4, 40]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('rejects an invalid status', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'tranche2@example.com');

    await expect(
      client.query(
        "INSERT INTO tranches (user_id, tranche_number, plan_pct, status) VALUES ($1, 1, 40, 'cancelled')",
        [userId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'tranche3@example.com');

    await client.query(
      'INSERT INTO tranches (user_id, tranche_number, plan_pct) VALUES ($1, 1, 40)',
      [userId]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM tranches WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tranches
```

Expected: FAIL — `relation "tranches" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0007_create_tranches.sql`:

```sql
CREATE TABLE tranches (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tranche_number SMALLINT NOT NULL CHECK (tranche_number BETWEEN 1 AND 3),
    plan_pct NUMERIC(5, 2) NOT NULL,
    amount_egp NUMERIC(14, 2),
    gram_equivalent NUMERIC(12, 4),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'filled')),
    purchased_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tranches_user_id ON tranches (user_id);

CREATE TRIGGER tranches_set_updated_at
    BEFORE UPDATE ON tranches
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tranches
```

Expected: PASS — all 4 tests in `tranches.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0007_create_tranches.sql tests/db/tranches.test.mjs
git commit -m "feat: add tranches table"
```

---

### Task 8: `alert_rules` table

**Files:**
- Create: `migrations/0008_create_alert_rules.sql`
- Create: `tests/db/alert-rules.test.mjs`

**Interfaces:**
- Consumes: `users(id)` from Task 2; `set_updated_at()` trigger function from Task 2.
- Produces: `alert_rules` table — final table in this plan; no downstream consumers.

- [ ] **Step 1: Write the failing test**

Create `tests/db/alert-rules.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

async function makeUser(client, email) {
  const { rows } = await client.query(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email]
  );
  return rows[0].id;
}

describe('alert_rules table', () => {
  it('has the expected columns and defaults', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'alert_rules'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'rule_type',
      'config',
      'active',
      'created_at',
      'updated_at',
    ]);

    const active = columns.find((c) => c.column_name === 'active');
    expect(active.column_default).toBe('true');
  });

  it('stores arbitrary jsonb config per rule_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'alert1@example.com');

    const { rows } = await client.query(
      `INSERT INTO alert_rules (user_id, rule_type, config)
       VALUES ($1, 'egp_move', $2::jsonb)
       RETURNING config`,
      [userId, JSON.stringify({ threshold_pct: 1.0, direction: 'either' })]
    );

    expect(rows[0].config).toEqual({ threshold_pct: 1.0, direction: 'either' });
  });

  it('rejects an invalid rule_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'alert2@example.com');

    await expect(
      client.query(
        "INSERT INTO alert_rules (user_id, rule_type, config) VALUES ($1, 'price_spike', '{}'::jsonb)",
        [userId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'alert3@example.com');

    await client.query(
      "INSERT INTO alert_rules (user_id, rule_type, config) VALUES ($1, 'band_edge', '{}'::jsonb)",
      [userId]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM alert_rules WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- alert-rules
```

Expected: FAIL — `relation "alert_rules" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0008_create_alert_rules.sql`:

```sql
CREATE TABLE alert_rules (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('band_edge', 'egp_move', 'tranche_window')),
    config JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_rules_user_id ON alert_rules (user_id);

CREATE TRIGGER alert_rules_set_updated_at
    BEFORE UPDATE ON alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- alert-rules
```

Expected: PASS — all 4 tests in `alert-rules.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0008_create_alert_rules.sql tests/db/alert-rules.test.mjs
git commit -m "feat: add alert_rules table"
```

---

### Task 9: Apply migrations to the dev database and full-suite verification

**Files:**
- None created — this task verifies the accumulated work from Tasks 1–8 against `gold_cockpit_dev`.

**Interfaces:**
- Consumes: `db/migrate.mjs` CLI from Task 1, all migration files from Tasks 2–8.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: PASS — all test files (`migrate-runner`, `users`, `price-snapshots`, `feed-diagnostics`, `watchlist-items`, `scenarios`, `tranches`, `alert-rules`) green, no failures.

- [ ] **Step 2: Apply all migrations to the dev database**

```bash
npm run migrate
```

Expected output:

```
Applied 8 migration(s):
  - 0001_create_updated_at_trigger_fn.sql
  - 0002_create_users.sql
  - 0003_create_price_snapshots.sql
  - 0004_create_feed_diagnostics.sql
  - 0005_create_watchlist_items.sql
  - 0006_create_scenarios.sql
  - 0007_create_tranches.sql
  - 0008_create_alert_rules.sql
```

- [ ] **Step 3: Verify all 7 tables exist in the dev database**

```bash
psql gold_cockpit_dev -c "\dt"
```

Expected: `users`, `price_snapshots`, `feed_diagnostics`, `watchlist_items`, `scenarios`, `tranches`, `alert_rules`, `schema_migrations` all listed.

- [ ] **Step 4: Verify re-running the migrate command is a no-op**

```bash
npm run migrate
```

Expected: `No pending migrations.`

- [ ] **Step 5: Commit**

No files changed by this task (verification only) — nothing to commit. If `.env` was accidentally staged at any point, confirm it is not tracked:

```bash
git status
```

Expected: `.env` not listed as tracked (it's in `.gitignore` from Task 1).
