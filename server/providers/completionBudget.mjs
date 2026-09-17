export function completionBudget(maxTokens, compact = false) {
  const configured = Number.isFinite(maxTokens) ? Math.trunc(maxTokens) : undefined;
  return compact ? Math.min(8192, Math.max(1024, configured ?? 4096)) : Math.max(configured || 0, 16000);
}

export function normalizeUsage(input, output) {
  return Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0
    ? { input_tokens: input, output_tokens: output } : null;
}
