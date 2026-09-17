# Compact analyst: review gate

Date: 2026-09-17. **Do not enable v3 by default yet.**

Implementation is available behind `ANALYST_CONTRACT_VERSION=v3`. Unset or
`v2` keeps the legacy contract. Flutter remains on its existing legacy path;
its migration is explicitly deferred under Task 7's hold option.

## Measurements

Only the checked-in synthetic portfolio was sent to configured providers.
No real holdings or credentials are included here. These are single-run
smoke samples, not medians, financial recommendations, or a quality score.
Both versions in each pair received the same frozen ten-source evidence pack.
The legacy comparison uses the original long prompts with the now-bounded
pack, not the original maximum of 25 sources. Model times below exclude the
separately measured search stage and include corrective attempts.

| Provider / sample | Legacy input / output tokens | Compact input / output tokens | Legacy / compact time | Result |
|---|---:|---:|---:|---|
| GPT-4o, English first pass | 4,136 / 570 | 1,907 / 393 | 7.52s / 4.97s | Both structurally valid; no retries |
| GPT-4o, Arabic after locale fix | 4,223 / 607 | 1,999 / 419 | 6.74s / 5.62s | Arabic JSON valid; no retries |
| Shared Claude Haiku, first pass | Unknown (timeout) | 4,328 / 1,914 | 85s timeout / 23.99s | Compact passed after one correction |
| Configured Ollama gemma4 | Unknown | Unknown | 85s timeout / 85s timeout | No successful local result |

The English/shared samples preceded the final fixed-DCA and locale refinements.
The Arabic pair includes those refinements. An earlier Arabic smoke response
was valid JSON but entirely English: the final pipeline now explicitly requests
Arabic and rejects non-Arabic prose fields before accepting the result.

- Measured GPT-4o input reductions: about 54% (English) and 53% (Arabic).
- Output reductions: about 31%, **below the proposed 50% target**.
- Latency reduction: about 34% (English) and 17% (Arabic). No median latency
  target is established by these samples.
- Search smoke: 308ms cold / 1ms warm; later pairs 610ms / 3ms and 481ms /
  under 1ms. Each warm run reported five cache hits, zero misses, and a
  byte-identical pack. Cache results are per process and disappear on restart.
- The final deterministic no-evidence size comparison is 14,798 legacy
  characters versus 5,389 compact characters: **63.6% smaller**. Approximate
  characters/4 token estimates are 3,700 versus 1,348, not billed usage.

## Quality findings requiring review

Valid IDs and numeric totals do not prove correct reasoning. In the live smoke
samples, recommendations changed from `hold` to `wait`; shared Claude also
confused price-band units and treated a DCA budget as available cash despite
instructions to keep them separate. Those are substantive review findings,
not issues that a JSON validator can reliably certify away.

An initial GPT-4o fixed-plan read wrongly called a null monthly budget missing.
The final prompt distinguishes fixed and recurring budgets, and the snapshot
now includes a deterministically computed current-installment limit. Closed
or future windows have no current deployment allowance. Amount checking is a
guard for explicit numeric currency amounts, not a proof about every possible
free-form phrase, spelled-out number, or implied recommendation.

Retrieval timestamps bound input age but do not prove the underlying feed's
observation time. Premium interpretation still requires source-aware review.

### Anonymized compact Arabic excerpt

This is a model-output sample from a synthetic portfolio, **not advice**:

```json
{
  "schema_version": "3",
  "status": "material_change",
  "primary_decision": {
    "action": "wait",
    "horizon": "now",
    "headline": "الانتظار بسبب عدم وضوح الصورة الحالية",
    "confidence": "medium",
    "next_trigger": "مراجعة عند تغير في السياسة النقدية أو السوق",
    "invalidation": "تغير كبير في أسعار الذهب أو السياسة الفيدرالية"
  },
  "suggested_weights": {"deesc": 35, "base": 45, "stag": 20},
  "weight_changes": []
}
```

The excerpt omits the response's other required fields for readability and is
not a complete request/response fixture. Its trigger remains broad: expert
review should judge actionability, not merely brevity.

## Compatibility and rollout

- All six configured provider families receive the same logical compact
  instructions, snapshot and evidence format. They need plain system/user text
  and JSON text output, not native search, tools, schema APIs or prompt caching.
- This does **not** guarantee every model or endpoint supports every transport
  parameter or produces useful analysis. Local-model performance remains unproven.
- Compact completions default to 4,096, with configured values clamped to
  1,024–8,192. Legacy requests keep their previous 16,000-token floor.
- OpenAI compact requests use `max_completion_tokens`. Other compatible APIs
  default to `max_tokens`; `settings.extra.tokenLimitParameter` may select either,
  and `settings.extra.omitTemperature=true` supports endpoints that reject it.
  The OpenAI adapter follows the [official Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
- Missing token usage is `null`, not zero. One correction is the maximum; all
  reported attempts are included. Usage is unknown if any attempt omits it.
- Metrics record durations, cache counts, retry count, provider type, sizes and
  validation, never prompts, portfolio values, API keys or complete responses.
- Failed validation and insufficient evidence disable Apply Weights. Valid
  percentages—including zero and decimals—are applied without hidden rounding.
- Search packs are identical for the same cached successful facet set. Recovery
  of an uncached failed/empty query or cache expiry can legitimately change them.

Before activation: migrate Flutter or explicitly exclude it from that deployment,
review these quality findings, run repeated paired tests including a responsive
local model, and approve the default change. No default was changed here.

## Reproduction and rollback

Final checks: 353 server/web tests passed across 49 files; 72 Flutter tests
passed; production build and diff checks passed. The existing generated CSS
`:where()` warning remains. Flutter fixes were test-only viewport scrolling;
its production analyst contract remains unchanged.

```sh
node scripts/measure-analysis-prompt.mjs
# Explicit opt-in; substitute IDs of the providers you intend to test.
node scripts/benchmark-analyst.mjs --live --ids=13,7,8
node scripts/benchmark-analyst.mjs --live --ids=7 --ar
npm test
npm run build
cd flutter_app && flutter test --no-pub
```

Rollback behavior by setting `ANALYST_CONTRACT_VERSION=v2` and restarting the
server. No database migration is required. Git checkpoints preserve the baseline,
Tasks 1–2, Tasks 3–5 and this review stage; do not reset over later user work.

The example environment file now leaves the search-key field empty. A
credential-like sample was removed from it; if it was a genuine key, rotate it
with the service provider because Git history still contains the previous value.
