export function completionBudget(maxTokens, compact = false) {
  const configured = Number.isFinite(maxTokens) ? Math.trunc(maxTokens) : undefined;
  // V4's output is schema-shrunk well below the v3 compact floor (see
  // shared/analystOutputV4.mjs MAX_TOKENS), so its caller passes an explicit, measured cap that
  // must reach the provider as-is rather than being floored to 4096 — that floor exists only to
  // protect v3's larger free-form output from truncating.
  if (compact === 'v4') return Math.min(8192, Math.max(1, configured ?? 1400));
  // A full compact answer (JSON with evidence and reads, longer still in Arabic) needs
  // well over 2k tokens; a smaller cap truncates it and the run silently degrades to
  // the built-in "insufficient evidence" fallback. So a low configured value is floored.
  return compact ? Math.min(8192, Math.max(4096, configured ?? 4096)) : Math.max(configured || 0, 16000);
}

export function normalizeUsage(input, output) {
  return Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0
    ? { input_tokens: input, output_tokens: output } : null;
}
