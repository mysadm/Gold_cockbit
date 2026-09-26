import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Hand-rolled to match the existing analystContract.mjs style (no schema-validator
// dependency in package.json). The .schema.json files remain the source of truth for
// shape/limits and are handed to providers' native structured-output modes; this
// validator enforces the same shape plus the cross-field business rules a JSON
// Schema cannot express (weight sum, EV-ID existence, matching prior weights, etc).
export const SCENARIO_KEYS = ['deesc', 'base', 'stag'];
export const STATUSES = ['material_change', 'no_material_change', 'insufficient_evidence'];
export const CONFIDENCES = ['low', 'medium', 'high'];
// Same action vocabulary as the v3 contract (shared/analystContract.mjs) — the
// "watch" language in PROMPT_V2 maps to the existing 'hold' value; the plan does
// not introduce new action words, only a new output shape.
export const ACTIONS = ['buy', 'hold', 'wait', 'reduce', 'review', 'insufficient_evidence'];
export const EV_ID_PATTERN = /^EV-\d{8}-\d{4}-\d{2}$/;
export const MAX_TOKENS = { standard: 600, personalized: 900 };

const schemaPath = (name) => fileURLToPath(new URL(`../schemas/${name}`, import.meta.url));
export const BASE_SCHEMA = JSON.parse(readFileSync(schemaPath('analyst_output.schema.json'), 'utf8'));
export const PERSONALIZED_SCHEMA = JSON.parse(readFileSync(schemaPath('analyst_output.personalized.schema.json'), 'utf8'));

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validateBase(output, { scenarioKeys = SCENARIO_KEYS, evidenceIds = [], tier = 'standard' } = {}) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!object(output)) return ['output must be a JSON object'];

  const allowed = ['status', 'confidence', 'headline', 'data_flags', 'evidence', 'scenario_weights', 'weight_changes', 'action', 'next_trigger', 'invalidation'];
  if (tier === 'personalized') allowed.push('dca');
  const extra = Object.keys(output).filter((k) => !allowed.includes(k));
  if (extra.length) fail(`unknown fields: ${extra.join(', ')}`);

  if (!STATUSES.includes(output.status)) fail('invalid status');
  if (!CONFIDENCES.includes(output.confidence)) fail('invalid confidence');
  if (!str(output.headline, 120)) fail('headline: nonempty string up to 120 characters required');

  if (!Array.isArray(output.data_flags) || output.data_flags.length > 5 || !output.data_flags.every((s) => str(s, 100))) {
    fail('data_flags must be an array of up to 5 short strings');
  }

  const known = new Set(evidenceIds);
  if (!Array.isArray(output.evidence) || output.evidence.length > 3) {
    fail('evidence must have 0–3 items');
  } else {
    for (const e of output.evidence) {
      if (!object(e) || Object.keys(e).some((k) => !['ev_id', 'implication'].includes(k))) fail('evidence item: unknown fields');
      if (!EV_ID_PATTERN.test(e?.ev_id) || !known.has(e?.ev_id)) fail(`evidence item: unknown EV-ID ${e?.ev_id ?? ''}`.trim());
      if (!str(e?.implication, 200)) fail('evidence item: implication must be a nonempty string up to 200 characters');
    }
  }

  // scenario_weights values are plain numbers keyed by the exact scenario keys — there is
  // no field anywhere in this schema for price bands, so a model has no way to alter them.
  const w = output.scenario_weights;
  const hasExactKeys = object(w) && Object.keys(w).length === scenarioKeys.length && scenarioKeys.every((k) => k in w);
  if (!hasExactKeys) {
    fail('scenario_weights must be keyed by exactly the snapshot scenario keys');
  } else if (!scenarioKeys.every((k) => finite(w[k]) && w[k] >= 0 && w[k] <= 100)) {
    fail('scenario_weights values must be numbers between 0 and 100');
  } else if (Math.abs(scenarioKeys.reduce((sum, k) => sum + w[k], 0) - 100) > 0.01) {
    fail('scenario_weights must sum to 100');
  }

  if (!Array.isArray(output.weight_changes) || output.weight_changes.length > scenarioKeys.length) {
    fail(`weight_changes must have 0–${scenarioKeys.length} items`);
  } else {
    for (const c of output.weight_changes) {
      if (!object(c) || Object.keys(c).some((k) => !['scenario', 'ev_ids', 'reason'].includes(k))) fail('weight change: unknown fields');
      if (!scenarioKeys.includes(c?.scenario)) fail('weight change: invalid scenario key');
      if (!Array.isArray(c?.ev_ids) || !c.ev_ids.length || !c.ev_ids.every((id) => known.has(id))) fail('weight change: needs at least one known EV-ID');
      if (!str(c?.reason, 200)) fail('weight change: reason must be a nonempty string up to 200 characters');
    }
  }

  if (!ACTIONS.includes(output.action)) fail('invalid action');
  if (!str(output.next_trigger, 200)) fail('next_trigger: nonempty string up to 200 characters required');
  if (!str(output.invalidation, 200)) fail('invalidation: nonempty string up to 200 characters required');

  return errors;
}

function validateDca(output) {
  const errors = [];
  const d = output.dca;
  if (!object(d)) {
    errors.push('dca required on the personalized tier');
  } else if (Object.keys(d).some((k) => !['status', 'note'].includes(k))) {
    errors.push('dca: unknown fields');
  } else {
    if (!['proceed', 'pause', 'not_applicable'].includes(d.status)) errors.push('dca: invalid status');
    if (!str(d.note, 200)) errors.push('dca: note must be a nonempty string up to 200 characters');
  }
  return errors;
}

export function validateAnalystOutput(output, { tier = 'standard', scenarioKeys, evidenceIds } = {}) {
  const errors = validateBase(output, { scenarioKeys, evidenceIds, tier });
  if (tier === 'personalized' && object(output)) errors.push(...validateDca(output));
  return { ok: errors.length === 0, errors };
}
