import { FIELDS } from '../../shared/analystOutputV4.mjs';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Cuts `str` to at most `max` characters, landing on a sentence or word boundary — never
// mid-word, and works the same for Arabic (space-delimited, like English) as for English. Returns
// null when there is no safe boundary to cut at (e.g. one token longer than `max`), so the caller
// can leave the field to a real retry instead of producing a mangled string.
export function truncateAtBoundary(str, max) {
  if (typeof str !== 'string' || str.length <= max) return str;
  const slice = str.slice(0, max);
  const enders = ['. ', '! ', '? ', '؟ ', '۔ '];
  let sentenceEnd = -1;
  for (const e of enders) sentenceEnd = Math.max(sentenceEnd, slice.lastIndexOf(e));
  if (sentenceEnd > 0) return slice.slice(0, sentenceEnd + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) return slice.slice(0, lastSpace).trim();
  return null;
}

function truncateField(out, key, max, fields) {
  if (typeof out[key] !== 'string' || out[key].length <= max) return;
  const t = truncateAtBoundary(out[key], max);
  if (t && t.trim().length > 0) { out[key] = t; fields.push(`${key} (truncated)`); }
}

function stripUnknown(obj, allowed) {
  let changed = false;
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) { delete obj[k]; changed = true; }
  }
  return changed;
}

// Deterministic, in-code fixes for formatting-only problems (length, item count, empty entries,
// unknown fields) — GOLD_COCKPIT_SPEED_PLAN.md's "formatting repair, before any retry": these
// never require a model call. Semantic problems (weight math, unknown EV-ID, invalid enum, a DCA
// amount over the limit, a truncated completion) are left untouched here; validatedAnalysis.mjs
// re-validates the result afterward and only retries on whatever remains. `parsed` is not
// mutated; a cloned, possibly-repaired copy is always returned.
export function repairFormatting(parsed, { tier = 'standard', scenarioKeys = ['deesc', 'base', 'stag'] } = {}) {
  if (!object(parsed)) return { repaired: false, fields: [], output: parsed };
  const fields = [];
  const out = structuredClone(parsed);

  const allowedTop = tier === 'personalized' ? [...FIELDS.response, 'dca_read'] : FIELDS.response;
  if (stripUnknown(out, allowedTop)) fields.push('top level (unknown field)');

  truncateField(out, 'headline', 120, fields);

  if (Array.isArray(out.data_flags)) {
    const before = out.data_flags.length;
    let flags = out.data_flags.filter((s) => typeof s === 'string' && s.trim().length > 0);
    if (flags.length !== before) fields.push('data_flags (dropped empty)');
    let truncatedAny = false;
    flags = flags.map((s) => {
      if (s.length <= 100) return s;
      const t = truncateAtBoundary(s, 100);
      if (t && t.trim().length > 0) { truncatedAny = true; return t; }
      return s;
    });
    if (truncatedAny) fields.push('data_flags (item truncated)');
    if (flags.length > 5) { flags = flags.slice(0, 5); fields.push('data_flags (capped to 5)'); }
    out.data_flags = flags;
  }

  if (Array.isArray(out.evidence)) {
    let ev = out.evidence;
    if (ev.length > 3) { ev = ev.slice(0, 3); fields.push('evidence (capped to 3)'); }
    ev = ev.map((item) => {
      if (!object(item)) return item;
      const clean = structuredClone(item);
      if (stripUnknown(clean, FIELDS.evidence_item)) fields.push('evidence item (unknown field)');
      truncateField(clean, 'implication', 200, fields);
      return clean;
    });
    out.evidence = ev;
  }

  if (Array.isArray(out.weight_changes)) {
    let wc = out.weight_changes;
    const maxWc = scenarioKeys.length;
    if (wc.length > maxWc) { wc = wc.slice(0, maxWc); fields.push(`weight_changes (capped to ${maxWc})`); }
    wc = wc.map((item) => {
      if (!object(item)) return item;
      const clean = structuredClone(item);
      if (stripUnknown(clean, FIELDS.weight_change)) fields.push('weight change (unknown field)');
      truncateField(clean, 'reason', 200, fields);
      return clean;
    });
    out.weight_changes = wc;
  }

  truncateField(out, 'next_trigger', 200, fields);
  truncateField(out, 'invalidation', 200, fields);

  if (tier === 'personalized' && object(out.dca_read)) {
    const d = structuredClone(out.dca_read);
    if (stripUnknown(d, FIELDS.dca_read)) fields.push('dca_read (unknown field)');
    truncateField(d, 'text', 200, fields);
    if (Array.isArray(d.ev_ids) && d.ev_ids.length > 3) { d.ev_ids = d.ev_ids.slice(0, 3); fields.push('dca_read.ev_ids (capped to 3)'); }
    out.dca_read = d;
  }

  return { repaired: fields.length > 0, fields, output: out };
}
