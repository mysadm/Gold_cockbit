import {describe,it,expect} from 'vitest';
import fixture from '../fixtures/analyst-request-v2.json';
import {validateV3, fallbackV3, parseV3, validateSnapshot, alignSnapshot} from '../../server/analystV3.mjs';
import {buildAnalysisPrompt, OUTPUT_EXAMPLE} from '../../server/prompts/buildAnalysisPrompt.mjs';
import {GOLD_MARKET_ANALYST_SYSTEM_PROMPT} from '../../server/prompts/goldMarketAnalyst.mjs';
const snapshot={...fixture,schema_version:'2',previous_analysis:null};
const valid=()=>({...structuredClone(OUTPUT_EXAMPLE),suggested_weights:{deesc:35,base:45,stag:20},weight_changes:[],status:'material_change'});
const check=(parsed,ids=['EV-001'],s=snapshot)=>validateV3({parsed,evidenceIds:ids,snapshot:s});
describe('v3 contract',()=>{
 it('accepts complete bounded JSON and preserves deterministic fallback weights',()=>{
   expect(check(valid()).ok).toBe(true);
   expect(check(fallbackV3(snapshot),[]).ok).toBe(true);
 });
 it.each(['unknown enum','numeric string','unknown evidence','missing decision','missing invalidation','url','too many evidence','unexplained weights','missing weight change','no evidence','null','array'])('rejects %s',kind=>{
   let r=valid();
   if(kind==='unknown enum')r.primary_decision.action='ADD';
   if(kind==='numeric string')r.suggested_weights.base='45';
   if(kind==='unknown evidence')r.evidence[0].evidence_id='EV-999';
   if(kind==='missing decision')delete r.primary_decision;
   if(kind==='missing invalidation')delete r.primary_decision.invalidation;
   if(kind==='url')r.reads.egp='https://invented.test';
   if(kind==='too many evidence')r.evidence=Array(4).fill(r.evidence[0]);
   if(kind==='unexplained weights')r.weight_changes=[{scenario:'base',from:45,to:45,evidence_ids:[]}];
   if(kind==='missing weight change')r.suggested_weights={deesc:30,base:50,stag:20};
   if(kind==='no evidence')r.evidence=[];
   if(kind==='null')r=null;
   if(kind==='array')r=[];
   expect(check(r).ok).toBe(false);
 });
 it('no material change requires a recent validated prior decision and matching applied weights',()=>{
   const r=valid();r.status='no_material_change';
   expect(check(r).ok).toBe(false);
   const prior={generated_at:snapshot.generated_at,action:'wait',suggested_weights:r.suggested_weights};
   expect(check(r,['EV-001'],{...snapshot,previous_analysis:prior}).ok).toBe(true);
   expect(check(r,['EV-001'],{...snapshot,previous_analysis:{...prior,action:'buy'}}).ok).toBe(false);
 });
 it('rejects Arabic DCA amounts beyond the installment budget',()=>{
   const r=valid();r.reads.dca='نفذ ٩٩٩٬٩٩٩ جنيه';
   expect(check(r).ok).toBe(false);
 });
 it('checks currency-prefix amounts and gives completed/future windows no current deployment allowance',()=>{
   const r=valid();r.reads.dca='Deploy EGP 40001';
   expect(check(r).ok).toBe(false);
   r.reads.dca='Deploy 40000 EGP';expect(check(r).ok).toBe(true);
   expect(check(r,['EV-001'],{...snapshot,dca:{...snapshot.dca,status:'all_complete'}}).ok).toBe(false);
   expect(alignSnapshot(snapshot).dca.current_installment_limit_egp).toBe(40000);
 });
 it('parses fenced/prefixed complete JSON but never salvages truncated decision text',()=>{
   expect(parseV3('prefix\n```json\n'+JSON.stringify(valid())+'\n```')).toEqual(valid());
   expect(parseV3('{"primary_decision":{"headline":"cut')).toBeNull();
 });
 it('bounds policy instructions and uses server evidence without a browsing claim',()=>{
   expect(GOLD_MARKET_ANALYST_SYSTEM_PROMPT.length).toBeLessThanOrEqual(3600);
   const p=buildAnalysisPrompt(snapshot,[]);
   expect(p.length-JSON.stringify(snapshot).length).toBeLessThanOrEqual(2500);
   expect(p).not.toContain('Use your live web search');
 });
 it('preserves punctuation inside valid strings and repairs only structural commas',()=>{
   expect(parseV3('{"text":"comma, } stays",}')).toEqual({text:'comma, } stays'});
 });
 it('rejects English-only prose for Arabic requests but accepts a fully Arabic safe fallback',()=>{
   const ar={...snapshot,locale:'ar'};
   expect(check(valid(),['EV-001'],ar).ok).toBe(false);
   expect(check(fallbackV3(ar),[],ar).ok).toBe(true);
 });
 it('never throws on malformed read values',()=>{
   const r=valid();r.reads.dca={amount:100};
   expect(check(r).ok).toBe(false);
 });
 it('rejects malformed DCA splits and negative budgets',()=>{
   expect(validateSnapshot(snapshot)).toEqual([]);
   expect(validateSnapshot({...snapshot,dca:{...snapshot.dca,total_investment_egp:-1}})).not.toEqual([]);
   expect(validateSnapshot({...snapshot,dca:{...snapshot.dca,tranche_split_pct:[]}})).not.toEqual([]);
 });
 it('recomputes alignment instead of trusting client claims; old, missing and future timestamps are unreliable',()=>{
   const now=Date.now();
   for(const offset of [-7200000,7200000,NaN]) {
     const timestamp=Number.isFinite(offset)?new Date(now+offset).toISOString():null;
     const s={...snapshot,market:{...snapshot.market,xau_retrieved_at:timestamp,fx_retrieved_at:timestamp},egypt:{...snapshot.egypt,retrieved_at:timestamp},price_alignment:{premium_reliable:true}};
     expect(alignSnapshot(s).price_alignment.premium_reliable).toBe(false);
   }
 });
});
