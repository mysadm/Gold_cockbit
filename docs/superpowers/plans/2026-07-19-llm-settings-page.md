# LLM Provider Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded, browser-side Anthropic-only AI analyst with a Settings page that lets the user configure and switch between multiple LLM providers (Ollama, OpenAI, Claude, Custom OpenAI-compatible), with all provider calls routed through a new local Express backend.

**Architecture:** A new `llm_providers` Postgres table (migration 0009, using the existing migration runner) stores per-provider config for a single default user. A new local Express server (`server/`) exposes CRUD + activate routes over that table and a `POST /api/analyze` route that dispatches to one of two adapters (`claude.mjs` for Anthropic's Messages API with web search, `openaiCompatible.mjs` for OpenAI/Ollama/Custom's shared chat-completions shape) based on the active provider's type. The frontend (`src/App.tsx`) gets a new Settings tab for provider CRUD and its existing `analyze()` function is rewired to call the backend instead of Anthropic directly.

**Tech Stack:** Node.js ESM, Express (new dependency) + `pg.Pool` (new: `server/pool.mjs`, distinct from the existing `db/connection.mjs` which uses a single `Client` for migrations/tests), Vitest + Supertest (new dev dependency) for backend route tests, Preact/TypeScript for the frontend.

## Global Constraints

- Reuses existing infrastructure without modification: `db/connection.mjs`, `db/migrate-runner.mjs`, `db/migrate.mjs`, `tests/helpers/test-db.mjs`, the `set_updated_at()` trigger function (migration 0001), `vitest.config.mjs`'s `fileParallelism: false`.
- `llm_providers` columns exactly: `id BIGSERIAL PK`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama','openai','claude','custom'))`, `label TEXT NOT NULL`, `base_url TEXT` (nullable), `api_key TEXT` (nullable), `model TEXT NOT NULL`, `is_active BOOLEAN NOT NULL DEFAULT FALSE`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Partial unique index `idx_llm_providers_one_active_per_user ON llm_providers (user_id) WHERE is_active` enforces "at most one active provider per user" at the DB level.
- Web-search capability is a pure function of `provider_type` in code (`PROVIDER_CAPABILITIES`), never a DB column, never user-toggled.
- All provider calls (Claude, OpenAI, Ollama, Custom) are made server-side only — the browser never calls a provider directly and never holds an API key.
- Single fixed default user (`default@local`), auto-created on server startup via `INSERT ... ON CONFLICT DO NOTHING` — no login/auth UI.
- API keys stored as plaintext `TEXT` in Postgres — an explicit, documented simplification for a local single-user tool, not a gap to fix in this plan.
- Out of scope: real auth, key encryption, streaming responses, any change to `scenarios`/`tranches`/`watchlist_items`/`alert_rules`, a per-request provider dropdown, user-editable web-search capability.

---

## File Structure

```
gold-cockpit/
├── migrations/
│   └── 0009_create_llm_providers.sql          # new
├── server/                                     # new directory
│   ├── pool.mjs                                # pg.Pool factory (server-only; distinct from db/connection.mjs's Client)
│   ├── ensureDefaultUser.mjs                    # idempotent default-user creation
│   ├── index.mjs                                # Express app assembly + listen
│   ├── providers/
│   │   ├── capabilities.mjs                     # PROVIDER_CAPABILITIES map
│   │   ├── claude.mjs                           # Anthropic Messages API adapter
│   │   ├── openaiCompatible.mjs                 # OpenAI/Ollama/Custom shared adapter
│   │   └── dispatch.mjs                         # runProviderAnalysis(providerRow, prompt)
│   └── routes/
│       ├── llmProviders.mjs                     # CRUD + activate router
│       └── analyze.mjs                          # POST /api/analyze router
├── tests/
│   ├── db/
│   │   └── llm-providers.test.mjs               # new
│   └── server/                                  # new directory
│       ├── ensure-default-user.test.mjs
│       ├── claude-provider.test.mjs
│       ├── openai-compatible-provider.test.mjs
│       ├── dispatch.test.mjs
│       ├── llm-providers-routes.test.mjs
│       └── analyze-route.test.mjs
├── src/
│   ├── api/
│   │   └── llmProviders.ts                      # new — frontend fetch client
│   ├── App.tsx                                  # modified — Settings tab, analyze() rewire
│   └── styles.css                               # modified — settings UI classes
├── vite.config.ts                                # modified — proxy /api to backend
├── start.sh                                       # modified — boot server + vite together
└── package.json                                  # modified — express, supertest, "server" script
```

---

### Task 1: `llm_providers` table

**Files:**
- Create: `migrations/0009_create_llm_providers.sql`
- Create: `tests/db/llm-providers.test.mjs`

**Interfaces:**
- Consumes: `resetAndMigrate(migrationsDir)` from `tests/helpers/test-db.mjs`; `users(id)` and `set_updated_at()` from migrations 0001/0002.
- Produces: `llm_providers` table, consumed by every later server-side task via raw SQL (no ORM/model layer).

- [ ] **Step 1: Write the failing test**

Create `tests/db/llm-providers.test.mjs`:

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

describe('llm_providers table', () => {
  it('has the expected columns and defaults', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'llm_providers'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'provider_type',
      'label',
      'base_url',
      'api_key',
      'model',
      'is_active',
      'created_at',
      'updated_at',
    ]);

    const isActive = columns.find((c) => c.column_name === 'is_active');
    expect(isActive.column_default).toBe('false');
  });

  it('rejects an invalid provider_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm1@example.com');

    await expect(
      client.query(
        "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'gemini', 'x', 'm')",
        [userId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('allows base_url and api_key to be null', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm2@example.com');

    const { rows } = await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'ollama', 'Local', 'llama3.1') RETURNING base_url, api_key",
      [userId]
    );

    expect(rows[0].base_url).toBeNull();
    expect(rows[0].api_key).toBeNull();
  });

  it('enforces at most one active provider per user', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm3@example.com');

    await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)",
      [userId]
    );

    await expect(
      client.query(
        "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'openai', 'OpenAI', 'gpt-4o', true)",
        [userId]
      )
    ).rejects.toThrow(/duplicate key value/);
  });

  it('allows a second active provider once the first is deactivated', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm4@example.com');

    const { rows: firstRows } = await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true) RETURNING id",
      [userId]
    );

    await client.query('UPDATE llm_providers SET is_active = false WHERE id = $1', [firstRows[0].id]);

    await expect(
      client.query(
        "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'openai', 'OpenAI', 'gpt-4o', true)",
        [userId]
      )
    ).resolves.toBeDefined();
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm5@example.com');

    await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'ollama', 'Local', 'llama3.1')",
      [userId]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query('SELECT * FROM llm_providers WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(0);
  });

  it('updates updated_at automatically', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm6@example.com');

    const { rows } = await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'ollama', 'Local', 'llama3.1') RETURNING id, updated_at",
      [userId]
    );
    const { id, updated_at: original } = rows[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.query("UPDATE llm_providers SET label = 'Renamed' WHERE id = $1", [id]);

    const { rows: after } = await client.query('SELECT updated_at FROM llm_providers WHERE id = $1', [id]);
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(new Date(original).getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- llm-providers
```

Expected: FAIL — `relation "llm_providers" does not exist`.

- [ ] **Step 3: Write the migration**

Create `migrations/0009_create_llm_providers.sql`:

```sql
CREATE TABLE llm_providers (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'claude', 'custom')),
    label TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    model TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_providers_user_id ON llm_providers (user_id);
CREATE UNIQUE INDEX idx_llm_providers_one_active_per_user ON llm_providers (user_id) WHERE is_active;

CREATE TRIGGER llm_providers_set_updated_at
    BEFORE UPDATE ON llm_providers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- llm-providers
```

Expected: PASS — all 7 tests in `llm-providers.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add migrations/0009_create_llm_providers.sql tests/db/llm-providers.test.mjs
git commit -m "feat: add llm_providers table"
```

---

### Task 2: Backend foundations — pool + default user

**Files:**
- Create: `server/pool.mjs`
- Create: `server/ensureDefaultUser.mjs`
- Create: `tests/server/ensure-default-user.test.mjs`
- Modify: `package.json` (add `express` dependency, `supertest` dev dependency)

**Interfaces:**
- Produces: `getPool(connectionString): pg.Pool` from `server/pool.mjs`.
- Produces: `ensureDefaultUser(db): Promise<string>` from `server/ensureDefaultUser.mjs` — `db` is anything with a `.query()` method (a `Pool` in production, a `Client` in tests); returns the default user's UUID. Consumed by every later server task.

- [ ] **Step 1: Add dependencies**

```bash
npm install express
npm install --save-dev supertest
```

- [ ] **Step 2: Write the failing test**

Create `tests/server/ensure-default-user.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultUser', () => {
  it('creates the default user on first call', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const userId = await ensureDefaultUser(client);

    const { rows } = await client.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('default@local');
  });

  it('is idempotent — calling twice returns the same user id and creates no duplicate', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const firstId = await ensureDefaultUser(client);
    const secondId = await ensureDefaultUser(client);

    expect(secondId).toBe(firstId);

    const { rows } = await client.query('SELECT id FROM users');
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- ensure-default-user
```

Expected: FAIL — `Cannot find module '../../server/ensureDefaultUser.mjs'`.

- [ ] **Step 4: Implement `server/pool.mjs`**

```js
import { Pool } from 'pg';

export function getPool(connectionString) {
  return new Pool({ connectionString });
}
```

- [ ] **Step 5: Implement `server/ensureDefaultUser.mjs`**

```js
const DEFAULT_USER_EMAIL = 'default@local';

export async function ensureDefaultUser(db) {
  await db.query(
    'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
    [DEFAULT_USER_EMAIL]
  );
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [DEFAULT_USER_EMAIL]);
  return rows[0].id;
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm test -- ensure-default-user
```

Expected: PASS — both tests in `ensure-default-user.test.mjs` green.

- [ ] **Step 7: Commit**

```bash
git add server/pool.mjs server/ensureDefaultUser.mjs tests/server/ensure-default-user.test.mjs package.json package-lock.json
git commit -m "feat: add server pool and default-user bootstrap"
```

---

### Task 3: Claude provider adapter

**Files:**
- Create: `server/providers/capabilities.mjs`
- Create: `server/providers/claude.mjs`
- Create: `tests/server/claude-provider.test.mjs`

**Interfaces:**
- Produces: `PROVIDER_CAPABILITIES: Record<'ollama'|'openai'|'claude'|'custom', { supportsWebSearch: boolean }>` from `capabilities.mjs`, consumed by `dispatch.mjs` (Task 5) conceptually (dispatch itself branches on `provider_type` directly — see Task 5 — but `capabilities.mjs` is the single documented source of which providers support web search, and the analyze route surfaces `usedWebSearch` from what `claude.mjs` actually did).
- Produces: `callClaude({ apiKey, model, prompt }): Promise<{ text: string, usedWebSearch: boolean }>` from `claude.mjs`, consumed by `dispatch.mjs` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `tests/server/claude-provider.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callClaude } from '../../server/providers/claude.mjs';

describe('callClaude', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns text and usedWebSearch=true on a successful tool-enabled call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"ok"}' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
  });

  it('falls back to a no-tools call if the first call fails, and reports usedWebSearch=false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ error: { message: 'HTTP 500' } }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"fallback"}' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result).toEqual({ text: '{"one_liner":"fallback"}', usedWebSearch: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondOptions] = fetchMock.mock.calls[1];
    expect(JSON.parse(secondOptions.body).tools).toBeUndefined();
  });

  it('throws the original error if both the tool-enabled and fallback calls fail', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ error: { message: 'first failure' } }) })
      .mockResolvedValueOnce({ ok: false, text: async () => JSON.stringify({ error: { message: 'second failure' } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' })
    ).rejects.toThrow('first failure');
  });

  it('sends a continuation turn if the first reply has no JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'plain text, no braces' }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"one_liner":"continued"}' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6', prompt: 'analyze' });

    expect(result.text).toBe('{"one_liner":"continued"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- claude-provider
```

Expected: FAIL — `Cannot find module '../../server/providers/claude.mjs'`.

- [ ] **Step 3: Implement `server/providers/capabilities.mjs`**

```js
export const PROVIDER_CAPABILITIES = {
  claude: { supportsWebSearch: true },
  openai: { supportsWebSearch: false },
  ollama: { supportsWebSearch: false },
  custom: { supportsWebSearch: false },
};
```

- [ ] **Step 4: Implement `server/providers/claude.mjs`**

```js
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 90000;

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

async function callAnthropic({ apiKey, model, messages, withTools }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const body = { model, max_tokens: 4000, messages };
    if (withTools) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text } };
    }
    if (!response.ok || data.error) {
      throw new Error((data?.error?.message || `HTTP ${response.status}`).slice(0, 140));
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callClaude({ apiKey, model, prompt }) {
  let messages = [{ role: 'user', content: prompt }];
  let data;
  let usedWebSearch = true;

  try {
    data = await callAnthropic({ apiKey, model, messages, withTools: true });
  } catch (firstErr) {
    try {
      data = await callAnthropic({ apiKey, model, messages, withTools: false });
      usedWebSearch = false;
    } catch {
      throw firstErr;
    }
  }

  let text = extractText(data?.content);
  if (!text.includes('{')) {
    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: 'Output ONLY the final JSON object now.' },
    ];
    data = await callAnthropic({ apiKey, model, messages, withTools: false });
    text = extractText(data?.content);
  }

  return { text, usedWebSearch };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- claude-provider
```

Expected: PASS — all 4 tests in `claude-provider.test.mjs` green.

- [ ] **Step 6: Commit**

```bash
git add server/providers/capabilities.mjs server/providers/claude.mjs tests/server/claude-provider.test.mjs
git commit -m "feat: add Claude provider adapter"
```

---

### Task 4: OpenAI-compatible provider adapter

**Files:**
- Create: `server/providers/openaiCompatible.mjs`
- Create: `tests/server/openai-compatible-provider.test.mjs`

**Interfaces:**
- Produces: `callOpenAICompatible({ baseUrl, apiKey, model, prompt }): Promise<{ text: string, usedWebSearch: false }>`, consumed by `dispatch.mjs` (Task 5). Used for OpenAI, Ollama, and Custom provider types.

- [ ] **Step 1: Write the failing test**

Create `tests/server/openai-compatible-provider.test.mjs`:

```js
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callOpenAICompatible } from '../../server/providers/openaiCompatible.mjs';

describe('callOpenAICompatible', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to {baseUrl}/chat/completions with an Authorization header when apiKey is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"one_liner":"ok"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatible({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      prompt: 'analyze',
    });

    expect(result).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(options.body)).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'analyze' }],
    });
  });

  it('omits the Authorization header when apiKey is not set (Ollama case)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"one_liner":"local"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await callOpenAICompatible({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      model: 'llama3.1',
      prompt: 'analyze',
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('throws with the provider error message on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'https://api.openai.com/v1', apiKey: 'bad', model: 'gpt-4o', prompt: 'x' })
    ).rejects.toThrow('invalid api key');
  });

  it('throws with an HTTP status message when the error body has no message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callOpenAICompatible({ baseUrl: 'http://localhost:11434/v1', apiKey: null, model: 'llama3.1', prompt: 'x' })
    ).rejects.toThrow('HTTP 503');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- openai-compatible-provider
```

Expected: FAIL — `Cannot find module '../../server/providers/openaiCompatible.mjs'`.

- [ ] **Step 3: Implement `server/providers/openaiCompatible.mjs`**

```js
export async function callOpenAICompatible({ baseUrl, apiKey, model, prompt }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }

  const text = data?.choices?.[0]?.message?.content || '';
  return { text, usedWebSearch: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- openai-compatible-provider
```

Expected: PASS — all 4 tests in `openai-compatible-provider.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add server/providers/openaiCompatible.mjs tests/server/openai-compatible-provider.test.mjs
git commit -m "feat: add OpenAI-compatible provider adapter"
```

---

### Task 5: Dispatch

**Files:**
- Create: `server/providers/dispatch.mjs`
- Create: `tests/server/dispatch.test.mjs`

**Interfaces:**
- Consumes: `callClaude` from `claude.mjs` (Task 3), `callOpenAICompatible` from `openaiCompatible.mjs` (Task 4).
- Produces: `runProviderAnalysis(providerRow, prompt): Promise<{ text: string, usedWebSearch: boolean }>`, consumed by `server/routes/analyze.mjs` (Task 7). `providerRow` is a raw `llm_providers` row shape: `{ provider_type, base_url, api_key, model, ... }`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/dispatch.test.mjs`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';
import { callClaude } from '../../server/providers/claude.mjs';
import { callOpenAICompatible } from '../../server/providers/openaiCompatible.mjs';

vi.mock('../../server/providers/claude.mjs', () => ({
  callClaude: vi.fn(),
}));
vi.mock('../../server/providers/openaiCompatible.mjs', () => ({
  callOpenAICompatible: vi.fn(),
}));

describe('runProviderAnalysis', () => {
  beforeEach(() => {
    callClaude.mockReset();
    callOpenAICompatible.mockReset();
  });

  it('dispatches claude provider_type to callClaude', async () => {
    callClaude.mockResolvedValue({ text: 'claude-result', usedWebSearch: true });

    const result = await runProviderAnalysis(
      { provider_type: 'claude', api_key: 'sk-ant', model: 'claude-sonnet-4-6', base_url: null },
      'prompt text'
    );

    expect(result).toEqual({ text: 'claude-result', usedWebSearch: true });
    expect(callClaude).toHaveBeenCalledWith({ apiKey: 'sk-ant', model: 'claude-sonnet-4-6', prompt: 'prompt text' });
    expect(callOpenAICompatible).not.toHaveBeenCalled();
  });

  it('dispatches openai provider_type to callOpenAICompatible with the default base URL when none is stored', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'openai-result', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'openai', api_key: 'sk-test', model: 'gpt-4o', base_url: null },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      prompt: 'prompt text',
    });
  });

  it('dispatches ollama provider_type to callOpenAICompatible with the default local base URL when none is stored', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'ollama-result', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'ollama', api_key: null, model: 'llama3.1', base_url: null },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      model: 'llama3.1',
      prompt: 'prompt text',
    });
  });

  it('dispatches custom provider_type to callOpenAICompatible using the stored base_url', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'custom-result', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'custom', api_key: 'k', model: 'm', base_url: 'https://my-router.example.com/v1' },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'https://my-router.example.com/v1',
      apiKey: 'k',
      model: 'm',
      prompt: 'prompt text',
    });
  });

  it('prefers a stored base_url over the default for openai/ollama when present', async () => {
    callOpenAICompatible.mockResolvedValue({ text: 'x', usedWebSearch: false });

    await runProviderAnalysis(
      { provider_type: 'ollama', api_key: null, model: 'llama3.1', base_url: 'http://192.168.1.50:11434/v1' },
      'prompt text'
    );

    expect(callOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.1.50:11434/v1' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- dispatch
```

Expected: FAIL — `Cannot find module '../../server/providers/dispatch.mjs'`.

- [ ] **Step 3: Implement `server/providers/dispatch.mjs`**

```js
import { callClaude } from './claude.mjs';
import { callOpenAICompatible } from './openaiCompatible.mjs';

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
};

export async function runProviderAnalysis(providerRow, prompt) {
  if (providerRow.provider_type === 'claude') {
    return callClaude({ apiKey: providerRow.api_key, model: providerRow.model, prompt });
  }

  const baseUrl = providerRow.base_url || DEFAULT_BASE_URLS[providerRow.provider_type];
  return callOpenAICompatible({
    baseUrl,
    apiKey: providerRow.api_key,
    model: providerRow.model,
    prompt,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- dispatch
```

Expected: PASS — all 5 tests in `dispatch.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add server/providers/dispatch.mjs tests/server/dispatch.test.mjs
git commit -m "feat: add provider dispatch"
```

---

### Task 6: `llm-providers` CRUD + activate router

**Files:**
- Create: `server/routes/llmProviders.mjs`
- Create: `tests/server/llm-providers-routes.test.mjs`

**Interfaces:**
- Consumes: `ensureDefaultUser` (Task 2), `resetAndMigrate` test helper.
- Produces: `createLlmProvidersRouter(db, userId): express.Router`, consumed by `server/index.mjs` (Task 7).

- [ ] **Step 1: Write the failing test**

Create `tests/server/llm-providers-routes.test.mjs`:

```js
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

  it('deletes a provider', async () => {
    const created = await request(app)
      .post('/api/llm-providers')
      .send({ provider_type: 'ollama', label: 'To delete', base_url: 'http://localhost:11434/v1', model: 'llama3.1' });

    await request(app).delete(`/api/llm-providers/${created.body.id}`).expect(204);

    const list = await request(app).get('/api/llm-providers');
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- llm-providers-routes
```

Expected: FAIL — `Cannot find module '../../server/routes/llmProviders.mjs'`.

- [ ] **Step 3: Implement `server/routes/llmProviders.mjs`**

```js
import { Router } from 'express';

export function createLlmProvidersRouter(db, userId) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      'SELECT * FROM llm_providers WHERE user_id = $1 ORDER BY created_at',
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { provider_type, label, base_url, api_key, model } = req.body;
    const { rows } = await db.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, base_url, api_key, model)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, provider_type, label, base_url ?? null, api_key ?? null, model]
    );
    res.status(201).json(rows[0]);
  });

  router.put('/:id', async (req, res) => {
    const { provider_type, label, base_url, api_key, model } = req.body;
    const { rows } = await db.query(
      `UPDATE llm_providers
       SET provider_type = $1, label = $2, base_url = $3, api_key = $4, model = $5
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [provider_type, label, base_url ?? null, api_key ?? null, model, req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM llm_providers WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  router.post('/:id/activate', async (req, res) => {
    await db.query('UPDATE llm_providers SET is_active = false WHERE user_id = $1', [userId]);
    const { rows } = await db.query(
      'UPDATE llm_providers SET is_active = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- llm-providers-routes
```

Expected: PASS — all 5 tests in `llm-providers-routes.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add server/routes/llmProviders.mjs tests/server/llm-providers-routes.test.mjs
git commit -m "feat: add llm-providers CRUD and activate routes"
```

---

### Task 7: `/api/analyze` route + server assembly

**Files:**
- Create: `server/routes/analyze.mjs`
- Create: `server/index.mjs`
- Create: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Consumes: `runProviderAnalysis` (Task 5), `createLlmProvidersRouter` (Task 6), `ensureDefaultUser`/`getPool` (Task 2).
- Produces: `createAnalyzeRouter(db, userId): express.Router`; a runnable `server/index.mjs` entry point (`node server/index.mjs`).

- [ ] **Step 1: Write the failing test**

Create `tests/server/analyze-route.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createAnalyzeRouter } from '../../server/routes/analyze.mjs';
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
  app.use('/api/analyze', createAnalyzeRouter(client, userId));
  runProviderAnalysis.mockReset();
});

afterEach(async () => {
  await client.end();
});

describe('POST /api/analyze', () => {
  it('returns 400 when no provider is active', async () => {
    const res = await request(app).post('/api/analyze').send({ prompt: 'hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active provider/);
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });

  it('dispatches to the active provider and returns its result', async () => {
    const { rows } = await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true) RETURNING *`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: true });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: true });
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: rows[0].id, provider_type: 'claude' }),
      'analyze this'
    );
  });

  it('returns 502 when the provider call fails', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    runProviderAnalysis.mockRejectedValue(new Error('HTTP 500'));

    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('HTTP 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- analyze-route
```

Expected: FAIL — `Cannot find module '../../server/routes/analyze.mjs'`.

- [ ] **Step 3: Implement `server/routes/analyze.mjs`**

```js
import { Router } from 'express';
import { runProviderAnalysis } from '../providers/dispatch.mjs';

export function createAnalyzeRouter(db, userId) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { prompt } = req.body;
    const { rows } = await db.query(
      'SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active provider configured' });
    }

    try {
      const result = await runProviderAnalysis(rows[0], prompt);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- analyze-route
```

Expected: PASS — all 3 tests in `analyze-route.test.mjs` green.

- [ ] **Step 5: Implement `server/index.mjs`**

```js
import 'dotenv/config';
import express from 'express';
import { getPool } from './pool.mjs';
import { ensureDefaultUser } from './ensureDefaultUser.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const userId = await ensureDefaultUser(pool);

const app = express();
app.use(express.json());
app.use('/api/llm-providers', createLlmProvidersRouter(pool, userId));
app.use('/api/analyze', createAnalyzeRouter(pool, userId));

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/analyze.mjs server/index.mjs tests/server/analyze-route.test.mjs
git commit -m "feat: add analyze route and server entry point"
```

---

### Task 8: Vite proxy, npm script, start.sh

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json` (add `"server"` script)
- Modify: `start.sh`

**Interfaces:**
- Consumes: `server/index.mjs` (Task 7), listening on `SERVER_PORT` (default `8787`).
- Produces: a working `./start.sh` that boots both the backend and the Vite dev server, and a `/api/*` proxy so the browser can reach the backend same-origin.

- [ ] **Step 1: Replace the Anthropic-specific proxy with a general `/api` proxy**

Modify `vite.config.ts` — replace the entire file:

```ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 2: Add the `server` npm script**

Modify `package.json` — in `"scripts"`, add `"server": "node server/index.mjs"` alongside the existing scripts:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "migrate": "node db/migrate.mjs",
  "server": "node server/index.mjs",
  "test": "vitest run"
},
```

- [ ] **Step 3: Update `start.sh` to boot both processes**

Replace `start.sh` entirely:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

npm run server &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

npm run dev
```

- [ ] **Step 4: Verify the server boots and responds**

Make sure Postgres is running and migrations are applied (`npm run migrate`), then:

```bash
npm run server &
sleep 1
curl -s http://localhost:8787/api/llm-providers
kill %1
```

Expected: `curl` prints `[]` (an empty JSON array — no providers configured yet), confirming the server started, connected to Postgres, and the default user/route wiring works end-to-end.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts package.json start.sh
git commit -m "feat: wire Vite proxy and start script to the API server"
```

---

### Task 9: Frontend API client

**Files:**
- Create: `src/api/llmProviders.ts`

**Interfaces:**
- Produces: `ProviderType`, `LlmProvider`, `LlmProviderInput` types; `listProviders`, `createProvider`, `updateProvider`, `deleteProvider`, `activateProvider`, `analyze` functions — all consumed by `src/App.tsx` (Task 10).

- [ ] **Step 1: Implement `src/api/llmProviders.ts`**

```ts
export type ProviderType = 'ollama' | 'openai' | 'claude' | 'custom';

export type LlmProvider = {
  id: number;
  provider_type: ProviderType;
  label: string;
  base_url: string | null;
  api_key: string | null;
  model: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LlmProviderInput = {
  provider_type: ProviderType;
  label: string;
  base_url?: string | null;
  api_key?: string | null;
  model: string;
};

async function parseJsonOrThrow(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function listProviders(): Promise<LlmProvider[]> {
  const response = await fetch('/api/llm-providers');
  return parseJsonOrThrow(response);
}

export async function createProvider(input: LlmProviderInput): Promise<LlmProvider> {
  const response = await fetch('/api/llm-providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateProvider(id: number, input: LlmProviderInput): Promise<LlmProvider> {
  const response = await fetch(`/api/llm-providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function deleteProvider(id: number): Promise<void> {
  const response = await fetch(`/api/llm-providers/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function activateProvider(id: number): Promise<LlmProvider> {
  const response = await fetch(`/api/llm-providers/${id}/activate`, { method: 'POST' });
  return parseJsonOrThrow(response);
}

export async function analyzeViaBackend(prompt: string): Promise<{ text: string; usedWebSearch: boolean }> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return parseJsonOrThrow(response);
}
```

Note: the last export is named `analyzeViaBackend`, not `analyze` — `src/App.tsx` already has a local function named `analyze()` (the click handler for the AI Analyst tab), and this avoids a naming collision at the import site in Task 10.

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no new type errors introduced by this file (pre-existing errors, if any, are unrelated to this change — this file has no dependents yet, so it cannot introduce runtime issues at this point).

- [ ] **Step 3: Commit**

```bash
git add src/api/llmProviders.ts
git commit -m "feat: add frontend API client for llm-providers and analyze"
```

---

### Task 10: Settings tab UI + Analyze rewire

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: everything from `src/api/llmProviders.ts` (Task 9).
- Produces: the user-visible Settings tab; the rewired `analyze()` that calls the backend instead of Anthropic directly. Nothing later depends on this task.

- [ ] **Step 1: Add the import**

At the top of `src/App.tsx`, after the existing `import { useEffect, useMemo, useState } from 'preact/hooks';` line, add:

```tsx
import {
  activateProvider,
  analyzeViaBackend,
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
  type LlmProvider,
  type LlmProviderInput,
  type ProviderType,
} from './api/llmProviders';
```

- [ ] **Step 2: Extend `TabKey` and remove key-related state fields**

Replace:

```tsx
type TabKey = 'home' | 'market' | 'calc' | 'target' | 'scenarios' | 'ai' | 'dca' | 'watch';
```

with:

```tsx
type TabKey = 'home' | 'market' | 'calc' | 'target' | 'scenarios' | 'ai' | 'dca' | 'watch' | 'settings';
```

In the `AppState` type, remove these three lines:

```tsx
  aiKey: string;
  aiLevel: 'beginner' | 'expert';
  aiRemember: boolean;
```

and replace with just:

```tsx
  aiLevel: 'beginner' | 'expert';
```

Update the `ai` field's type in `AppState` from:

```tsx
  ai: { loading: boolean; error: string | null; data: AIResult | null; at: string | null; applied: boolean };
```

to:

```tsx
  ai: { loading: boolean; error: string | null; data: AIResult | null; at: string | null; applied: boolean; usedWebSearch: boolean; providerLabel: string | null };
```

- [ ] **Step 3: Update `defaultState` and remove `KEY_KEY`**

Replace:

```tsx
  aiKey: '',
  aiLevel: 'beginner',
  aiRemember: false,
  ai: { loading: false, error: null, data: null, at: null, applied: false },
```

with:

```tsx
  aiLevel: 'beginner',
  ai: { loading: false, error: null, data: null, at: null, applied: false, usedWebSearch: false, providerLabel: null },
```

Remove this line entirely:

```tsx
const KEY_KEY = 'ghc_key';
```

- [ ] **Step 4: Remove `extractTextFromPayload` (now dead code) and key persistence in `loadState`**

Remove the entire `extractTextFromPayload` function (it was only used to parse Anthropic's raw content blocks, which now happens server-side in `server/providers/claude.mjs`):

```tsx
function extractTextFromPayload(payload: unknown): string[] {
  if (typeof payload === 'string') return [payload];
  if (Array.isArray(payload)) return payload.flatMap((item) => extractTextFromPayload(item));
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, any>;
    if (typeof record.text === 'string') return [record.text];
    if (typeof record.content === 'string') return [record.content];
    if (Array.isArray(record.content)) return record.content.flatMap((item) => extractTextFromPayload(item));
    if (Array.isArray(record.parts)) return record.parts.flatMap((item) => extractTextFromPayload(item));
    return Object.values(record).flatMap((value) => extractTextFromPayload(value));
  }
  return [];
}
```

In `loadState`, replace:

```tsx
    const aiKey = window.localStorage.getItem(KEY_KEY) || '';
    const aiLevel = (window.localStorage.getItem(LEVEL_KEY) as AppState['aiLevel'] | null) || 'beginner';
    return {
      ...defaultState,
      ...saved,
      monitors: Array.isArray(monitors) && monitors.length ? monitors : DEFAULT_MONITORS.map((m) => ({ ...m })),
      aiKey,
      aiLevel,
      aiRemember: Boolean(aiKey),
    };
```

with:

```tsx
    const aiLevel = (window.localStorage.getItem(LEVEL_KEY) as AppState['aiLevel'] | null) || 'beginner';
    return {
      ...defaultState,
      ...saved,
      monitors: Array.isArray(monitors) && monitors.length ? monitors : DEFAULT_MONITORS.map((m) => ({ ...m })),
      aiLevel,
    };
```

- [ ] **Step 5: Remove key persistence in the save `useEffect`**

Replace:

```tsx
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(MONITORS_KEY, JSON.stringify(state.monitors));
    if (state.aiRemember && state.aiKey) window.localStorage.setItem(KEY_KEY, state.aiKey);
    else window.localStorage.removeItem(KEY_KEY);
    window.localStorage.setItem(LEVEL_KEY, state.aiLevel);
  }, [state]);
```

with:

```tsx
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(MONITORS_KEY, JSON.stringify(state.monitors));
    window.localStorage.setItem(LEVEL_KEY, state.aiLevel);
  }, [state]);
```

- [ ] **Step 6: Add provider list state and CRUD handlers**

Immediately after the line `const [activeTab, setActiveTab] = useState<TabKey>('home');`, add:

```tsx
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerForm, setProviderForm] = useState<LlmProviderInput & { id: number | null }>({
    id: null,
    provider_type: 'ollama',
    label: '',
    base_url: 'http://localhost:11434/v1',
    api_key: '',
    model: '',
  });

  const refreshProviders = () => {
    listProviders().then(setProviders).catch(() => {});
  };

  useEffect(() => {
    refreshProviders();
  }, []);

  const resetProviderForm = () => {
    setProviderForm({ id: null, provider_type: 'ollama', label: '', base_url: 'http://localhost:11434/v1', api_key: '', model: '' });
  };

  const editProvider = (provider: LlmProvider) => {
    setProviderForm({
      id: provider.id,
      provider_type: provider.provider_type,
      label: provider.label,
      base_url: provider.base_url ?? '',
      api_key: provider.api_key ?? '',
      model: provider.model,
    });
  };

  const saveProvider = async () => {
    const input: LlmProviderInput = {
      provider_type: providerForm.provider_type,
      label: providerForm.label,
      base_url: providerForm.base_url || null,
      api_key: providerForm.api_key || null,
      model: providerForm.model,
    };
    if (providerForm.id === null) {
      await createProvider(input);
    } else {
      await updateProvider(providerForm.id, input);
    }
    resetProviderForm();
    refreshProviders();
  };

  const removeProvider = async (id: number) => {
    await deleteProvider(id);
    refreshProviders();
  };

  const activate = async (id: number) => {
    await activateProvider(id);
    refreshProviders();
  };

  const activeProvider = providers.find((p) => p.is_active) || null;
  const providerTypeLabel = (type: ProviderType) =>
    ({ ollama: t.settingsTypeOllama, openai: t.settingsTypeOpenAI, claude: t.settingsTypeClaude, custom: t.settingsTypeCustom }[type]);
```

- [ ] **Step 7: Rewrite `analyze()` to call the backend**

Replace the entire `analyze` function (from `const analyze = async () => {` through its closing `};`, i.e. everything currently between the `buildFallbackAnalysis` function and the `return (` that starts the JSX) with:

```tsx
  const analyze = async () => {
    if (!activeProvider) {
      setState((prev) => ({
        ...prev,
        ai: { ...prev.ai, loading: false, error: state.lang === 'ar' ? 'محتاج تفعّل مزوّد في الإعدادات الأول' : 'Activate a provider in Settings first' },
      }));
      return;
    }
    setState((prev) => ({ ...prev, ai: { ...prev.ai, loading: true, error: null, data: prev.ai.data, at: prev.ai.at, applied: false } }));
    const weightedTarget = SCEN_META.reduce((sum, scenario) => sum + (state.weights[scenario.key] / 100) * ((scenario.lo + scenario.hi) / 2), 0);
    const watch = state.monitors.map((monitor) => `${state.lang === 'ar' ? monitor.ar : monitor.en}=${['supportive', 'watch', 'risk'][monitor.sig]}`).join(', ');
    const prompt = `You are a senior precious-metals strategist advising a Cairo-based CIO. LIVE COCKPIT STATE - XAU/USD: ${state.spot}; USD/EGP: ${state.egp}; weights: ${state.weights.deesc}/${state.weights.base}/${state.weights.stag}; weighted target: ${Math.round(weightedTarget)}; watchlist: ${watch}. Respond with ONLY JSON. ${state.aiLevel === 'beginner' ? 'Use simple everyday language.' : 'Be direct and specific.'}`;

    try {
      const { text, usedWebSearch } = await analyzeViaBackend(prompt);
      const fallback = buildFallbackAnalysis(weightedTarget);
      const parsedPayload = tryParseJson(text);
      const parsed = parsedPayload
        ? normalizeAIResult(parsedPayload, fallback)
        : normalizeAIResult(
            {
              one_liner: text
                ? (state.lang === 'ar' ? `ملخص من الرد: ${text.slice(0, 180)}` : `Summary from the model reply: ${text.slice(0, 180)}`)
                : fallback.one_liner,
              trends: text ? [text.slice(0, 320)] : fallback.trends,
              suggested_weights: fallback.suggested_weights,
              weights_reasoning: state.lang === 'ar' ? 'تمت صياغة هذا التقرير من النص المجاني الذي أعاده المحلل.' : 'This report was derived from the free-text reply returned by the analyst.',
              tranche2: fallback.tranche2,
              egp_read: fallback.egp_read,
            },
            fallback
          );
      setState((prev) => ({
        ...prev,
        ai: {
          loading: false,
          error: null,
          data: parsed,
          at: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          applied: false,
          usedWebSearch,
          providerLabel: `${activeProvider.label} · ${activeProvider.model}`,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'analysis failed';
      const fallback = buildFallbackAnalysis(weightedTarget);
      const friendlyMessage = message.includes('No active provider')
        ? (state.lang === 'ar' ? 'محتاج تفعّل مزوّد في الإعدادات الأول' : 'Activate a provider in Settings first')
        : message.includes('Failed to fetch') || message.includes('fetch')
          ? (state.lang === 'ar'
            ? 'تم تشغيل تحليل بديل محلي بسبب عدم الوصول إلى خدمة التحليل المباشر.'
            : 'A local fallback analysis is being used because the live service could not be reached.')
          : message.includes('HTTP 500') || message.includes('HTTP 5')
            ? (state.lang === 'ar'
              ? 'الخادم أرجع خطأ داخلي (HTTP 500). حاول إعادة المحاولة بعد لحظة.'
              : 'Server returned an internal error (HTTP 500). Try again later.')
            : message;
      setState((prev) => ({
        ...prev,
        ai: {
          loading: false,
          error: friendlyMessage,
          data: fallback,
          at: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          applied: false,
          usedWebSearch: false,
          providerLabel: null,
        },
      }));
    }
  };
```

- [ ] **Step 8: Add the Settings tab button**

In the tab bar array, replace:

```tsx
              { key: 'watch' as const, label: t.watchTab },
            ].map((tab) => (
```

with:

```tsx
              { key: 'watch' as const, label: t.watchTab },
              { key: 'settings' as const, label: t.settingsTab },
            ].map((tab) => (
```

- [ ] **Step 9: Remove the inline API-key row from the AI Analyst tab**

Replace:

```tsx
            <div className="panel ai-panel" style={{ marginTop: 0 }}>
              <div className="ai-keyrow">
                <input type="password" value={state.aiKey} placeholder={t.aiKeyPh} onInput={(event) => setState((prev) => ({ ...prev, aiKey: (event.target as HTMLInputElement).value }))} />
                <label><input type="checkbox" checked={state.aiRemember} onChange={(event) => setState((prev) => ({ ...prev, aiRemember: (event.target as HTMLInputElement).checked }))} /> {t.aiRemember}</label>
              </div>
              <div className="lvlrow">
```

with:

```tsx
            <div className="panel ai-panel" style={{ marginTop: 0 }}>
              <div className="ai-providerline">
                {t.aiUsingProvider}: {activeProvider ? `${activeProvider.label} (${providerTypeLabel(activeProvider.provider_type)})` : t.aiNoProvider}
              </div>
              <div className="lvlrow">
```

- [ ] **Step 10: Fix the hardcoded footer meta line**

Replace:

```tsx
                  <div className="ai-meta">{state.ai.at || ''} · claude-sonnet-4-6 + web search · {t.aiDisc}</div>
```

with:

```tsx
                  <div className="ai-meta">{state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}</div>
```

- [ ] **Step 11: Add the Settings section**

Immediately before the closing `<div className="foot">{t.foot}</div>` line (i.e. right after the `watch` tab's closing `</div>`), add:

```tsx
          <div className={`section-wrap ${activeTab === 'settings' ? 'active' : ''}`}>
            <div className="sechead"><div className="lbl">{t.settingsHeading}</div></div>

            {providers.length === 0 ? <div className="settings-empty">{t.settingsEmpty}</div> : null}

            <div className="settings-list">
              {providers.map((provider) => (
                <div className={`panel settings-card ${provider.is_active ? 'active' : ''}`}>
                  <div className="settings-card-top">
                    <div>
                      <div className="settings-card-label">{provider.label}</div>
                      <div className="settings-card-meta">{providerTypeLabel(provider.provider_type)} · {provider.model}</div>
                    </div>
                    {provider.is_active ? <span className="badge">{t.settingsActiveBadge}</span> : null}
                  </div>
                  <div className="settings-actions">
                    {!provider.is_active ? <button onClick={() => void activate(provider.id)}>{t.settingsActivateBtn}</button> : null}
                    <button onClick={() => editProvider(provider)}>{t.settingsEditBtn}</button>
                    <button onClick={() => void removeProvider(provider.id)}>{t.settingsDeleteBtn}</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="panel settings-form">
              <div className="sechead"><div className="lbl">{t.settingsAddHeading}</div></div>

              <div className="settings-field">
                <div className="lbl">{t.settingsTypeLabel}</div>
                <select
                  value={providerForm.provider_type}
                  onChange={(event) => setProviderForm((prev) => ({ ...prev, provider_type: (event.target as HTMLSelectElement).value as ProviderType }))}
                >
                  <option value="ollama">{t.settingsTypeOllama}</option>
                  <option value="openai">{t.settingsTypeOpenAI}</option>
                  <option value="claude">{t.settingsTypeClaude}</option>
                  <option value="custom">{t.settingsTypeCustom}</option>
                </select>
              </div>

              <div className="settings-field">
                <div className="lbl">{t.settingsLabelLabel}</div>
                <input type="text" value={providerForm.label} onInput={(event) => setProviderForm((prev) => ({ ...prev, label: (event.target as HTMLInputElement).value }))} />
              </div>

              {providerForm.provider_type === 'ollama' || providerForm.provider_type === 'custom' ? (
                <div className="settings-field">
                  <div className="lbl">{t.settingsBaseUrlLabel}</div>
                  <input type="text" value={providerForm.base_url ?? ''} onInput={(event) => setProviderForm((prev) => ({ ...prev, base_url: (event.target as HTMLInputElement).value }))} />
                </div>
              ) : null}

              {providerForm.provider_type !== 'ollama' ? (
                <div className="settings-field">
                  <div className="lbl">{t.settingsApiKeyLabel}</div>
                  <input type="password" value={providerForm.api_key ?? ''} onInput={(event) => setProviderForm((prev) => ({ ...prev, api_key: (event.target as HTMLInputElement).value }))} />
                </div>
              ) : null}

              <div className="settings-field">
                <div className="lbl">{t.settingsModelLabel}</div>
                <input type="text" value={providerForm.model} onInput={(event) => setProviderForm((prev) => ({ ...prev, model: (event.target as HTMLInputElement).value }))} />
              </div>

              <div className="settings-actions">
                <button className="ai-go" onClick={() => void saveProvider()}>{t.settingsSaveBtn}</button>
                {providerForm.id !== null ? <button onClick={resetProviderForm}>{t.settingsCancelBtn}</button> : null}
              </div>
            </div>
          </div>
```

- [ ] **Step 12: Add translation keys**

In `T.ar`, on the same physical line as the other tab labels (the line containing `watchTab: 'قائمة المراقبة',`), append before the trailing comma:

```
watchTab: 'قائمة المراقبة', settingsTab: 'الإعدادات',
```

On the same line as `aiDisc`/`expAiT`/`expAi` (the long line ending in `...foot: '...' },` is the *last* line of the `ar` object — instead add the new settings keys as their own new physical line inserted immediately before that final `foot`-containing line, so the object still parses correctly:

```
    aiUsingProvider: 'المزوّد المستخدم', aiNoProvider: 'مفيش مزوّد مُفعّل — روح الإعدادات', settingsHeading: 'إعدادات نموذج الذكاء الاصطناعي', settingsAddHeading: 'إضافة / تعديل مزوّد', settingsEmpty: 'لسه مفيش مزوّدين متضافين.', settingsTypeLabel: 'النوع', settingsLabelLabel: 'الاسم', settingsBaseUrlLabel: 'رابط الخادم', settingsApiKeyLabel: 'مفتاح API', settingsModelLabel: 'الموديل', settingsSaveBtn: 'حفظ', settingsCancelBtn: 'إلغاء', settingsActivateBtn: 'تفعيل', settingsActiveBadge: 'مُفعّل', settingsEditBtn: 'تعديل', settingsDeleteBtn: 'حذف', settingsTypeOllama: 'Ollama (محلي)', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'مخصص',
```

Concretely: find this line (the start of the `ar` object's tab-label line):

```tsx
    dir: 'rtl', langBtn: 'EN', eyebrow: 'خاص · مباشر', title: 'غرفة عمليات الذهب', homeTab: 'غرفة العمليات', marketTab: 'الأسعار المباشرة', calcTab: 'حاسبة الشراء بالأعيرة', targetTab: 'السعر المستهدف المرجّح', scenTab: 'سيناريوهات الأوزان', aiTab: 'المحلل الذكي', dcaTab: 'خطة الدخول التدريجي', watchTab: 'قائمة المراقبة',
```

and replace its trailing `watchTab: 'قائمة المراقبة',` with `watchTab: 'قائمة المراقبة', settingsTab: 'الإعدادات',`.

Then find the last line of the `ar` object (it ends with `foot: 'الإطار: جلسة مايو 2026. الأسعار من مصادر مجانية بدون مفاتيح. أداة تحليل شخصية — مش نصيحة استثمارية.' },`) and insert a new line directly before it containing the settings keys block quoted above (ending in a trailing comma so the object remains valid).

Do the equivalent for `T.en`: change `watchTab: 'Watchlist',` to `watchTab: 'Watchlist', settingsTab: 'Settings',`, and insert a new line before the `en` object's final `foot: 'Framework: ...'` line containing:

```
    aiUsingProvider: 'Using provider', aiNoProvider: 'No active provider — go to Settings', settingsHeading: 'AI Model Settings', settingsAddHeading: 'Add / Edit Provider', settingsEmpty: 'No providers configured yet.', settingsTypeLabel: 'Type', settingsLabelLabel: 'Label', settingsBaseUrlLabel: 'Base URL', settingsApiKeyLabel: 'API key', settingsModelLabel: 'Model', settingsSaveBtn: 'Save', settingsCancelBtn: 'Cancel', settingsActivateBtn: 'Set active', settingsActiveBadge: 'Active', settingsEditBtn: 'Edit', settingsDeleteBtn: 'Delete', settingsTypeOllama: 'Ollama (local)', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'Custom',
```

- [ ] **Step 13: Add settings CSS**

Append to the end of `src/styles.css`:

```css
.ai-providerline{font-size:12px;color:#555555;margin-bottom:14px;}
.settings-empty{font-size:13px;color:#777777;margin-top:16px;}
.settings-list{display:flex;flex-direction:column;gap:12px;margin-top:16px;}
.settings-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
.settings-card-label{font-weight:700;font-size:14px;color:#1a1a1a;}
.settings-card-meta{font-size:12px;color:#777777;margin-top:2px;}
.settings-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.settings-actions button{background:#ffffff;border:1px solid #dfe8dc;color:#555555;font-family:inherit;font-weight:700;font-size:12px;padding:8px 14px;cursor:pointer;border-radius:10px;}
.settings-form{margin-top:20px;}
.settings-field{margin-bottom:14px;}
.settings-field select{width:100%;background:transparent;border:none;border-bottom:1px solid #c4c4c4;color:#1a1a1a;font-family:inherit;font-size:14px;padding:6px 0;outline:none;}
```

- [ ] **Step 14: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 15: Manual smoke test**

```bash
npm run migrate
./start.sh
```

Open `http://localhost:3000` (or whatever port Vite reports). Confirm:
- A "Settings" tab appears in the tab bar.
- Adding an Ollama provider (label "Local", base URL `http://localhost:11434/v1`, model e.g. `llama3.1`) with no API key field shown succeeds and appears in the list.
- Clicking "Set active" marks it Active and deactivates any other provider.
- The AI Analyst tab no longer shows an API-key input, and instead shows "Using provider: Local (Ollama (local))" once one is active.
- Editing a provider pre-fills the form; deleting removes it from the list.

Stop the app with Ctrl+C (the `trap` in `start.sh` also stops the backend).

- [ ] **Step 16: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: add Settings tab and rewire AI analyst to use the active provider"
```

---

### Task 11: Full verification

**Files:**
- None created — this task verifies the accumulated work from Tasks 1–10.

**Interfaces:**
- Consumes: everything built in Tasks 1–10.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: PASS — every test file (db/llm-providers, server/ensure-default-user, server/claude-provider, server/openai-compatible-provider, server/dispatch, server/llm-providers-routes, server/analyze-route, plus all pre-existing db tests) green, no failures.

- [ ] **Step 2: Apply the new migration to the dev database**

```bash
npm run migrate
```

Expected output:

```
Applied 1 migration(s):
  - 0009_create_llm_providers.sql
```

- [ ] **Step 3: Verify the table exists**

```bash
psql gold_cockpit_dev -c "\d llm_providers"
```

Expected: column list matches the `llm_providers` schema from Task 1, including the `idx_llm_providers_one_active_per_user` partial unique index shown under "Indexes:".

- [ ] **Step 4: Verify re-running migrate is a no-op**

```bash
npm run migrate
```

Expected: `No pending migrations.`

- [ ] **Step 5: End-to-end smoke test**

```bash
./start.sh
```

Repeat the manual smoke test from Task 10 Step 15, this time also clicking "Analyze the market" in the AI Analyst tab against a real running Ollama instance (or note in your report if Ollama isn't installed locally and this step was skipped) to confirm a full round trip: Settings → active provider → `/api/analyze` → adapter → response rendered in the AI Analyst tab.

- [ ] **Step 6: Commit**

No files changed by this task (verification only) — nothing to commit.
