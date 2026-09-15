import type { DcaPlan } from '../api/dcaPlan';

export type AIConfidenceLevel = 'low' | 'medium' | 'high';

export type AIResult = {
  one_liner?: string;
  confidence?: AIConfidenceLevel;
  confidence_reasons?: string[];
  trends?: string[];
  suggested_weights?: { deesc?: number; base?: number; stag?: number };
  weights_reasoning?: string;
  tranche2?: { verdict?: string; reasoning?: string };
  egp_read?: string;
  wallet_read?: string;
  dca_read?: string;
  watchlist_read?: string;
};

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
  const getStr = (key: string) => {
    const m = clean.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's'));
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : undefined;
  };
  const getArr = (key: string) => {
    const m = clean.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`, 's'));
    if (!m) return undefined;
    const items = m[1].match(/"(?:[^"\\]|\\.)*"/g);
    return items ? items.map((s) => s.slice(1, -1).replace(/\\"/g, '"')) : undefined;
  };
  const result: Record<string, unknown> = {};
  const one_liner = getStr('one_liner');
  const confidence = getStr('confidence');
  const confidence_reasons = getArr('confidence_reasons');
  const trends = getArr('trends');
  const weights_reasoning = getStr('weights_reasoning');
  const egp_read = getStr('egp_read');
  const wallet_read = getStr('wallet_read');
  const dca_read = getStr('dca_read');
  const watchlist_read = getStr('watchlist_read');
  const tranche2Verdict = clean.match(/"verdict"\s*:\s*"([^"]*)"/);
  const tranche2Reasoning = clean.match(/"tranche2"[\s\S]*?"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (one_liner) result.one_liner = one_liner;
  if (confidence) result.confidence = confidence;
  if (confidence_reasons) result.confidence_reasons = confidence_reasons;
  if (trends) result.trends = trends;
  if (weights_reasoning) result.weights_reasoning = weights_reasoning;
  if (egp_read) result.egp_read = egp_read;
  if (wallet_read) result.wallet_read = wallet_read;
  if (dca_read) result.dca_read = dca_read;
  if (watchlist_read) result.watchlist_read = watchlist_read;
  if (tranche2Verdict || tranche2Reasoning) {
    result.tranche2 = {
      verdict: tranche2Verdict?.[1],
      reasoning: tranche2Reasoning?.[1]?.replace(/\\"/g, '"'),
    };
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function normalizeAIResult(payload: unknown, fallback: AIResult): AIResult {
  if (!payload || typeof payload !== 'object') return fallback;
  const source = payload as Record<string, any>;
  const oneLiner = typeof source.one_liner === 'string' && source.one_liner.trim() ? source.one_liner : fallback.one_liner;
  const confidence = source.confidence === 'low' || source.confidence === 'medium' || source.confidence === 'high' ? source.confidence : fallback.confidence;
  const confidenceReasons = Array.isArray(source.confidence_reasons) && source.confidence_reasons.some((item: unknown) => typeof item === 'string' && item.trim())
    ? source.confidence_reasons.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : fallback.confidence_reasons;
  const trends = Array.isArray(source.trends) && source.trends.some((item: unknown) => typeof item === 'string' && item.trim())
    ? source.trends.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : fallback.trends;
  const suggestedWeights = source.suggested_weights && typeof source.suggested_weights === 'object'
    ? {
        deesc: typeof source.suggested_weights.deesc === 'number' ? source.suggested_weights.deesc : fallback.suggested_weights?.deesc,
        base: typeof source.suggested_weights.base === 'number' ? source.suggested_weights.base : fallback.suggested_weights?.base,
        stag: typeof source.suggested_weights.stag === 'number' ? source.suggested_weights.stag : fallback.suggested_weights?.stag,
      }
    : fallback.suggested_weights;
  const tranche2 = source.tranche2 && typeof source.tranche2 === 'object'
    ? {
        verdict: typeof source.tranche2.verdict === 'string' ? source.tranche2.verdict : fallback.tranche2?.verdict,
        reasoning: typeof source.tranche2.reasoning === 'string' ? source.tranche2.reasoning : fallback.tranche2?.reasoning,
      }
    : fallback.tranche2;
  const egpRead = typeof source.egp_read === 'string' && source.egp_read.trim() ? source.egp_read : fallback.egp_read;
  const walletRead = typeof source.wallet_read === 'string' && source.wallet_read.trim() ? source.wallet_read : fallback.wallet_read;
  const dcaRead = typeof source.dca_read === 'string' && source.dca_read.trim() ? source.dca_read : fallback.dca_read;
  const watchlistRead = typeof source.watchlist_read === 'string' && source.watchlist_read.trim() ? source.watchlist_read : fallback.watchlist_read;
  const weightsReasoning = typeof source.weights_reasoning === 'string' && source.weights_reasoning.trim() ? source.weights_reasoning : fallback.weights_reasoning;
  return {
    one_liner: oneLiner,
    confidence,
    confidence_reasons: confidenceReasons,
    trends,
    suggested_weights: suggestedWeights,
    weights_reasoning: weightsReasoning,
    tranche2,
    egp_read: egpRead,
    wallet_read: walletRead,
    dca_read: dcaRead,
    watchlist_read: watchlistRead,
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
}): AIResult {
  const { lang, weights, spot, weightedTarget, walletHasHoldings, walletIntlValue, walletEgyptValue, monitors, dcaPlanData } = input;
  const deltaPct = ((weightedTarget - spot) / spot) * 100;
  const deesc = Math.max(10, Math.min(90, Math.round(weights.deesc + (deltaPct > 0 ? 5 : -3))));
  const base = Math.max(10, Math.min(90, Math.round(weights.base - (deltaPct > 0 ? 2 : 1))));
  const stag = 100 - deesc - base;
  const fallback = {
    confidence: 'low' as const,
    confidence_reasons: lang === 'ar'
      ? ['ده تحليل بديل محلي بدون بحث لحظي — مش من نموذج الذكاء الاصطناعي.']
      : ['This is a local fallback analysis with no live research behind it — not a model-generated read.'],
    one_liner: lang === 'ar'
      ? `الوضع الحالي للتحوط متوازن، لكن السعر ${deltaPct >= 0 ? 'فوق' : 'تحت'} الهدف المرجح — وده يفتح نافذة للتدخل المنضبط.`
      : `The hedge is still balanced, but spot is ${deltaPct >= 0 ? 'above' : 'below'} the weighted target, which opens a window for disciplined entry.`,
    trends: lang === 'ar'
      ? [
          'الذهب ما زال يعتمد على توجيه الفيدرالي والمشهد الجيوسياسي العالمي.',
          'الضغط على الجنيه يرفع قيمة الموقف بالجنيه حتى لو بقي الذهب العالمي ثابتًا.',
          'التركيز ينقلب إلى ما إذا كان السعر يثبت فوق الهدف المرجح أو يعيد اختبار القاع.',
        ]
      : [
          'Gold is still reacting to Fed messaging and the broader geopolitical landscape.',
          'Pound weakness is increasing the EGP value of the hedge even if spot is flat.',
          'The key question is whether price can hold above the weighted target or retest lower levels.',
        ],
    suggested_weights: { deesc, base: Math.max(1, base), stag: Math.max(1, stag) },
    weights_reasoning: lang === 'ar'
      ? 'تم اختيار هذه الأوزان بناءً على موقع السعر الحالي مقابل الهدف المرجح، مع البقاء متحفظًا في السيناريو الأكثر تشاؤمًا.'
      : 'These weights were chosen from the current position versus the weighted target, with a slightly more defensive stance in the downside case.',
    tranche2: {
      verdict: deltaPct >= 0 ? 'partial' : 'deploy',
      reasoning: lang === 'ar'
        ? 'لو بقي السعر فوق الهدف المرجح لمدة عدة ساعات، يمكن الدخول جزئيًا؛ وإذا انخفض أكثر من المتوقع، فالأفضل الدخول الآن مع حد خسارة واضح.'
        : 'If price holds above the weighted target for a few sessions, a partial entry makes sense; if it breaks lower, deploy sooner with a clear risk limit.',
    },
    egp_read: lang === 'ar'
      ? 'الجانب الجنيهى يحافظ على فعالية التحوط حتى لو ظل الذهب العالمي ثابتًا، لأن أي ضعف في الجنيه يزيد القيمة بالعملة المحلية.'
      : 'The EGP layer is still supporting the hedge even if spot is flat, because a softer pound raises the local-currency value of the position.',
    wallet_read: walletHasHoldings
      ? (lang === 'ar'
          ? `محفظتك الحالية بتساوي دلوقتي حوالي ${fmt(walletIntlValue)} جنيه بالسعر العالمي${walletEgyptValue !== null ? ` و${fmt(walletEgyptValue)} جنيه بسعر السوق المصري الحي` : ''}. مع السعر الحالي ${deltaPct >= 0 ? 'فوق' : 'تحت'} هدفك المرجح، ده وقت معقول إنك ${deltaPct >= 0 ? 'تستحمل الموقف كما هو' : 'تضيف عليه لو خطتك بتسمح'}.`
          : `Your current wallet is worth about ${fmt(walletIntlValue)} EGP at the international price${walletEgyptValue !== null ? ` and ${fmt(walletEgyptValue)} EGP at the live Egyptian market price` : ''}. With spot currently ${deltaPct >= 0 ? 'above' : 'below'} your weighted target, this is a reasonable time to ${deltaPct >= 0 ? 'hold what you have' : 'add to it if your plan allows'}.`)
      : undefined,
    dca_read: dcaPlanData
      ? (lang === 'ar'
          ? 'ده تحليل بديل محلي — راجع تبويب خطة الدخول التدريجي مباشرة عشان تعرف حالة الدفعة الحالية.'
          : 'This is a local fallback analysis — check the DCA Plan tab directly for your current tranche status.')
      : undefined,
    watchlist_read: monitors.length > 0
      ? (() => {
          const names = (sig: 0 | 1 | 2) => monitors.filter((m) => m.sig === sig).map((m) => (lang === 'ar' ? m.ar : m.en));
          const supportive = names(0);
          const risk = names(2);
          if (lang === 'ar') {
            return `${supportive.length ? `المتغيرات الداعمة (${supportive.join('، ')}) بتميل ناحية السيناريوهات الإيجابية.` : 'مفيش متغيرات داعمة واضحة دلوقتي.'} ${risk.length ? `والمتغيرات اللي فيها خطر (${risk.join('، ')}) بتحط ضغط على السيناريو المتشائم — راقبها كويس.` : 'مفيش متغيرات خطر واضحة دلوقتي.'}`;
          }
          return `${supportive.length ? `Supportive variables (${supportive.join(', ')}) lean toward the upside scenarios.` : 'No clearly supportive variables right now.'} ${risk.length ? `Risk-flagged variables (${risk.join(', ')}) are pressuring the downside case — keep an eye on them.` : 'No clearly risky variables right now.'}`;
        })()
      : undefined,
  };
  return fallback;
}
