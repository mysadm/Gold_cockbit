// Builds the user turn for the V4 pipeline: DATA_SNAPSHOT (with the Phase 2 precomputes merged
// in, and the DCA block trimmed to the active mode's fields) plus EVIDENCE_PACK. No admin-editable
// format text — PROMPT_V2's system prompt plus the jsonSchema call enforce the output shape.
function filterDca(dca) {
  if (!dca) return null;
  const { mode, current_installment_limit_egp } = dca;
  const active = mode === 'recurring'
    ? { monthly_investment_egp: dca.monthly_investment_egp }
    : { total_investment_egp: dca.total_investment_egp, tranche_split_pct: dca.tranche_split_pct };
  return { mode, current_installment_limit_egp, ...active };
}

export function buildAnalysisPromptV4(snapshot, evidencePack, precomputed) {
  const dataSnapshot = { ...snapshot, ...precomputed, dca: filterDca(snapshot.dca) };
  return `DATA_SNAPSHOT\n${JSON.stringify(dataSnapshot)}\nEVIDENCE_PACK\n${JSON.stringify(evidencePack)}`;
}
