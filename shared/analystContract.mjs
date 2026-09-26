const KEYS = ['deesc','base','stag'];
const ACTIONS = ['buy','hold','wait','reduce','review','insufficient_evidence'];
const LEVELS = ['low','medium','high'];
// The fields each part of an answer may carry. The validator rejects anything else.
const FIELDS={
  response:['schema_version','status','primary_decision','evidence','suggested_weights','weight_changes','reads','assumptions','missing_inputs'],
  primary_decision:['action','horizon','confidence','headline','next_trigger','invalidation'],
  evidence:['evidence_id','scenario_effect','strength','implication'],
  weight_change:['scenario','from','to','evidence_ids'],
  reads:['egp','wallet','dca','watchlist'],
};
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function snapshotWeights(snapshot) {
  return Object.fromEntries(KEYS.map(key => [key,snapshot.scenarios.find(s=>s.key===key).weight_pct]));
}
export function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schema_version !== '2') return ['snapshot schema_version must be 2'];
  const errors=[];
  if (!['ar','en'].includes(snapshot.locale) || !['beginner','expert'].includes(snapshot.explanation_level)) errors.push('invalid locale or explanation level');
  if (!Number.isFinite(Date.parse(snapshot.generated_at))) errors.push('invalid snapshot timestamp');
  if (!object(snapshot.market) || !['xau_usd','usd_egp'].every(k=>finite(snapshot.market[k]) && snapshot.market[k]>0)) errors.push('positive market prices required');
  if (!Array.isArray(snapshot.scenarios) || snapshot.scenarios.length!==3 || !KEYS.every(k=>snapshot.scenarios.filter(s=>s?.key===k).length===1)) errors.push('three distinct scenario keys required');
  else {
    if (!snapshot.scenarios.every(s=>finite(s.weight_pct)&&s.weight_pct>=0&&s.weight_pct<=100&&finite(s.price_lo)&&finite(s.price_hi)&&s.price_lo>0&&s.price_hi>=s.price_lo)) errors.push('invalid scenario values');
    if(Math.abs(snapshot.scenarios.reduce((sum,s)=>sum+s.weight_pct,0)-100)>0.01)errors.push('snapshot weights must total 100');
  }
  if (!object(snapshot.wallet) || !Array.isArray(snapshot.watchlist)) errors.push('wallet and watchlist required');
  if (snapshot.dca) {
    const d=snapshot.dca;
    const budget=d.mode==='fixed'?d.total_investment_egp:d.monthly_investment_egp;
    if(!object(d)||!['fixed','recurring'].includes(d.mode)||!finite(budget)||budget<0)errors.push('invalid DCA budget');
    if(d.mode==='fixed' && (!Array.isArray(d.tranche_split_pct)||!d.tranche_split_pct.length||!d.tranche_split_pct.every(n=>finite(n)&&n>=0&&n<=100)||Math.abs(d.tranche_split_pct.reduce((a,b)=>a+b,0)-100)>0.01))errors.push('invalid DCA split');
    if(d.active_tranche_index!==null && (!Number.isInteger(d.active_tranche_index)||d.active_tranche_index<0||(d.mode==='fixed'&&d.active_tranche_index>=d.tranche_split_pct?.length)))errors.push('invalid active installment');
  }
  if (JSON.stringify(snapshot).length>24000)errors.push('snapshot exceeds size budget');
  return errors;
}
export function alignSnapshot(snapshot) {
  const result=structuredClone(snapshot);
  if(result.dca) result.dca.current_installment_limit_egp=installmentLimit(result.dca);
  const times=[result.market.xau_retrieved_at,result.market.fx_retrieved_at,result.egypt?.retrieved_at].map(t=>t?Date.parse(t):NaN);
  const complete=times.every(Number.isFinite);
  const gap=complete?(Math.max(...times)-Math.min(...times))/60000:null;
  const now=Date.now();
  result.price_alignment={aligned:gap!==null&&gap<=60,premium_reliable:complete&&gap<=60&&times.every(t=>t<=now&&now-t<=3600000),age_gap_minutes:gap,max_gap_minutes:60};
  return result;
}
function installmentLimit(dca) {
  if(dca.status !== 'open_now')return 0;
  if(dca.mode==='recurring')return dca.monthly_investment_egp;
  const pct=dca.tranche_split_pct?.[dca.active_tranche_index];
  return Number.isFinite(pct)?Math.round(dca.total_investment_egp*pct)/100:0;
}
// Every EGP amount mentioned in free-text DCA prose, normalizing Arabic-Indic digits and
// thousands separators first. Shared by v3's reads.dca check above and v4's dca_read check
// (shared/analystOutputV4.mjs) — kept in one place since a missed amount here is a real safety
// gap (a user could be told to invest more than their current installment allows).
export function extractEgpAmounts(text) {
  const normalized=String(text??'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٬,]/g,'');
  return [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:EGP|جنيه)|(?:EGP|جنيه)\s*(\d+(?:\.\d+)?)/gi)].map(m=>Number(m[1]??m[2]));
}
export function parseV3(text) {
  if(typeof text!=='string')return null;
  const a=text.indexOf('{'),b=text.lastIndexOf('}');
  if(a<0||b<a)return null;
  const json=text.slice(a,b+1);
  try{return JSON.parse(json);}catch{
    // Remove trailing commas only outside strings; never mutate prose.
    const repaired=json.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g,match=>match.startsWith('"')?match:'');
    try{return JSON.parse(repaired);}catch{return null;}
  }
}
export function fallbackV3(snapshot) {
  const ar=snapshot.locale==='ar';
  return {schema_version:'3',status:'insufficient_evidence',
    primary_decision:{action:'insufficient_evidence',horizon:'now',confidence:'low',headline:ar?'الأدلة غير كافية لتوصية موثوقة.':'Insufficient evidence for a reliable recommendation.',next_trigger:ar?'أعد التحليل بعد تحديث البيانات.':'Reassess after refreshing data.',invalidation:ar?'توافر أدلة حديثة ومكتملة.':'Fresh, sufficient evidence becomes available.'},
    evidence:[],suggested_weights:snapshotWeights(snapshot),weight_changes:[],reads:{egp:ar?'الأسعار المعروضة مدخلات من التطبيق.':'Displayed prices are application inputs.'},assumptions:[],missing_inputs:[ar?'أدلة حديثة تم التحقق منها':'Adequate current evidence']};
}
// Removes fields the app does not use (a custom prompt often adds notes such as "reason" to
// weight changes). Returns a copy; it never adds or changes a value, so anything else that is
// wrong with the answer is still caught by validateV3.
export function stripUnknownFields(parsed) {
  if(!object(parsed))return parsed;
  const keep=(o,keys)=>object(o)?Object.fromEntries(Object.entries(o).filter(([k])=>keys.includes(k))):o;
  const list=(a,keys)=>Array.isArray(a)?a.map(item=>keep(item,keys)):a;
  const r=keep(parsed,FIELDS.response);
  if('primary_decision' in r)r.primary_decision=keep(r.primary_decision,FIELDS.primary_decision);
  if('suggested_weights' in r)r.suggested_weights=keep(r.suggested_weights,KEYS);
  if('evidence' in r)r.evidence=list(r.evidence,FIELDS.evidence);
  if('weight_changes' in r)r.weight_changes=list(r.weight_changes,FIELDS.weight_change);
  if('reads' in r)r.reads=keep(r.reads,FIELDS.reads);
  return r;
}
export function validateV3({parsed:r,snapshot,evidenceIds=[]}) {
  if(!object(r))return {ok:false,errors:['response must be a JSON object']};
  const errors=[];const fail=m=>errors.push(m);
  const known=new Set(evidenceIds);
  const prose=(s,name,max=320)=>{
    if(typeof s!=='string'||!s.trim()||s.length>max)fail(`${name}: nonempty string up to ${max} characters required`);
    else if(snapshot.locale==='ar'&&!/[\u0621-\u064A]/u.test(s))fail(`${name}: Arabic prose required; keep only keys and enum codes in English`);
  };
  const only=(value,keys,name)=>{if(object(value)&&Object.keys(value).some(k=>!keys.includes(k)))fail(`${name}: unknown fields`);};
  only(r,FIELDS.response,'response');
  if(r.schema_version!=='3')fail('schema_version must be 3');
  if(!['material_change','no_material_change','insufficient_evidence'].includes(r.status))fail('invalid status');
  const p=r.primary_decision;
  if(!object(p))fail('primary_decision required');
  else {
    only(p,FIELDS.primary_decision,'primary_decision');
    if(!ACTIONS.includes(p.action)||!LEVELS.includes(p.confidence)||!['now','next_event','strategic'].includes(p.horizon))fail('invalid decision enum');
    prose(p.headline,'headline',180);prose(p.next_trigger,'next_trigger');prose(p.invalidation,'invalidation');
  }
  const w=r.suggested_weights, initial=snapshotWeights(snapshot);
  const validWeights=object(w)&&KEYS.every(k=>finite(w[k])&&w[k]>=0&&w[k]<=100)&&Math.abs(KEYS.reduce((n,k)=>n+w[k],0)-100)<0.01;
  if(!validWeights)fail('suggested_weights must be numeric percentages totaling 100');
  only(w,KEYS,'suggested_weights');
  if(!Array.isArray(r.evidence)||r.evidence.length>3)fail('evidence must have 0–3 items');
  else for(const e of r.evidence) {
    only(e,FIELDS.evidence,'evidence item');
    if(!object(e)||!known.has(e.evidence_id))fail('unknown evidence ID');
    if(![...KEYS,'mixed','neutral'].includes(e?.scenario_effect)||!LEVELS.includes(e?.strength))fail('invalid evidence enum');
    prose(e?.implication,'implication');
  }
  if(r.status!=='insufficient_evidence' && (!known.size||!r.evidence?.length))fail('current evidence required for recommendation');
  if(!Array.isArray(r.weight_changes)||r.weight_changes.length>3)fail('weight_changes must have 0–3 items');
  else {
    for(const c of r.weight_changes) {
      only(c,FIELDS.weight_change,'weight change');
      if(!KEYS.includes(c?.scenario)||c.from!==initial[c.scenario]||c.to!==w?.[c.scenario]||c.from===c.to)fail('weight change does not match snapshot and result');
      if(!Array.isArray(c?.evidence_ids)||!c.evidence_ids.length||c.evidence_ids.some(id=>!known.has(id)))fail('weight change needs known evidence IDs');
    }
    if(validWeights)for(const k of KEYS)if(r.weight_changes.filter(c=>c?.scenario===k).length!==(w[k]!==initial[k]?1:0))fail('every changed weight needs exactly one explanation');
  }
  if(r.status==='no_material_change') {
    const prev=snapshot.previous_analysis;
    const age=Date.parse(snapshot.generated_at)-Date.parse(prev?.generated_at);
    if(!prev||!Number.isFinite(age)||age<0||age>86400000||p?.action!==prev.action)fail('no_material_change requires recent matching prior decision');
    if(KEYS.some(k=>w?.[k]!==initial[k]||prev?.suggested_weights?.[k]!==initial[k])||r.weight_changes?.length)fail('no_material_change must preserve current and prior weights');
  }
  if(r.status==='insufficient_evidence'||p?.action==='insufficient_evidence') {
    if(r.status!=='insufficient_evidence'||p?.action!=='insufficient_evidence'||p?.confidence!=='low'||KEYS.some(k=>w?.[k]!==initial[k]))fail('insufficient_evidence requires low confidence and unchanged weights');
  }
  if(!object(r.reads))fail('reads required');
  else {
    only(r.reads,FIELDS.reads,'reads');
    prose(r.reads.egp,'reads.egp');
    for(const k of ['wallet','dca','watchlist'])if(r.reads[k]!==undefined)prose(r.reads[k],`reads.${k}`);
    const dca=snapshot.dca;
    if(dca&&typeof r.reads.dca==='string') {
      const cap=installmentLimit(dca);
      const amounts=extractEgpAmounts(r.reads.dca);
      if(amounts.some(n=>n>cap))fail('DCA amount exceeds current installment limit');
    }
  }
  for(const k of ['assumptions','missing_inputs']) {
    if(!Array.isArray(r[k])||r[k].length>3)fail(`${k} must contain 0–3 strings`);
    else r[k].forEach(s=>prose(s,k));
  }
  if(/https?:\/\//i.test(JSON.stringify(r)))fail('model output must not contain URLs');
  return {ok:!errors.length,errors};
}
