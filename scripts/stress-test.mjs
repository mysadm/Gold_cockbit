#!/usr/bin/env node
// Dependency-free HTTP load generator for the Gold Cockpit API.
//
// Why not k6/autocannon: this repo has zero runtime deps beyond what's in
// package.json, and this tool only needs Node's built-in fetch + perf_hooks
// to do a useful job — no new dependency to justify or keep updated.
//
// Usage:
//   node scripts/stress-test.mjs --scenario=read       --concurrency=20 --duration=10
//   node scripts/stress-test.mjs --scenario=wallet-write --concurrency=20 --duration=10
//   node scripts/stress-test.mjs --scenario=pool-spike --concurrency=60 --duration=5
//
// Scenarios:
//   read          GET-only mix across cheap, side-effect-free endpoints.
//   wallet-write  Concurrent POST /api/wallet/transactions — exercises the
//                 `SELECT ... FOR UPDATE` row lock in server/routes/wallet.mjs,
//                 which serializes on the single-tenant wallet_holdings row.
//   pool-spike    Same read mix at a concurrency deliberately set above the
//                 pg default pool size (10) to surface connection queueing.
//
// Does NOT touch /api/analyze (spends real provider $$) or /api/egypt-prices
// on a cache miss (hits a real third-party site) — see the printed notes.

import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const BASE_URL = args.url || 'http://localhost:8787';
const CONCURRENCY = Number(args.concurrency || 20);
const DURATION_S = Number(args.duration || 10);
const SCENARIO = args.scenario || 'read';
const API_KEY = args.apiKey || process.env.GOLD_COCKPIT_API_KEY || '';

const headers = { 'Content-Type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}) };

const READ_PATHS = ['/api/scenarios', '/api/tranches', '/api/watchlist', '/api/alert-rules', '/api/dca-plan', '/api/wallet'];

function walletWritePayload() {
  // Always a tiny buy: isolates lock-contention latency from the unrelated
  // "insufficient holdings" 400s a random buy/sell mix would produce once
  // concurrent writers race sells ahead of their paired buys.
  const amount = 0.01;
  const price = 1000 + Math.random(); // price doesn't matter for load purposes
  return { unit: 'g24', side: 'buy', amount, price_egp: price };
}

async function timedRequest(path, init) {
  const start = performance.now();
  try {
    const res = await fetch(BASE_URL + path, init);
    await res.arrayBuffer(); // drain body so keep-alive sockets are reusable
    return { ms: performance.now() - start, ok: res.ok, status: res.status };
  } catch (err) {
    return { ms: performance.now() - start, ok: false, status: 0, error: err.message };
  }
}

function nextRequest() {
  if (SCENARIO === 'read' || SCENARIO === 'pool-spike') {
    const path = READ_PATHS[Math.floor(Math.random() * READ_PATHS.length)];
    return timedRequest(path, { headers });
  }
  if (SCENARIO === 'wallet-write') {
    // Undo attempts a sell against zero stock only when a buy hasn't landed
    // yet; that's fine — a 400 here is itself signal (lock queueing pushed
    // the paired buy/sell out of order), and we count it like any other call.
    return timedRequest('/api/wallet/transactions', {
      method: 'POST',
      headers,
      body: JSON.stringify(walletWritePayload()),
    });
  }
  throw new Error(`unknown scenario: ${SCENARIO}`);
}

async function worker(results, stopAt) {
  while (performance.now() < stopAt) {
    results.push(await nextRequest());
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`\nGold Cockpit stress test`);
  console.log(`  target:      ${BASE_URL}`);
  console.log(`  scenario:    ${SCENARIO}`);
  console.log(`  concurrency: ${CONCURRENCY}`);
  console.log(`  duration:    ${DURATION_S}s\n`);

  if (SCENARIO === 'pool-spike') {
    console.log(`  note: concurrency ${CONCURRENCY} exceeds pg's default pool size (10) — expect`);
    console.log(`  latency to climb once in-flight requests exceed available connections.\n`);
  }
  if (SCENARIO === 'wallet-write') {
    console.log(`  note: this hammers the single-tenant wallet_holdings row lock`);
    console.log(`  (server/routes/wallet.mjs SELECT ... FOR UPDATE) — every writer for`);
    console.log(`  this whole deployment serializes here, by design of the current schema.\n`);
  }

  const results = [];
  const start = performance.now();
  const stopAt = start + DURATION_S * 1000;
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(results, stopAt)));
  const wallMs = performance.now() - start;

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  console.log(`Requests:     ${results.length}`);
  console.log(`Throughput:   ${(results.length / (wallMs / 1000)).toFixed(1)} req/s`);
  console.log(`Errors:       ${errors.length} (${((errors.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`Status codes: ${JSON.stringify(byStatus)}`);
  console.log(`Latency (ms): min=${latencies[0]?.toFixed(1)}  p50=${percentile(latencies, 50).toFixed(1)}  p95=${percentile(latencies, 95).toFixed(1)}  p99=${percentile(latencies, 99).toFixed(1)}  max=${latencies[latencies.length - 1]?.toFixed(1)}`);

  if (errors.length && errors[0].error) {
    console.log(`Sample error: ${errors[0].error}`);
  }
  console.log('');
}

main();
