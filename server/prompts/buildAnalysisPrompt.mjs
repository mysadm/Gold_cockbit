export const OUTPUT_EXAMPLE = {
  schema_version:'3',status:'material_change',
  primary_decision:{action:'wait',horizon:'now',headline:'Decision and reason',confidence:'medium',next_trigger:'Observable reassessment condition',invalidation:'What would reverse the decision'},
  evidence:[{evidence_id:'EV-001',scenario_effect:'mixed',strength:'medium',implication:'Evidence and consequence'}],
  suggested_weights:{deesc:35,base:45,stag:20},
  weight_changes:[],
  reads:{egp:'EGP implication',wallet:'Holding implication',dca:'Plan implication',watchlist:'Changed signals'},
  assumptions:[],missing_inputs:[],
};
export function buildAnalysisPrompt(snapshot, evidencePack) {
  return `Analyze the data below; return the demonstrated JSON shape with actual values.
Write EVERY prose value in ${snapshot.locale === 'ar' ? 'Egyptian Arabic (العربية المصرية)' : 'English'}. Only JSON keys and enum codes stay in English.
Allowed status: material_change|no_material_change|insufficient_evidence.
Action: buy|hold|wait|reduce|review|insufficient_evidence. Horizon: now|next_event|strategic.
Confidence and strength: low|medium|high. Scenario effect: deesc|base|stag|mixed|neutral.
Every changed weight needs {scenario,from,to,evidence_ids:["EV-..."]}; unchanged weights have no entry.
At most 3 evidence items and 3 strings each in assumptions/missing_inputs. Omit wallet/dca/watchlist reads when absent.
No search tool is available. Zero supplied evidence requires insufficient_evidence.
DATA_SNAPSHOT\n${JSON.stringify(snapshot)}\nEVIDENCE_PACK\n${JSON.stringify(evidencePack)}\nOUTPUT_SCHEMA\n${JSON.stringify(OUTPUT_EXAMPLE)}`;
}
