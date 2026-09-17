// Explicit opt-in: sends only the checked-in synthetic portfolio to configured
// providers. No database writes, no credentials/real portfolios in output.
import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { collectEvidence } from '../server/evidence.mjs';
import { alignSnapshot } from '../server/analystV3.mjs';
import { runProviderAnalysis } from '../server/providers/dispatch.mjs';
import { runAnalysisV3 } from '../server/runAnalysisV3.mjs';
import { validateAnalysis } from '../server/routes/validateAnalysis.mjs';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT as legacySystem } from '../server/prompts/legacyGoldMarketAnalyst.mjs';

if (!process.argv.includes('--live')) throw new Error('Use --live to authorize synthetic provider calls. Optional --ids=13,7,8 and --ar.');
const idsArg=process.argv.find(a=>a.startsWith('--ids='));
if(!idsArg || !/^--ids=\d+(,\d+)*$/.test(idsArg))throw new Error('Explicit numeric provider IDs required');
const ids=idsArg.slice(6).split(',').map(Number);
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
let providers;
try { providers=(await client.query('SELECT * FROM llm_providers WHERE id = ANY($1::bigint[]) ORDER BY id',[ids])).rows; }
finally {await client.end();}
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/analyst-request-v2.json',import.meta.url),'utf8'));
const snapshot=alignSnapshot({...fixture,schema_version:'2',generated_at:new Date().toISOString(),previous_analysis:null,locale:process.argv.includes('--ar')?'ar':'en'});
const bundle=await build({entryPoints:[new URL('../src/lib/analyst.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {buildAnalysisPrompt:legacyPrompt,tryParseJson}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const start=Date.now();
const evidence=await collectEvidence({settings:{webSearch:true}});
const coldSearchMs=Date.now()-start;
const warmStart=Date.now();
const warm=await collectEvidence({settings:{webSearch:true}});
console.log(JSON.stringify({search:{coldMs:coldSearchMs,warmMs:Date.now()-warmStart,status:evidence.searchStatus,count:evidence.evidenceIds.length,identical:JSON.stringify(evidence.evidencePack)===JSON.stringify(warm.evidencePack),...warm.searchMetrics}}));
if(!evidence.evidenceIds.length)throw new Error('No evidence; cannot benchmark supported decisions');
for(const provider of providers) {
  // Same evidence and snapshot for both versions, including the same language.
  const prompt=`LIVE WEB SEARCH RESULTS. Cite supplied IDs. Never invent an ID.\n${evidence.evidencePack.map(r=>`[${r.id}] ${r.title} ${r.date} — ${r.snippet}`).join('\n')}\n\n${legacyPrompt(snapshot,snapshot.watchlist,true)}`;
  for(const contract of ['2','3']) {
    const started=Date.now();
    try {
      const signal=AbortSignal.timeout(85000);
      let output;
      if(contract==='3')output=await runAnalysisV3(provider,snapshot,runProviderAnalysis,{signal,evidenceCollector:async()=>evidence});
      else {
        let usage=null,validation,parsed,result,retries=0,usageComplete=true;
        for(let attempt=0;attempt<2;attempt++) {
          const correction=attempt?`\nCorrect these validation errors without new facts: ${validation.errors.join('; ')}`:'';
          result=await runProviderAnalysis(provider,prompt+correction,{signal,expectJson:false});
          if(result.usage)usage={input_tokens:(usage?.input_tokens||0)+result.usage.input_tokens,output_tokens:(usage?.output_tokens||0)+result.usage.output_tokens};
          else usageComplete=false;
          parsed=tryParseJson(result.text);
          validation=validateAnalysis({parsed,rawText:result.text,evidenceIds:evidence.evidenceIds,snapshot});
          retries=attempt;if(validation.ok)break;
        }
        output={result:parsed,validation,usage:usageComplete?usage:null,metrics:{retries,inputCharacters:legacySystem.length+prompt.length,outputCharacters:result.text.length}};
      }
      console.log(JSON.stringify({provider:provider.provider_type,model:provider.model,contract,locale:snapshot.locale,totalMs:Date.now()-started,usage:output.usage,validation:output.validation,metrics:output.metrics,sample:output.result}));
    }catch(error){console.log(JSON.stringify({provider:provider.provider_type,model:provider.model,contract,totalMs:Date.now()-started,errorType:error.name,failed:true}));}
  }
}
