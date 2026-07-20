const EXPECTED_KEYS = ['one_liner', 'trends', 'suggested_weights', 'weights_reasoning', 'tranche2', 'egp_read'];

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripCodeFences(text) {
  return text.replace(/```json|```/g, '').trim();
}

// Returns the parse state (open '{'/'[' stack, whether we're inside an
// unterminated string, and where that string started) immediately before
// `index`, ignoring bracket-like characters that appear inside string
// literals.
function scanStateBefore(text, index) {
  const stack = [];
  let inString = false;
  let escape = false;
  let stringStart = -1;
  for (let i = 0; i < index; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      stringStart = inString ? i : -1;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
  }
  return { stack, inString, stringStart };
}

// A dangling unterminated string is a KEY fragment (not a value) if the
// container it's directly inside is an object ('{') and the nearest
// non-whitespace character before it is '{' or ',' — i.e. it's positioned
// where JSON expects a key, not a value (which would instead be preceded by
// ':', '[', or ',' inside an array).
function isDanglingKey(text, stringStart, stack) {
  if (stack[stack.length - 1] !== '{') return false;
  let cursor = stringStart - 1;
  while (cursor >= 0 && /\s/.test(text[cursor])) cursor--;
  return cursor < 0 || text[cursor] === '{' || text[cursor] === ',';
}

function closingBracketsFor(stack) {
  return stack
    .slice()
    .reverse()
    .map((bracket) => (bracket === '{' ? '}' : ']'))
    .join('');
}

// Some models "finish the sentence" with trailing punctuation after already
// closing the JSON string, e.g. `"...حركة".\n  },` — a stray '.' sitting
// between a string's closing quote and the real delimiter (',', '}', ']').
// A bare '.' is never valid JSON in that position, so it's always safe to
// drop. The negative lookbehind avoids matching an escaped `\"` mid-string.
function stripStrayPunctuationAfterStrings(text) {
  return text.replace(/(?<!\\)"(\s*)\.(\s*)(?=[,}\]])/g, '"$1$2');
}

// Attempts to repair a single candidate substring (already sliced to start at
// the opening '{'). Returns a parsed object or null.
function repairCandidate(rawCandidate) {
  let candidate = stripStrayPunctuationAfterStrings(rawCandidate);

  const direct = tryParse(candidate);
  if (direct) return direct;

  // Schema-aware repair for the specific failure mode local/weaker models
  // produce: forgetting to close an array or object before starting the next
  // known top-level key. Generic JSON repair can't fix this (it doesn't know
  // which key is supposed to be a top-level sibling), but we do, because we
  // know the exact schema this analysis prompt asks for.
  for (const key of EXPECTED_KEYS.slice(1)) {
    const marker = `"${key}":`;
    const idx = candidate.indexOf(marker);
    if (idx < 0) continue;

    const openStack = scanStateBefore(candidate, idx).stack;
    if (openStack.length <= 1) continue; // only the root object open — nothing to close

    const closers = closingBracketsFor(openStack.slice(1));

    let cursor = idx - 1;
    while (cursor >= 0 && /\s/.test(candidate[cursor])) cursor--;

    if (candidate[cursor] === ',') {
      candidate = candidate.slice(0, cursor) + closers + candidate.slice(cursor);
    } else {
      candidate = candidate.slice(0, idx) + closers + ', ' + candidate.slice(idx);
    }
  }

  // Close anything still open at the very end (an unterminated string, then
  // any unterminated arrays/objects) — covers responses cut off mid-value.
  let trailingState = scanStateBefore(candidate, candidate.length);
  if (trailingState.inString) {
    if (isDanglingKey(candidate, trailingState.stringStart, trailingState.stack)) {
      // Truncated mid-key-name (e.g. `{"deesc...` cut off before any ":").
      // Closing this as a bogus lone-string key would still be invalid JSON
      // (`{ "d" }` has no value) — drop the incomplete key instead, plus any
      // trailing comma left dangling before it.
      let cursor = trailingState.stringStart - 1;
      while (cursor >= 0 && /\s/.test(candidate[cursor])) cursor--;
      const cutAt = candidate[cursor] === ',' ? cursor : trailingState.stringStart;
      candidate = candidate.slice(0, cutAt);
    } else {
      candidate += '"';
    }
    trailingState = scanStateBefore(candidate, candidate.length);
  }
  if (trailingState.stack.length > 0) {
    candidate += closingBracketsFor(trailingState.stack);
  }

  return tryParse(candidate);
}

function countPresentKeys(parsed) {
  return EXPECTED_KEYS.filter((key) => key in parsed).length;
}

export function repairAnalysisJson(rawText) {
  const cleaned = stripCodeFences(rawText);
  const start = cleaned.indexOf('{');
  if (start < 0) return null;

  // Two candidate end-points, tried independently: the last '}' in the text
  // (handles trailing commentary/fences after an otherwise-complete object),
  // and the full remainder of the string (handles text truncated partway
  // through, where the "last }" is actually just an inner nested object's
  // closer, not the real end). Whichever repairs to the most complete result
  // wins.
  const lastBraceIdx = cleaned.lastIndexOf('}');
  const candidates = [];
  if (lastBraceIdx > start) candidates.push(cleaned.slice(start, lastBraceIdx + 1));
  candidates.push(cleaned.slice(start));

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const result = repairCandidate(candidate);
    if (!result || typeof result !== 'object') continue;
    const score = countPresentKeys(result);
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return best;
}
