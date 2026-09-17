import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT } from '../server/prompts/goldMarketAnalyst.mjs';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT as LEGACY_SYSTEM } from '../server/prompts/legacyGoldMarketAnalyst.mjs';
import { buildAnalysisPrompt as compactPrompt } from '../server/prompts/buildAnalysisPrompt.mjs';
import { alignSnapshot } from '../server/analystV3.mjs';

const snapshot = JSON.parse(await readFile(new URL('../tests/fixtures/analyst-request-v2.json', import.meta.url), 'utf8'));
const bundle = await build({ entryPoints: [new URL('../src/lib/analyst.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const code = bundle.outputFiles[0].text;
const { buildAnalysisPrompt } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const runtime = buildAnalysisPrompt(snapshot, snapshot.watchlist, true);
const measure = (text) => ({ characters: text.length, words: text.split(/\s+/).length, estimatedTokens: Math.ceil(text.length / 4) });
const compact = compactPrompt(alignSnapshot({ ...snapshot, schema_version: '2', previous_analysis: null }), []);
console.log(JSON.stringify({ note: 'Synthetic fixture without evidence for both versions; tokens are character estimates, not billed usage.',
  legacy: { system: measure(LEGACY_SYSTEM), runtime: measure(runtime), total: measure(LEGACY_SYSTEM + runtime) },
  compact: { system: measure(GOLD_MARKET_ANALYST_SYSTEM_PROMPT), runtime: measure(compact), total: measure(GOLD_MARKET_ANALYST_SYSTEM_PROMPT + compact) },
  inputCharacterReductionPct: +(100 * (1 - (GOLD_MARKET_ANALYST_SYSTEM_PROMPT.length + compact.length) / (LEGACY_SYSTEM.length + runtime.length))).toFixed(1),
}, null, 2));
