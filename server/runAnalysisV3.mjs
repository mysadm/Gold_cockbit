import {collectEvidence} from './evidence.mjs';
import {alignSnapshot,parseV3,validateV3,fallbackV3,stripUnknownFields} from './analystV3.mjs';
import {buildAnalysisPrompt} from './prompts/buildAnalysisPrompt.mjs';
import {GOLD_MARKET_ANALYST_SYSTEM_PROMPT} from './prompts/goldMarketAnalyst.mjs';
import {computeConfidence} from './routes/validateAnalysis.mjs';
import {correctionHints} from './prompts/correctionHints.mjs';
import {runAnalysisV4} from './runAnalysisV4.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const NO_CHANGE_ERRORS=new Set([
  'no_material_change requires recent matching prior decision',
  'no_material_change must preserve current and prior weights',
]);
const DCA_LIMIT_ERROR='DCA amount exceeds current installment limit';
const DCA_OMITTED_NOTE={
  en:'The DCA note was left out because it mentioned an amount above the current installment limit.',
  ar:'تم حذف ملاحظة خطة الشراء لأنها ذكرت مبلغًا أعلى من حد الشريحة الحالية.',
};

// Both call sites (server/standardAnalysis.mjs, server/routes/analyze.mjs) go through this one
// function; ANALYST_V4=1 (default off, .env.dev only) swaps the whole pipeline for the new
// PROMPT_V2 + schema-validated one in runAnalysisV4.mjs, so the live instance is unchanged after
// merge and rollback is one setting. V4 has no admin-prompt/format layer, so `prompts` is ignored
// there — see GOLD_COCKPIT_SPEED_PLAN.md NOTES, Phase 2.
export async function runAnalysisV3(provider, input, runProvider, opts={}) {
  if(['1','true'].includes(process.env.ANALYST_V4))return runAnalysisV4(provider,input,runProvider,opts);
  const {signal,evidenceCollector=collectEvidence,prompts={},onRawAnswer}=opts;
  const started=Date.now();
  const snapshot=alignSnapshot(input);
  const evidence=await evidenceCollector(provider);
  const searchMs=Date.now()-started;
  const system=prompts.system||GOLD_MARKET_ANALYST_SYSTEM_PROMPT;
  const prompt=buildAnalysisPrompt(snapshot,evidence.evidencePack,prompts.system?{marketScope:'',format:prompts.format}:undefined);
  let parsed,validation,retries=0,usage=null,usageComplete=true,dcaReadOmitted=false,statusCorrected=false,fieldsStripped=false;
  const modelStarted=Date.now();
  const options={system,expectJson:false,compact:true,signal};
  {
    for(let attempt=0;attempt<2;attempt++) {
      const correction=attempt===0?'':`\nCORRECTION: ${validation.errors.join('; ')}. Fix only these failures using the same supplied data and schema.${correctionHints(validation.errors,snapshot).map(h=>`\n- ${h}`).join('')}`;
      signal?.throwIfAborted();
      const result=await runProvider(provider,prompt+correction,options);
      signal?.throwIfAborted();
      if(result.usage)usage={input_tokens:(usage?.input_tokens||0)+(result.usage.input_tokens||0),output_tokens:(usage?.output_tokens||0)+(result.usage.output_tokens||0)};
      else usageComplete=false;
      onRawAnswer?.(result.text);
      parsed=parseV3(result.text);
      validation=validateV3({parsed,snapshot,evidenceIds:evidence.evidenceIds});
      if(result.truncated)validation={ok:false,errors:[...validation.errors,'completion was truncated']};
      retries=attempt;
      if(validation.ok)break;
    }
    // Two things are harmless to repair, alone or together: fields the app does not use (a custom
    // prompt often adds e.g. "reason" to weight changes) are removed, and the optional DCA note is
    // dropped, with a note, if it named an amount above the installment limit (the amount is never
    // shown). If ANY other error remains the answer is rejected as before.
    const repairable=e=>e===DCA_LIMIT_ERROR||e.endsWith(': unknown fields');
    if(!validation.ok&&object(parsed)&&validation.errors.length>0&&validation.errors.every(repairable)) {
      const hasUnknown=validation.errors.some(e=>e!==DCA_LIMIT_ERROR);
      const hasDca=validation.errors.includes(DCA_LIMIT_ERROR);
      const fixed=stripUnknownFields(structuredClone(parsed));
      let canFix=true;
      if(hasDca) {
        if(typeof fixed.reads?.dca==='string') {
          delete fixed.reads.dca;
          if(Array.isArray(fixed.assumptions)&&fixed.assumptions.length<3)fixed.assumptions.push(DCA_OMITTED_NOTE[snapshot.locale==='ar'?'ar':'en']);
        } else canFix=false;
      }
      const recheck=canFix?validateV3({parsed:fixed,snapshot,evidenceIds:evidence.evidenceIds}):null;
      if(recheck?.ok){parsed=fixed;validation=recheck;dcaReadOmitted=hasDca;fieldsStripped=hasUnknown;}
    }
    // "No material change" is only allowed when the previous analysis is recent, made the same
    // decision and suggested the weights that are still applied. Otherwise the analysis did find
    // something to report, so relabel it and let the normal checks decide, instead of throwing
    // away an answer that is right except for its status label.
    if(!validation.ok&&object(parsed)&&parsed.status==='no_material_change'&&validation.errors.length>0&&validation.errors.every(e=>NO_CHANGE_ERRORS.has(e))) {
      const relabelled={...parsed,status:'material_change'};
      const recheck=validateV3({parsed:relabelled,snapshot,evidenceIds:evidence.evidenceIds});
      if(recheck.ok){parsed=relabelled;validation=recheck;statusCorrected=true;}
    }
    if(!validation.ok)parsed=fallbackV3(snapshot);
    parsed.primary_decision.confidence=computeConfidence({modelConfidence:parsed.primary_decision.confidence,errors:validation.errors,evidenceCoverageRatio:parsed.evidence.length?1:0});
    // Partial search cannot support high confidence, even with structurally valid IDs.
    if(evidence.searchStatus==='partial'&&parsed.primary_decision.confidence==='high')parsed.primary_decision.confidence='medium';
  }
  if(!usageComplete)usage=null;
  const metrics={contract:'3',providerType:provider.provider_type,searchMs,modelMs:Date.now()-modelStarted,totalMs:Date.now()-started,cacheHits:evidence.searchMetrics?.cacheHits??0,cacheMisses:evidence.searchMetrics?.cacheMisses??0,retries,usage,validationOk:validation.ok,validationErrors:validation.errors.slice(0,6),dcaReadOmitted,statusCorrected,fieldsStripped,inputCharacters:system.length+prompt.length,outputCharacters:JSON.stringify(parsed).length};
  console.info('[analyst-metrics]',JSON.stringify(metrics));
  return {text:JSON.stringify(parsed),result:parsed,validation,usage,usedWebSearch:evidence.usedWebSearch,searchStatus:evidence.searchStatus,evidenceSources:evidence.evidenceSources,metrics};
}
