import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT } from '../server/prompts/goldMarketAnalyst.mjs';

const snapshot = JSON.parse(await readFile(new URL('../tests/fixtures/analyst-request-v2.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/lib/analyst.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { buildAnalysisPrompt } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const runtime = buildAnalysisPrompt(snapshot, snapshot.watchlist, true);
const measure = (text) => ({ characters: text.length, words: text.split(/\s+/).length, estimatedTokens: Math.ceil(text.length / 4) });
console.log(JSON.stringify({ note: 'Synthetic fixture; tokens are character estimates, not billed usage.', system: measure(GOLD_MARKET_ANALYST_SYSTEM_PROMPT), runtime: measure(runtime), total: measure(GOLD_MARKET_ANALYST_SYSTEM_PROMPT + runtime) }, null, 2));
