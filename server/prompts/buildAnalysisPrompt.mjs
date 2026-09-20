export const OUTPUT_EXAMPLE = {
  schema_version:'3',status:'material_change',
  primary_decision:{action:'wait',horizon:'now',headline:'Decision and reason',confidence:'medium',next_trigger:'Observable reassessment condition',invalidation:'What would reverse the decision'},
  evidence:[{evidence_id:'EV-001',scenario_effect:'mixed',strength:'medium',implication:'Evidence and consequence'}],
  suggested_weights:{deesc:35,base:45,stag:20},
  weight_changes:[],
  reads:{egp:'EGP implication',wallet:'Holding implication',dca:'Plan implication',watchlist:'Changed signals'},
  assumptions:[],missing_inputs:[],
};
// The shared standard analysis has no portfolio by design. Without this, the
// "one investor" system prompt reads the empty wallet/DCA as missing inputs and
// answers insufficient_evidence even when the evidence pack is rich.
const MARKET_SCOPE = `STANDARD MARKET ANALYSIS: this is the market view shared by all users, not personal advice. Wallet, DCA and watchlist are absent by design: never list them under missing_inputs or assumptions, never let them drive the decision, and omit wallet/dca/watchlist reads. Judge only the market: global gold drivers, USD/EGP, the local Egyptian premium and the scenario weights. Pick the action for a generic Egyptian gold holder from the evidence; return insufficient_evidence only if the EVIDENCE_PACK truly lacks material evidence.
`;

export function buildAnalysisPrompt(snapshot, evidencePack) {
  return `Analyze the data below; return the demonstrated JSON shape with actual values.
${snapshot.analysis_scope === 'market' ? MARKET_SCOPE : ''}Write EVERY prose value in ${snapshot.locale === 'ar' ? 'Egyptian Arabic (العربية المصرية)' : 'English'}. Only JSON keys and enum codes stay in English.
Allowed status: material_change|no_material_change|insufficient_evidence.
Action: buy|hold|wait|reduce|review|insufficient_evidence. Horizon: now|next_event|strategic.
Confidence and strength: low|medium|high. Scenario effect: deesc|base|stag|mixed|neutral.
Every changed weight needs {scenario,from,to,evidence_ids:["EV-..."]}; unchanged weights have no entry.
At most 3 evidence items and 3 strings each in assumptions/missing_inputs. Omit wallet/dca/watchlist reads when absent.
No search tool is available. Zero supplied evidence requires insufficient_evidence.
DATA_SNAPSHOT\n${JSON.stringify(snapshot)}\nEVIDENCE_PACK\n${JSON.stringify(evidencePack)}\nOUTPUT_SCHEMA\n${JSON.stringify(OUTPUT_EXAMPLE)}`;
}
