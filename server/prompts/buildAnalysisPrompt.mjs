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
export const MARKET_SCOPE = `STANDARD MARKET ANALYSIS: this is the market view shared by all users, not personal advice. Wallet, DCA and watchlist are absent by design: never list them under missing_inputs or assumptions, never let them drive the decision, and omit wallet/dca/watchlist reads. Judge only the market: global gold drivers, USD/EGP, the local Egyptian premium and the scenario weights. Pick the action for a generic Egyptian gold holder from the evidence; return insufficient_evidence only if the EVIDENCE_PACK truly lacks material evidence.
`;

// The output-format rules, with {LANG} standing for the answer language. Together with the JSON
// example this is the default "output format" text the admin can edit.
const FORMAT_RULES = `Write EVERY prose value in {LANG}. Only JSON keys and enum codes stay in English.
Allowed status: material_change|no_material_change|insufficient_evidence.
Action: buy|hold|wait|reduce|review|insufficient_evidence. Horizon: now|next_event|strategic.
Confidence and strength: low|medium|high. Scenario effect: deesc|base|stag|mixed|neutral.
Every changed weight needs {scenario,from,to,evidence_ids:["EV-..."]}; unchanged weights have no entry.
At most 3 evidence items and 3 strings each in assumptions/missing_inputs. Omit wallet/dca/watchlist reads when absent.
The explanation level (beginner or expert) changes wording only: apply the same evidence standard and decision rules in both.
Make sure suggested_weights are three whole numbers that add up to exactly 100 (copy the snapshot weights when unchanged), and never write a currency amount in reads.dca except current_installment_limit_egp.
No search tool is available. Zero supplied evidence requires insufficient_evidence.`;

export const DEFAULT_OUTPUT_FORMAT = `${FORMAT_RULES}

Respond with ONLY this JSON, filled with actual values (no code fences, nothing outside the object):
${JSON.stringify(OUTPUT_EXAMPLE, null, 1)}`;

// The top-level keys the app's validator requires; an edited output format must keep them.
export const REQUIRED_OUTPUT_KEYS = Object.keys(OUTPUT_EXAMPLE);

const languageName = (snapshot) => (snapshot.locale === 'ar' ? 'Egyptian Arabic (العربية المصرية)' : 'English');

// `marketScope` replaces the built-in market-only paragraph; an empty one omits it (the admin's
// standard prompt already contains that guidance). `format` is the admin's saved output format:
// it goes after the data, with {LANG} replaced by the answer language. Without it the built-in
// layout below is used unchanged.
export function buildAnalysisPrompt(snapshot, evidencePack, { marketScope = MARKET_SCOPE, format } = {}) {
  const scope = snapshot.analysis_scope === 'market' && marketScope.trim() ? `${marketScope.trimEnd()}\n` : '';
  const data = `DATA_SNAPSHOT\n${JSON.stringify(snapshot)}\nEVIDENCE_PACK\n${JSON.stringify(evidencePack)}`;
  if (typeof format === 'string' && format.trim()) {
    return `Analyze the data below and answer in the output format that follows it.\n${scope}${data}\n${format.trim().replaceAll('{LANG}', languageName(snapshot))}`;
  }
  return `Analyze the data below; return the demonstrated JSON shape with actual values.
${scope}${FORMAT_RULES.replaceAll('{LANG}', languageName(snapshot))}
${data}\nOUTPUT_SCHEMA\n${JSON.stringify(OUTPUT_EXAMPLE)}`;
}
