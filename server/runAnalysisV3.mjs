import {collectEvidence} from './evidence.mjs';
import {alignSnapshot,parseV3,validateV3,fallbackV3} from './analystV3.mjs';
import {buildAnalysisPrompt} from './prompts/buildAnalysisPrompt.mjs';
import {GOLD_MARKET_ANALYST_SYSTEM_PROMPT} from './prompts/goldMarketAnalyst.mjs';
import {computeConfidence} from './routes/validateAnalysis.mjs';
import {correctionHints} from './prompts/correctionHints.mjs';

export async function runAnalysisV3(provider, input, runProvider, {signal,evidenceCollector=collectEvidence}={}) {
  const started=Date.now();
  const snapshot=alignSnapshot(input);
  const evidence=await evidenceCollector(provider);
  const searchMs=Date.now()-started;
  const prompt=buildAnalysisPrompt(snapshot,evidence.evidencePack);
  let parsed,validation,retries=0,usage=null,usageComplete=true;
  const modelStarted=Date.now();
  const options={system:GOLD_MARKET_ANALYST_SYSTEM_PROMPT,expectJson:false,compact:true,signal};
  {
    for(let attempt=0;attempt<2;attempt++) {
      const correction=attempt===0?'':`\nCORRECTION: ${validation.errors.join('; ')}. Fix only these failures using the same supplied data and schema.${correctionHints(validation.errors,snapshot).map(h=>`\n- ${h}`).join('')}`;
      signal?.throwIfAborted();
      const result=await runProvider(provider,prompt+correction,options);
      signal?.throwIfAborted();
      if(result.usage)usage={input_tokens:(usage?.input_tokens||0)+(result.usage.input_tokens||0),output_tokens:(usage?.output_tokens||0)+(result.usage.output_tokens||0)};
      else usageComplete=false;
      parsed=parseV3(result.text);
      validation=validateV3({parsed,snapshot,evidenceIds:evidence.evidenceIds});
      if(result.truncated)validation={ok:false,errors:[...validation.errors,'completion was truncated']};
      retries=attempt;
      if(validation.ok)break;
    }
    if(!validation.ok)parsed=fallbackV3(snapshot);
    parsed.primary_decision.confidence=computeConfidence({modelConfidence:parsed.primary_decision.confidence,errors:validation.errors,evidenceCoverageRatio:parsed.evidence.length?1:0});
    // Partial search cannot support high confidence, even with structurally valid IDs.
    if(evidence.searchStatus==='partial'&&parsed.primary_decision.confidence==='high')parsed.primary_decision.confidence='medium';
  }
  if(!usageComplete)usage=null;
  const metrics={contract:'3',providerType:provider.provider_type,searchMs,modelMs:Date.now()-modelStarted,totalMs:Date.now()-started,cacheHits:evidence.searchMetrics?.cacheHits??0,cacheMisses:evidence.searchMetrics?.cacheMisses??0,retries,usage,validationOk:validation.ok,validationErrors:validation.errors.slice(0,6),inputCharacters:GOLD_MARKET_ANALYST_SYSTEM_PROMPT.length+prompt.length,outputCharacters:JSON.stringify(parsed).length};
  console.info('[analyst-metrics]',JSON.stringify(metrics));
  return {text:JSON.stringify(parsed),result:parsed,validation,usage,usedWebSearch:evidence.usedWebSearch,searchStatus:evidence.searchStatus,evidenceSources:evidence.evidenceSources,metrics};
}
