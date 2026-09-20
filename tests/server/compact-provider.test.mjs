import { it, expect, vi, afterEach } from 'vitest';
import { callClaude } from '../../server/providers/claude.mjs';
import { callOpenAICompatible } from '../../server/providers/openaiCompatible.mjs';
import { completionBudget } from '../../server/providers/completionBudget.mjs';
afterEach(() => vi.unstubAllGlobals());
it.each([[undefined,4096],[0,4096],[128,4096],[1024,4096],[3000,4096],[5000,5000],[100000,8192],[NaN,4096]])('clamps compact completion budget %s to %s', (input,expected) => {
  expect(completionBudget(input,true)).toBe(expected);
  expect(completionBudget(1024,false)).toBe(16000);
});
it('Claude uses the compact budget and exposes truncation/usage', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({content:[{type:'text',text:'{}'}],stop_reason:'max_tokens',usage:{input_tokens:500,output_tokens:100}})});
  vi.stubGlobal('fetch',fetchMock);
  const result=await callClaude({apiKey:'test',model:'model',prompt:'data',compact:true,expectJson:false});
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(4096);
  expect(result).toMatchObject({truncated:true,usage:{input_tokens:500,output_tokens:100}});
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('compatible providers normalize usage and allow an explicit completion parameter adapter', async () => {
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:'{}'},finish_reason:'length'}],usage:{prompt_tokens:50,completion_tokens:10}})});
  vi.stubGlobal('fetch',fetchMock);
  const result=await callOpenAICompatible({baseUrl:'http://localhost:11434/v1/',model:'model',prompt:'data',compact:true,expectJson:false,tokenLimitParameter:'max_completion_tokens'});
  expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
  const body=JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.max_completion_tokens).toBe(4096);expect(body.max_tokens).toBeUndefined();
  expect(result).toMatchObject({truncated:true,usage:{input_tokens:50,output_tokens:10}});
});
it.each(['claude','compatible'])('%s reports missing usage as unknown, not zero',async kind=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({content:[{type:'text',text:'{}'}]}),json:async()=>({choices:[{message:{content:'{}'}}]})}));
  const fn=kind==='claude'?callClaude:callOpenAICompatible;
  const result=await fn({baseUrl:'http://localhost:11434/v1',model:'model',prompt:'data',compact:true,expectJson:false});
  expect(result.usage).toBeNull();
});
it.each([callClaude,callOpenAICompatible])('aborts before a provider request when already cancelled',async fn=>{
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await expect(fn({baseUrl:'http://localhost:11434/v1',model:'model',prompt:'data',signal:AbortSignal.abort()})).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
