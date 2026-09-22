// The admin-editable analyst prompts: one for the shared standard analysis and one for the
// personalized analysis. The built-in text stays in code as the default; a saved copy in
// app_settings overrides it. Every save must be signed with the admin's password and must match
// a prompt test that passed on the same text (see routes/adminPrompts.mjs).
import { createHash } from 'node:crypto';
import { getSetting, setSetting } from './appSettings.mjs';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT, APP_RULES } from './prompts/goldMarketAnalyst.mjs';
import { MARKET_SCOPE, DEFAULT_OUTPUT_FORMAT } from './prompts/buildAnalysisPrompt.mjs';

export { APP_RULES };
export const KINDS = ['standard', 'personalized'];
export const PROMPTS_SETTING = 'analyst_prompts';
export const PROMPTS_TEST_SETTING = 'analyst_prompts_test';
export const MAX_PROMPT_LENGTH = 8000;
export const TEST_TTL_MS = 30 * 60 * 1000;

// The standard analysis is the shared policy plus the market-only paragraph, as one text.
export const DEFAULT_PROMPTS = {
  standard: `${GOLD_MARKET_ANALYST_SYSTEM_PROMPT}\n\n${MARKET_SCOPE.trimEnd()}`,
  personalized: GOLD_MARKET_ANALYST_SYSTEM_PROMPT,
};
export const DEFAULT_FORMAT = DEFAULT_OUTPUT_FORMAT;
const LABELS = { standard: 'Standard analysis prompt', personalized: 'Personalized analysis prompt' };

export const isKind = (kind) => KINDS.includes(kind);

// Returns the trimmed {text, format}, or throws an Error whose message is safe to show the admin.
export function normalizeDraft(kind, input) {
  const body = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const parts = [['text', LABELS[kind]], ['format', `${LABELS[kind]} output format`]];
  const draft = {};
  for (const [key, label] of parts) {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty`);
    if (value.length > MAX_PROMPT_LENGTH) throw new Error(`${label} must be at most ${MAX_PROMPT_LENGTH} characters`);
    draft[key] = value.trim();
  }
  return draft;
}

const hash = ({ text, format }) => createHash('sha256').update(JSON.stringify([text, format])).digest('hex');

function entry(kind, saved) {
  const valid = saved && typeof saved.text === 'string' && saved.text.trim();
  const hasFormat = valid && typeof saved.format === 'string' && saved.format.trim();
  return {
    text: valid ? saved.text : DEFAULT_PROMPTS[kind],
    format: hasFormat ? saved.format : DEFAULT_FORMAT,
    default: DEFAULT_PROMPTS[kind],
    defaultFormat: DEFAULT_FORMAT,
    customized: Boolean(valid),
    revision: valid && Number.isInteger(saved.revision) ? saved.revision : 0,
    updatedAt: valid ? saved.updated_at ?? null : null,
    updatedBy: valid ? saved.updated_by ?? null : null,
  };
}

export async function loadPrompts(db) {
  const saved = (await getSetting(db, PROMPTS_SETTING)) ?? {};
  return Object.fromEntries(KINDS.map((kind) => [kind, entry(kind, saved[kind])]));
}

// A saved prompt replaces the built-in policy, which is where the validator's rules live, so
// they are appended to whatever the admin wrote.
export const withAppRules = (text) => `${text.trim()}\n\n${APP_RULES}`;

// What the analyst runner needs. Nothing saved: only the built-in system text, so the built-in
// layout is used unchanged. Saved: the admin's text and output format.
export async function loadPromptConfig(db, kind) {
  const e = (await loadPrompts(db))[kind];
  return e.customized ? { system: withAppRules(e.text), format: e.format } : { system: e.text };
}

export async function savePrompt(db, kind, { text, format }, { by, now = () => new Date() }) {
  const saved = (await getSetting(db, PROMPTS_SETTING)) ?? {};
  const revision = entry(kind, saved[kind]).revision + 1;
  await setSetting(db, PROMPTS_SETTING, { ...saved, [kind]: { text, format, revision, updated_at: now().toISOString(), updated_by: by } });
}

export async function resetPrompt(db, kind) {
  const saved = (await getSetting(db, PROMPTS_SETTING)) ?? {};
  delete saved[kind];
  await setSetting(db, PROMPTS_SETTING, saved);
}

// One pending test result per prompt: testing another text replaces it, and a failed test clears it.
export async function recordTest(db, kind, draft, { passed, by, now = () => new Date() }) {
  if (!passed) return clearTest(db, kind);
  const tests = (await getSetting(db, PROMPTS_TEST_SETTING)) ?? {};
  await setSetting(db, PROMPTS_TEST_SETTING, { ...tests, [kind]: { hash: hash(draft), passed_at: now().toISOString(), by } });
}

export async function hasPassedTest(db, kind, draft, { now = () => new Date() } = {}) {
  const test = ((await getSetting(db, PROMPTS_TEST_SETTING)) ?? {})[kind];
  if (!test || test.hash !== hash(draft)) return false;
  const age = now().getTime() - Date.parse(test.passed_at);
  return Number.isFinite(age) && age >= 0 && age <= TEST_TTL_MS;
}

export async function clearTest(db, kind) {
  const tests = (await getSetting(db, PROMPTS_TEST_SETTING)) ?? {};
  delete tests[kind];
  await setSetting(db, PROMPTS_TEST_SETTING, tests);
}
