import type { DcaPlan } from '../api/dcaPlan';
import type { AnalysisSnapshot } from './analysisSnapshot';

export type AIConfidenceLevel = 'low' | 'medium' | 'high';

export type ClaimField = { text: string; evidence_ids: string[] };

export type HorizonKey = 'now' | 'next_event' | 'strategic';

export type PrimaryDecisionAction = 'buy' | 'hold' | 'wait' | 'reduce' | 'review' | 'insufficient_evidence';

export type PrimaryDecision = {
  action: PrimaryDecisionAction;
  horizon: HorizonKey;
  headline: string;
  confidence: AIConfidenceLevel;
  reasons: ClaimField[];
};

export type HorizonAction = {
  horizon: HorizonKey;
  action: string;
  condition: string;
};

export type AIResultV2 = {
  schema_version: '2';
  primary_decision: PrimaryDecision;
  horizon_actions: HorizonAction[];
  suggested_weights: { deesc: number; base: number; stag: number };
  weights_reasoning: ClaimField;
  egp_read: ClaimField;
  wallet_read?: ClaimField;
  dca_read?: ClaimField;
  watchlist_read?: ClaimField;
  assumptions: string[];
  missing_inputs: string[];
};

export function buildAnalysisPrompt(
  snapshot: AnalysisSnapshot,
  watchlist: { id: string; label: string; signal: 'supportive' | 'watch' | 'risk' }[]
): string {
  const lang = snapshot.locale;
  const langName = lang === 'ar' ? 'Egyptian colloquial Arabic (مصري)' : 'English';
  const beginner = snapshot.explanation_level === 'beginner';
  const egyptContext = snapshot.egypt;
  const walletContext = snapshot.wallet.has_holdings;
  const dcaContext = snapshot.dca;
  const watchNames = watchlist.map((w) => `${w.label}=${w.signal}`).join(', ');

  const lines: string[] = [];
  lines.push(
    `You are a senior precious-metals strategist advising a Cairo-based CIO. Treat the following DATA SNAPSHOT as ground truth — it was computed by the application, not you; never recompute, override, or second-guess any number in it. Cite it, don't derive from it: ${JSON.stringify(snapshot)}`
  );
  lines.push(
    `Use your live web search to check whether real current events still support the scenario weights in the snapshot, or whether the balance between the three scenarios has genuinely shifted. Specifically verify, don't assume from memory: the current status of any active armed conflict or military strikes (not just diplomatic tension) involving Iran, Russia/Ukraine, or any other major flashpoint; whether oil/gas shipping chokepoints (Strait of Hormuz, Red Sea/Bab-el-Mandeb) are open, restricted, or under attack right now; any new sanctions; Fed policy moves; central-bank gold buying; and EGP moves. A ceasefire, deal, or truce you remember from training may have already collapsed — search for its current state rather than assuming it held. Your suggested_weights must reflect this reassessment, not just restate the snapshot's current weights.`
  );
  lines.push(
    `WATCHLIST — treat this as a primary input alongside your own research, not background color. Weigh supportive items toward the scenario they favor and risk items away from it; let them materially move both suggested_weights and primary_decision: ${watchNames || '(none provided)'}. Write watchlist_read as an explicit, named walk-through of these specific variables — call out which ones are currently supportive vs. risk, whether your live research still backs the user's current signal on each, and flag any where you think the user's own color-coding looks stale or wrong given what you found.`
  );
  if (egyptContext) {
    lines.push(
      `Use the snapshot's "egypt" section (live retail prices, EGP per gram) to ground your egp_read specifically in what a buyer/seller sees in the Egyptian market right now, not just the theoretical USD/EGP conversion. The snapshot already computes implied_gold_market_usd_egp and local_premium_pct for you — cite them, don't recompute them.`
    );
  }
  if (walletContext) {
    lines.push(
      `Use the snapshot's "wallet" section (what he actually owns today, and its computed value) to write wallet_read as a fresh re-evaluation of THIS SPECIFIC holding given today's read — is it well-positioned given the scenario reassessment above, should he add, hold, or trim, and note if the international and Egyptian-market valuations of it diverge meaningfully.`
    );
  }
  if (dcaContext) {
    lines.push(
      `Use the snapshot's "dca" section (his actual installment status and cost basis) to write dca_read as a concrete recommendation tied to that ACTUAL status — if a tranche window is open (status=open_now), say so explicitly and whether today's read supports executing it on schedule or waiting a few days within the window; if the next window is in the future (status=next_window), say there's no action needed yet; reference his real average cost basis if given, and never suggest a deployment size beyond what his stated investment plan actually allows.`
    );
  }
  lines.push(
    `ANALYSIS DEPTH AND STYLE — this is a hard requirement, not a style suggestion: you are advising this specific person on this specific decision, not compiling a briefing. Every field must be grounded in specific facts you found in this search (named events, exact figures, dates, levels) — never a vague, generic statement like "geopolitical tensions" with nothing concrete behind it. But citing a fact is not the goal — explaining what it means for the reader is. For every fact you use, state its implication for the reader's position in the same sentence or the one right after it; never list findings as a headline feed. Pick the 2-3 developments that actually move the reader's decision and explain those well, rather than cataloguing everything you found. ${
      beginner
        ? 'Explain those specifics in simple everyday language a non-expert can follow — plain words, no jargon — but still name the actual events and numbers, and always close the loop with what it means for him in EGP terms.'
        : 'Apply institutional-grade discipline: treat only what you verified via search as fact, mark anything else as background. Prioritize the Egyptian-market angle throughout — the local premium over the international price and the implied "souq-dollar" vs. the official EGP rate — since that\'s the layer the user actually holds. Write like an expert advising a client face-to-face: lead with the call, back it with the minimum evidence needed to justify it, and skip any fact that doesn\'t change what he should do. No filler, no restated caveats, no headline-dumping.'
    }`
  );
  lines.push(
    `CITATIONS — every ClaimField's "text" that states a number, percentage, price, or dated event must have that claim's supporting evidence_id(s) (as given to you in the search results, formatted like "EV-001") in that field's "evidence_ids" array. A field whose text makes no time-sensitive claim may have an empty evidence_ids array — but never leave evidence_ids empty when the text asserts a specific number, percentage, price, or dated event.`
  );
  lines.push(
    `Write every string VALUE in ${langName} — the whole analysis, every sentence, must be in ${langName}, no English mixed in unless it's a ticker/number. Respond with ONLY a single JSON object, no markdown code fences, matching EXACTLY this schema and these key names in English (the KEYS stay in English exactly as shown, only the VALUES are translated, no other keys, no nested wrapper object):`
  );

  const schemaLines: string[] = [];
  schemaLines.push(`  "schema_version": "2",`);
  schemaLines.push(`  "primary_decision": {`);
  schemaLines.push(`    "action": "<one of exactly: buy | hold | wait | reduce | review | insufficient_evidence>",`);
  schemaLines.push(`    "horizon": "<one of exactly: now | next_event | strategic — which horizon this call is for>",`);
  schemaLines.push(`    "headline": "<one-sentence bottom-line: what he should do right now, and the single biggest reason why, in ${langName}>",`);
  schemaLines.push(`    "confidence": "<one of exactly: low | medium | high — NEVER an invented percentage like '85%'. Base this on: how fresh and mutually agreeing your search evidence is, whether the watchlist/wallet/DCA context you were given is complete, and whether the scenarios still disagree sharply with what you found>",`);
  schemaLines.push(`    "reasons": [{ "text": "<1-3 entries, each the event AND what it means for him, in ${langName}>", "evidence_ids": ["<EV-XXX ids or []>"] }]`);
  schemaLines.push(`  },`);
  schemaLines.push(
    `  "horizon_actions": [{ "horizon": "<now|next_event|strategic>", "action": "<what to do at this horizon, in ${langName}>", "condition": "<what would trigger this, in ${langName}>" }]`
  );
  schemaLines.push(`  ,"suggested_weights": { "deesc": <number 0-100>, "base": <number 0-100>, "stag": <number 0-100> },`);
  schemaLines.push(
    `  "weights_reasoning": { "text": "<why these weights, explained as cause-and-effect from what changed — not a recap of facts already stated elsewhere, in ${langName}>", "evidence_ids": ["<EV-XXX ids or []>"] },`
  );
  schemaLines.push(
    `  "egp_read": { "text": "<how the EGP side of the hedge is doing, in ${langName}>", "evidence_ids": ["<EV-XXX for every number/date/event stated above, or [] if none>"] }`
  );
  if (walletContext) {
    schemaLines.push(
      `  ,"wallet_read": { "text": "<re-evaluation of his physical wallet given today's read, in ${langName}>", "evidence_ids": ["<EV-XXX ids or []>"] }`
    );
  }
  if (dcaContext) {
    schemaLines.push(
      `  ,"dca_read": { "text": "<concrete DCA recommendation tied to his actual installment status and cost basis, in ${langName}>", "evidence_ids": ["<EV-XXX ids or []>"] }`
    );
  }
  if (watchlist.length > 0) {
    schemaLines.push(
      `  ,"watchlist_read": { "text": "<named walk-through of the watchlist variables and whether your research still backs the user's signal on each, in ${langName}>", "evidence_ids": ["<EV-XXX ids or []>"] }`
    );
  }
  schemaLines.push(
    `  ,"assumptions": ["<anything you assumed because the snapshot didn't specify it — an empty array is fine and expected when nothing was assumed>"]`
  );
  schemaLines.push(
    `  ,"missing_inputs": ["<anything you'd need to know to be more confident — an empty array is fine and expected when nothing is missing>"]`
  );

  lines.push(`{\n${schemaLines.join('\n')}\n}`);
  lines.push(
    `The three suggested_weights values must sum to 100. If your action differs across the now/next_event/strategic horizons, list each differing horizon in horizon_actions with its own action and the condition that would trigger a shift; if they don't differ, horizon_actions may be empty or contain one entry restating primary_decision — never contradict primary_decision without explaining why in weights_reasoning or a horizon_actions entry's condition.`
  );

  return lines.join('\n');
}

function fmt(n: number, d = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function sanitizeJsonText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const withoutCode = trimmed.replace(/```json|```/g, '').trim();
  const start = withoutCode.indexOf('{');
  const end = withoutCode.lastIndexOf('}');
  if (start < 0 || end <= start) return withoutCode;
  return withoutCode.slice(start, end + 1);
}

export function tryParseJson(text: string) {
  const sanitized = sanitizeJsonText(text);
  try {
    return JSON.parse(sanitized);
  } catch {
    const repaired = sanitized
      .replace(/([{,]\s*)([A-Za-z0-9_]+)(\s*:)/g, '$1"$2"$3')
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/\b(true|false|null)\b/g, (m) => m.toLowerCase());
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

export function stripJsonFences(text: string) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

export function extractFieldsFromBrokenJson(text: string): Record<string, unknown> | null {
  const clean = stripJsonFences(text);
  // Salvage a top-level-string-valued ClaimField's ".text" by scoping the
  // match to start at the field's own key, following the same
  // `"tranche2"[\s\S]*?"reasoning"` scoping pattern this function has always
  // used to avoid matching an unrelated field's "text" key.
  const getClaimFieldText = (key: string) => {
    const m = clean.match(new RegExp(`"${key}"[\\s\\S]*?"text"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : undefined;
  };
  const result: Record<string, unknown> = {};

  // primary_decision.headline / .action — scoped nested regex, modeled on
  // the old tranche2Reasoning pattern (`"tranche2"[\s\S]*?"reasoning"`).
  const primaryHeadline = clean.match(/"primary_decision"[\s\S]*?"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const primaryAction = clean.match(/"primary_decision"[\s\S]*?"action"\s*:\s*"([^"]*)"/);
  if (primaryHeadline || primaryAction) {
    result.primary_decision = {
      headline: primaryHeadline ? primaryHeadline[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : undefined,
      action: primaryAction?.[1],
    };
  }

  // Claim-field ".text" values only — evidence_ids can't be reliably
  // salvaged from broken JSON, so every salvaged claim field gets
  // evidence_ids: [], which downstream validation will correctly treat as
  // unsupported if the text asserts a number/claim.
  const weightsReasoningText = getClaimFieldText('weights_reasoning');
  if (weightsReasoningText) result.weights_reasoning = { text: weightsReasoningText, evidence_ids: [] };
  const egpReadText = getClaimFieldText('egp_read');
  if (egpReadText) result.egp_read = { text: egpReadText, evidence_ids: [] };
  const walletReadText = getClaimFieldText('wallet_read');
  if (walletReadText) result.wallet_read = { text: walletReadText, evidence_ids: [] };
  const dcaReadText = getClaimFieldText('dca_read');
  if (dcaReadText) result.dca_read = { text: dcaReadText, evidence_ids: [] };
  const watchlistReadText = getClaimFieldText('watchlist_read');
  if (watchlistReadText) result.watchlist_read = { text: watchlistReadText, evidence_ids: [] };

  return Object.keys(result).length > 0 ? result : null;
}

const ALLOWED_ACTIONS: PrimaryDecisionAction[] = ['buy', 'hold', 'wait', 'reduce', 'review', 'insufficient_evidence'];
const ALLOWED_HORIZONS: HorizonKey[] = ['now', 'next_event', 'strategic'];
const ALLOWED_CONFIDENCE: AIConfidenceLevel[] = ['low', 'medium', 'high'];

function isEvidenceIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// A ClaimField is valid only if `text` is a non-empty string; `evidence_ids`
// defaults to [] if missing/malformed and never fails the whole field.
function normalizeClaimField(raw: unknown, fallback: ClaimField): ClaimField {
  if (raw && typeof raw === 'object') {
    const source = raw as Record<string, any>;
    if (typeof source.text === 'string' && source.text.trim()) {
      return { text: source.text, evidence_ids: isEvidenceIdArray(source.evidence_ids) ? source.evidence_ids : [] };
    }
  }
  return fallback;
}

function normalizeOptionalClaimField(raw: unknown, fallback: ClaimField | undefined): ClaimField | undefined {
  if (raw && typeof raw === 'object') {
    const source = raw as Record<string, any>;
    if (typeof source.text === 'string' && source.text.trim()) {
      return { text: source.text, evidence_ids: isEvidenceIdArray(source.evidence_ids) ? source.evidence_ids : [] };
    }
  }
  return fallback;
}

function normalizeClaimFieldArray(raw: unknown, fallback: ClaimField[]): ClaimField[] {
  if (!Array.isArray(raw)) return fallback;
  const items = raw
    .map((item): ClaimField | null => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, any>;
      if (typeof source.text !== 'string' || !source.text.trim()) return null;
      return { text: source.text, evidence_ids: isEvidenceIdArray(source.evidence_ids) ? source.evidence_ids : [] };
    })
    .filter((item): item is ClaimField => item !== null);
  return items.length > 0 ? items : fallback;
}

function normalizeHorizonActions(raw: unknown, fallback: HorizonAction[]): HorizonAction[] {
  if (!Array.isArray(raw)) return fallback;
  const items = raw
    .map((item): HorizonAction | null => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, any>;
      if (typeof source.action !== 'string' || !source.action.trim()) return null;
      const horizon: HorizonKey = ALLOWED_HORIZONS.includes(source.horizon) ? source.horizon : 'now';
      return { horizon, action: source.action, condition: typeof source.condition === 'string' ? source.condition : '' };
    })
    .filter((item): item is HorizonAction => item !== null);
  return items.length > 0 ? items : fallback;
}

function normalizePrimaryDecision(raw: unknown, fallback: PrimaryDecision): PrimaryDecision {
  if (!raw || typeof raw !== 'object') return fallback;
  const source = raw as Record<string, any>;
  // action falls back to 'insufficient_evidence' (not the fallback param's
  // action) if the model sent something outside the 6 allowed literals —
  // per the brief, this is the one field with its own hardcoded fallback.
  const action: PrimaryDecisionAction = ALLOWED_ACTIONS.includes(source.action) ? source.action : 'insufficient_evidence';
  const horizon: HorizonKey = ALLOWED_HORIZONS.includes(source.horizon) ? source.horizon : fallback.horizon;
  const headline = typeof source.headline === 'string' && source.headline.trim() ? source.headline : fallback.headline;
  // confidence is parsed here (needed as an input to Task 9's
  // computeConfidence) but must NOT be trusted as the rendered value —
  // Task 9 overwrites it after validation.
  const confidence: AIConfidenceLevel = ALLOWED_CONFIDENCE.includes(source.confidence) ? source.confidence : fallback.confidence;
  const reasons = normalizeClaimFieldArray(source.reasons, fallback.reasons);
  return { action, horizon, headline, confidence, reasons };
}

export function normalizeAIResult(payload: unknown, fallback: AIResultV2): AIResultV2 {
  if (!payload || typeof payload !== 'object') return fallback;
  const source = payload as Record<string, any>;
  const primaryDecision = normalizePrimaryDecision(source.primary_decision, fallback.primary_decision);
  const horizonActions = normalizeHorizonActions(source.horizon_actions, fallback.horizon_actions);
  const suggestedWeights = source.suggested_weights && typeof source.suggested_weights === 'object'
    ? {
        deesc: typeof source.suggested_weights.deesc === 'number' ? source.suggested_weights.deesc : fallback.suggested_weights.deesc,
        base: typeof source.suggested_weights.base === 'number' ? source.suggested_weights.base : fallback.suggested_weights.base,
        stag: typeof source.suggested_weights.stag === 'number' ? source.suggested_weights.stag : fallback.suggested_weights.stag,
      }
    : fallback.suggested_weights;
  const weightsReasoning = normalizeClaimField(source.weights_reasoning, fallback.weights_reasoning);
  const egpRead = normalizeClaimField(source.egp_read, fallback.egp_read);
  const walletRead = normalizeOptionalClaimField(source.wallet_read, fallback.wallet_read);
  const dcaRead = normalizeOptionalClaimField(source.dca_read, fallback.dca_read);
  const watchlistRead = normalizeOptionalClaimField(source.watchlist_read, fallback.watchlist_read);
  const assumptions = isEvidenceIdArray(source.assumptions) ? source.assumptions : fallback.assumptions;
  const missingInputs = isEvidenceIdArray(source.missing_inputs) ? source.missing_inputs : fallback.missing_inputs;
  return {
    schema_version: '2',
    primary_decision: primaryDecision,
    horizon_actions: horizonActions,
    suggested_weights: suggestedWeights,
    weights_reasoning: weightsReasoning,
    egp_read: egpRead,
    wallet_read: walletRead,
    dca_read: dcaRead,
    watchlist_read: watchlistRead,
    assumptions,
    missing_inputs: missingInputs,
  };
}

export function buildFallbackAnalysis(input: {
  lang: 'ar' | 'en';
  weights: { deesc: number; base: number; stag: number };
  spot: number;
  weightedTarget: number;
  walletHasHoldings: boolean;
  walletIntlValue: number;
  walletEgyptValue: number | null;
  monitors: { ar: string; en: string; sig: 0 | 1 | 2 }[];
  dcaPlanData: DcaPlan | null;
}): AIResultV2 {
  const { lang, weights, spot, weightedTarget, walletHasHoldings, walletIntlValue, walletEgyptValue, monitors, dcaPlanData } = input;
  const deltaPct = ((weightedTarget - spot) / spot) * 100;
  // Weight-adjustment heuristic — unrelated to the schema shape, unchanged
  // from the v1 fallback.
  const deesc = Math.max(10, Math.min(90, Math.round(weights.deesc + (deltaPct > 0 ? 5 : -3))));
  const base = Math.max(10, Math.min(90, Math.round(weights.base - (deltaPct > 0 ? 2 : 1))));
  const stag = 100 - deesc - base;

  const disclosureText = lang === 'ar'
    ? 'ده تحليل بديل محلي بدون بحث لحظي — مش من نموذج الذكاء الاصطناعي.'
    : 'This is a local fallback analysis with no live research behind it — not a model-generated read.';
  const headline = lang === 'ar'
    ? `الوضع الحالي للتحوط متوازن، لكن السعر ${deltaPct >= 0 ? 'فوق' : 'تحت'} الهدف المرجح — وده يفتح نافذة للتدخل المنضبط.`
    : `The hedge is still balanced, but spot is ${deltaPct >= 0 ? 'above' : 'below'} the weighted target, which opens a window for disciplined entry.`;
  const trendTexts = lang === 'ar'
    ? [
        'الذهب ما زال يعتمد على توجيه الفيدرالي والمشهد الجيوسياسي العالمي.',
        'الضغط على الجنيه يرفع قيمة الموقف بالجنيه حتى لو بقي الذهب العالمي ثابتًا.',
        'التركيز ينقلب إلى ما إذا كان السعر يثبت فوق الهدف المرجح أو يعيد اختبار القاع.',
      ]
    : [
        'Gold is still reacting to Fed messaging and the broader geopolitical landscape.',
        'Pound weakness is increasing the EGP value of the hedge even if spot is flat.',
        'The key question is whether price can hold above the weighted target or retest lower levels.',
      ];
  const reasons: ClaimField[] = [disclosureText, ...trendTexts].map((text) => ({ text, evidence_ids: [] }));

  const weightsReasoningText = lang === 'ar'
    ? 'تم اختيار هذه الأوزان بناءً على موقع السعر الحالي مقابل الهدف المرجح، مع البقاء متحفظًا في السيناريو الأكثر تشاؤمًا.'
    : 'These weights were chosen from the current position versus the weighted target, with a slightly more defensive stance in the downside case.';

  const egpReadText = lang === 'ar'
    ? 'الجانب الجنيهى يحافظ على فعالية التحوط حتى لو ظل الذهب العالمي ثابتًا، لأن أي ضعف في الجنيه يزيد القيمة بالعملة المحلية.'
    : 'The EGP layer is still supporting the hedge even if spot is flat, because a softer pound raises the local-currency value of the position.';

  const walletReadText = walletHasHoldings
    ? (lang === 'ar'
        ? `محفظتك الحالية بتساوي دلوقتي حوالي ${fmt(walletIntlValue)} جنيه بالسعر العالمي${walletEgyptValue !== null ? ` و${fmt(walletEgyptValue)} جنيه بسعر السوق المصري الحي` : ''}. مع السعر الحالي ${deltaPct >= 0 ? 'فوق' : 'تحت'} هدفك المرجح، ده وقت معقول إنك ${deltaPct >= 0 ? 'تستحمل الموقف كما هو' : 'تضيف عليه لو خطتك بتسمح'}.`
        : `Your current wallet is worth about ${fmt(walletIntlValue)} EGP at the international price${walletEgyptValue !== null ? ` and ${fmt(walletEgyptValue)} EGP at the live Egyptian market price` : ''}. With spot currently ${deltaPct >= 0 ? 'above' : 'below'} your weighted target, this is a reasonable time to ${deltaPct >= 0 ? 'hold what you have' : 'add to it if your plan allows'}.`)
    : null;

  const dcaReadText = dcaPlanData
    ? (lang === 'ar'
        ? 'ده تحليل بديل محلي — راجع تبويب خطة الدخول التدريجي مباشرة عشان تعرف حالة الدفعة الحالية.'
        : 'This is a local fallback analysis — check the DCA Plan tab directly for your current tranche status.')
    : null;

  const watchlistReadText = monitors.length > 0
    ? (() => {
        const names = (sig: 0 | 1 | 2) => monitors.filter((m) => m.sig === sig).map((m) => (lang === 'ar' ? m.ar : m.en));
        const supportive = names(0);
        const risk = names(2);
        if (lang === 'ar') {
          return `${supportive.length ? `المتغيرات الداعمة (${supportive.join('، ')}) بتميل ناحية السيناريوهات الإيجابية.` : 'مفيش متغيرات داعمة واضحة دلوقتي.'} ${risk.length ? `والمتغيرات اللي فيها خطر (${risk.join('، ')}) بتحط ضغط على السيناريو المتشائم — راقبها كويس.` : 'مفيش متغيرات خطر واضحة دلوقتي.'}`;
        }
        return `${supportive.length ? `Supportive variables (${supportive.join(', ')}) lean toward the upside scenarios.` : 'No clearly supportive variables right now.'} ${risk.length ? `Risk-flagged variables (${risk.join(', ')}) are pressuring the downside case — keep an eye on them.` : 'No clearly risky variables right now.'}`;
      })()
    : null;

  return {
    schema_version: '2',
    primary_decision: {
      action: 'insufficient_evidence',
      horizon: 'now',
      headline,
      confidence: 'low',
      reasons,
    },
    horizon_actions: [],
    suggested_weights: { deesc, base: Math.max(1, base), stag: Math.max(1, stag) },
    weights_reasoning: { text: weightsReasoningText, evidence_ids: [] },
    egp_read: { text: egpReadText, evidence_ids: [] },
    wallet_read: walletReadText ? { text: walletReadText, evidence_ids: [] } : undefined,
    dca_read: dcaReadText ? { text: dcaReadText, evidence_ids: [] } : undefined,
    watchlist_read: watchlistReadText ? { text: watchlistReadText, evidence_ids: [] } : undefined,
    assumptions: [],
    missing_inputs: [],
  };
}
