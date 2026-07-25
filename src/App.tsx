import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  activateProvider,
  analyzeViaBackend,
  createProvider,
  deleteProvider,
  listProviders,
  testProvider,
  updateProvider,
  type LlmProvider,
  type LlmProviderInput,
  type ProviderType,
} from './api/llmProviders';
import { fetchEgyptPrices, type EgyptGoldSnapshot } from './api/egyptPrices';

type Theme = 'light' | 'vault';
type Language = 'en' | 'ar';
type MonitorSignal = 0 | 1 | 2;

type Monitor = {
  ar: string;
  en: string;
  sig: MonitorSignal;
};

type AIResult = {
  one_liner?: string;
  trends?: string[];
  suggested_weights?: { deesc?: number; base?: number; stag?: number };
  weights_reasoning?: string;
  tranche2?: { verdict?: string; reasoning?: string };
  egp_read?: string;
};

type TabKey = 'home' | 'market' | 'calc' | 'target' | 'scenarios' | 'egypt' | 'ai' | 'dca' | 'watch' | 'settings';

type AppState = {
  spot: number;
  egp: number;
  prem: number;
  budget: number;
  calcamt: number;
  theme: Theme;
  lang: Language;
  weights: { deesc: number; base: number; stag: number };
  monitors: Monitor[];
  stamp: { cls: string; txt: string | null };
  diag: string;
  goldSource: string;
  aiLevel: 'beginner' | 'expert';
  ai: { loading: boolean; error: string | null; data: AIResult | null; at: string | null; applied: boolean; usedWebSearch: boolean; providerLabel: string | null };
  newMonitor: string;
};

const DEFAULT_MONITORS: Monitor[] = [
  { ar: 'اتفاق إيران', en: 'Iran deal', sig: 1 },
  { ar: 'الفيدرالي', en: 'Fed signals', sig: 2 },
  { ar: 'الجنيه / الدولار', en: 'EGP / USD', sig: 1 },
  { ar: 'التضخم الأساسي', en: 'Core PCE', sig: 1 },
  { ar: 'البنوك المركزية', en: 'CB buying', sig: 0 },
];

const SCEN_META = [
  { key: 'deesc' as const, lo: 5800, hi: 6300, color: '#4E8F7B' },
  { key: 'base' as const, lo: 5000, hi: 5400, color: '#C9A227' },
  { key: 'stag' as const, lo: 3600, hi: 4000, color: '#B4482E' },
];
const SIGCOL = ['#4E8F7B', '#C9A227', '#B4482E'];
const OZ = 31.1035;

const EGYPT_KARAT_LABEL: Record<EgyptGoldSnapshot['rows'][number]['karat'], (t: (typeof T)['ar'] | (typeof T)['en']) => string> = {
  '24k': (t) => t.k24,
  '22k': (t) => t.k22,
  '21k': (t) => t.k21,
  '18k': (t) => t.k18,
  gold_pound: (t) => t.gp,
};

const defaultState: AppState = {
  spot: 4060,
  egp: 49.2,
  prem: 3,
  budget: 300000,
  calcamt: 50000,
  theme: 'light',
  lang: 'ar',
  weights: { deesc: 35, base: 45, stag: 20 },
  monitors: DEFAULT_MONITORS.map((m) => ({ ...m })),
  stamp: { cls: '', txt: null },
  diag: '',
  goldSource: '',
  aiLevel: 'beginner',
  ai: { loading: false, error: null, data: null, at: null, applied: false, usedWebSearch: false, providerLabel: null },
  newMonitor: '',
};

const STORAGE_KEY = 'gold-cockpit-state-v1';
const MONITORS_KEY = 'ghc_monitors';
const LEVEL_KEY = 'ghc_level';

function normNum(value: unknown) {
  return parseFloat(
    String(value)
      .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c).toString())
      .replace(/[،,\s]/g, ''),
  ) || 0;
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

function tryParseJson(text: string) {
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

function normalizeAIResult(payload: unknown, fallback: AIResult): AIResult {
  if (!payload || typeof payload !== 'object') return fallback;
  const source = payload as Record<string, any>;
  const oneLiner = typeof source.one_liner === 'string' && source.one_liner.trim() ? source.one_liner : fallback.one_liner;
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
  const weightsReasoning = typeof source.weights_reasoning === 'string' && source.weights_reasoning.trim() ? source.weights_reasoning : fallback.weights_reasoning;
  return {
    one_liner: oneLiner,
    trends,
    suggested_weights: suggestedWeights,
    weights_reasoning: weightsReasoning,
    tranche2,
    egp_read: egpRead,
  };
}

function loadState(): AppState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    const monitorsRaw = window.localStorage.getItem(MONITORS_KEY);
    const monitors = monitorsRaw ? JSON.parse(monitorsRaw) : DEFAULT_MONITORS.map((m) => ({ ...m }));
    const aiLevel = (window.localStorage.getItem(LEVEL_KEY) as AppState['aiLevel'] | null) || 'beginner';
    return {
      ...defaultState,
      ...saved,
      monitors: Array.isArray(monitors) && monitors.length ? monitors : DEFAULT_MONITORS.map((m) => ({ ...m })),
      aiLevel,
    };
  } catch {
    return defaultState;
  }
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [watchApplied, setWatchApplied] = useState(false);
  const [egypt, setEgypt] = useState<{ loading: boolean; error: string | null; data: EgyptGoldSnapshot | null }>({
    loading: false,
    error: null,
    data: null,
  });

  const loadEgyptPrices = () => {
    setEgypt((prev) => ({ ...prev, loading: true, error: null }));
    fetchEgyptPrices()
      .then((data) => setEgypt({ loading: false, error: null, data }))
      .catch((error) => setEgypt({ loading: false, error: error instanceof Error ? error.message : 'failed', data: null }));
  };

  useEffect(() => {
    if (activeTab === 'egypt' && !egypt.data && !egypt.loading && !egypt.error) {
      loadEgyptPrices();
    }
  }, [activeTab]);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ loading: boolean; ok: boolean | null; message: string }>({
    loading: false,
    ok: null,
    message: '',
  });
  const [providerForm, setProviderForm] = useState<LlmProviderInput & { id: number | null }>({
    id: null,
    provider_type: 'ollama',
    label: '',
    base_url: 'http://localhost:11434/v1',
    api_key: '',
    model: '',
  });

  const refreshProviders = () => {
    listProviders().then(setProviders).catch(() => {});
  };

  useEffect(() => {
    refreshProviders();
  }, []);

  const resetProviderForm = () => {
    setProviderForm({ id: null, provider_type: 'ollama', label: '', base_url: 'http://localhost:11434/v1', api_key: '', model: '' });
    setTestStatus({ loading: false, ok: null, message: '' });
  };

  const editProvider = (provider: LlmProvider) => {
    setProviderForm({
      id: provider.id,
      provider_type: provider.provider_type,
      label: provider.label,
      base_url: provider.base_url ?? '',
      api_key: '',
      model: provider.model,
    });
    setTestStatus({ loading: false, ok: null, message: '' });
  };

  const normalizedProviderFields = () => ({
    provider_type: providerForm.provider_type,
    base_url: (providerForm.provider_type === 'ollama' || providerForm.provider_type === 'custom')
      ? (providerForm.base_url || null)
      : null,
    api_key: providerForm.provider_type === 'ollama' ? null : (providerForm.api_key || null),
    model: providerForm.model,
  });

  const testConnection = async () => {
    setTestStatus({ loading: true, ok: null, message: '' });
    try {
      const result = await testProvider(normalizedProviderFields());
      setTestStatus({ loading: false, ok: true, message: result.text.slice(0, 200) });
    } catch (err) {
      setTestStatus({ loading: false, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  };

  const saveProvider = async () => {
    setProviderError(null);
    if (!providerForm.label.trim() || !providerForm.model.trim()) {
      setProviderError(t.settingsValidationError);
      return;
    }
    const input: LlmProviderInput = {
      ...normalizedProviderFields(),
      label: providerForm.label,
    };
    try {
      if (providerForm.id === null) {
        await createProvider(input);
      } else {
        await updateProvider(providerForm.id, input);
      }
      resetProviderForm();
      refreshProviders();
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeProvider = async (id: number) => {
    setProviderError(null);
    try {
      await deleteProvider(id);
      refreshProviders();
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : String(err));
    }
  };

  const activate = async (id: number) => {
    setProviderError(null);
    try {
      await activateProvider(id);
      refreshProviders();
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : String(err));
    }
  };

  const activeProvider = providers.find((p) => p.is_active) || null;
  const providerTypeLabel = (type: ProviderType) =>
    ({ ollama: t.settingsTypeOllama, openai: t.settingsTypeOpenAI, claude: t.settingsTypeClaude, custom: t.settingsTypeCustom }[type]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(MONITORS_KEY, JSON.stringify(state.monitors));
    window.localStorage.setItem(LEVEL_KEY, state.aiLevel);
  }, [state]);

  const t = useMemo(() => (state.lang === 'ar' ? T.ar : T.en), [state.lang]);
  const weighted = useMemo(() => SCEN_META.reduce((sum, scenario) => sum + (state.weights[scenario.key] / 100) * ((scenario.lo + scenario.hi) / 2), 0), [state.weights]);
  const delta = useMemo(() => ((weighted - state.spot) / state.spot) * 100, [weighted, state.spot]);
  const g24 = useMemo(() => (state.spot / OZ) * state.egp * (1 + state.prem / 100), [state.spot, state.egp, state.prem]);
  const g21 = useMemo(() => g24 * 0.875, [g24]);
  const g18 = useMemo(() => g24 * 0.75, [g24]);
  const pound = useMemo(() => g21 * 8, [g21]);
  const ozEgp = useMemo(() => state.spot * state.egp, [state.spot, state.egp]);
  const inBand = useMemo(() => SCEN_META.some((scenario) => state.spot >= scenario.lo && state.spot <= scenario.hi), [state.spot]);
  const watchlistCounts = useMemo(() => ({
    support: state.monitors.filter((m) => m.sig === 0).length,
    monitor: state.monitors.filter((m) => m.sig === 1).length,
    risk: state.monitors.filter((m) => m.sig === 2).length,
  }), [state.monitors]);
  const watchlistImpliedWeights = useMemo(() => {
    const total = state.monitors.length || 1;
    const net = (watchlistCounts.support - watchlistCounts.risk) / total;
    const nudge = Math.max(-18, Math.min(18, Math.round(net * 20)));
    const deesc = Math.max(2, Math.min(96, 35 + nudge));
    const stag = Math.max(2, Math.min(96, 20 - nudge));
    const base = 100 - deesc - stag;
    return { deesc, base, stag };
  }, [state.monitors, watchlistCounts]);
  const karatRows = useMemo(() => [
    { k: t.k24, f: 1, hl: true },
    { k: t.k22, f: 22 / 24, hl: false },
    { k: t.k21, f: 0.875, hl: true },
    { k: t.k18, f: 0.75, hl: false },
  ], [t]);
  const trancheStatus = ['done', 'active', 'pending'] as const;
  const tranchePct = [40, 35, 25];

  const setWeight = (key: 'deesc' | 'base' | 'stag', value: number) => {
    const safe = Math.min(96, Math.max(2, value));
    const others = (['deesc', 'base', 'stag'] as const).filter((item) => item !== key);
    const rest = 100 - safe;
    const sum = others.reduce((acc, item) => acc + state.weights[item], 0) || 1;
    const next = { [key]: safe } as Record<string, number>;
    let acc = 0;
    others.forEach((item, index) => {
      const computed = index === others.length - 1 ? rest - acc : Math.round((state.weights[item] / sum) * rest);
      next[item] = Math.max(1, computed);
      acc += next[item];
    });
    setState((prev) => ({ ...prev, weights: { deesc: next.deesc, base: next.base, stag: next.stag } }));
  };

  const applyWatchlistWeights = () => {
    setState((prev) => ({ ...prev, weights: { ...watchlistImpliedWeights } }));
    setWatchApplied(true);
  };

  const cycleSignal = (index: number) => {
    setState((prev) => ({
      ...prev,
      monitors: prev.monitors.map((monitor, monitorIndex) => monitorIndex === index ? { ...monitor, sig: ((monitor.sig + 1) % 3) as MonitorSignal } : monitor),
    }));
    setWatchApplied(false);
  };

  const delMonitor = (index: number) => {
    setState((prev) => ({ ...prev, monitors: prev.monitors.filter((_, monitorIndex) => monitorIndex !== index) }));
    setWatchApplied(false);
  };

  const addMonitor = () => {
    const name = state.newMonitor.trim().slice(0, 40);
    if (!name) return;
    setState((prev) => ({ ...prev, monitors: [...prev.monitors, { ar: name, en: name, sig: 1 }], newMonitor: '' }));
    setWatchApplied(false);
  };

  const toggleLang = () => {
    setState((prev) => ({ ...prev, lang: prev.lang === 'ar' ? 'en' : 'ar' }));
  };

  const updateNumber = (field: 'spot' | 'egp' | 'prem' | 'budget' | 'calcamt', raw: string) => {
    setState((prev) => ({ ...prev, [field]: normNum(raw) }));
  };

  const withTimeout = (promise: Promise<any>, ms = 6000) => Promise.race([promise, new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), ms))]);

  const pullLive = async () => {
    const diagArr: string[] = [];
    setState((prev) => ({ ...prev, stamp: { cls: '', txt: 'Contacting feeds…' }, diag: '', ai: { ...prev.ai, error: null } }));
    const goldFeeds = [
      { name: 'gold-api', fn: async () => {
        const r = await fetch('https://api.gold-api.com/price/XAU');
        const j = await r.json();
        return Number(j.price);
      } },
      { name: 'goldprice.org', fn: async () => {
        const r = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
        const j = await r.json();
        return Number(j?.items?.[0]?.xauPrice);
      } },
      { name: 'binance-paxg', fn: async () => {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
        const j = await r.json();
        return Number(j.price);
      } },
      { name: 'jsdelivr-daily', fn: async () => {
        const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
        const j = await r.json();
        const perUsd = Number(j?.usd?.xau);
        return perUsd ? 1 / perUsd : 0;
      } },
    ];

    let goldValue = 0;
    let goldSource = '';
    for (const feed of goldFeeds) {
      try {
        const value = await withTimeout(feed.fn());
        if (value && value > 1000 && value < 20000) {
          goldValue = value;
          goldSource = feed.name;
          diagArr.push(`${feed.name}: OK ($${Math.round(value)})`);
          break;
        }
        diagArr.push(`${feed.name}: bad value`);
      } catch (error) {
        diagArr.push(`${feed.name}: ${(error as Error).message || 'error'}`);
      }
    }

    let fxValue = 0;
    try {
      const r = await withTimeout(fetch('https://open.er-api.com/v6/latest/USD'));
      const j = await r.json();
      fxValue = Number(j?.rates?.EGP);
      if (fxValue && fxValue > 20 && fxValue < 200) {
        diagArr.push(`er-api FX: OK (${fxValue.toFixed(2)})`);
      } else {
        throw new Error('bad value');
      }
    } catch {
      try {
        const r2 = await withTimeout(fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'));
        const j2 = await r2.json();
        fxValue = Number(j2?.usd?.egp);
        if (fxValue && fxValue > 20 && fxValue < 200) {
          diagArr.push(`jsdelivr FX: OK (${fxValue.toFixed(2)})`);
        } else {
          throw new Error('bad value');
        }
      } catch {
        diagArr.push('FX feeds failed');
      }
    }

    setState((prev) => ({
      ...prev,
      spot: goldValue ? Math.round(goldValue) : prev.spot,
      egp: fxValue ? Math.round(fxValue * 100) / 100 : prev.egp,
      goldSource,
      stamp: goldValue && fxValue ? { cls: 'ok', txt: `Live via ${goldSource} · ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` } : { cls: 'err', txt: 'Partial — feeds failed' },
      diag: diagArr.join('\n'),
    }));
  };

  const applyAI = () => {
    const sw = state.ai.data?.suggested_weights;
    if (!sw) return;
    let deesc = Math.round(sw.deesc || 0);
    let base = Math.round(sw.base || 0);
    let stag = Math.round(sw.stag || 0);
    const sum = deesc + base + stag;
    if (sum !== 100 && sum > 0) stag = 100 - deesc - base;
    setState((prev) => ({ ...prev, weights: { deesc: Math.max(1, deesc), base: Math.max(1, base), stag: Math.max(1, stag) }, ai: { ...prev.ai, applied: true } }));
  };

  const buildFallbackAnalysis = (weightedTarget: number) => {
    const deltaPct = ((weightedTarget - state.spot) / state.spot) * 100;
    const deesc = Math.max(10, Math.min(90, Math.round(state.weights.deesc + (deltaPct > 0 ? 5 : -3))));
    const base = Math.max(10, Math.min(90, Math.round(state.weights.base - (deltaPct > 0 ? 2 : 1))));
    const stag = 100 - deesc - base;
    const fallback = {
      one_liner: state.lang === 'ar'
        ? `الوضع الحالي للتحوط متوازن، لكن السعر ${deltaPct >= 0 ? 'فوق' : 'تحت'} الهدف المرجح — وده يفتح نافذة للتدخل المنضبط.`
        : `The hedge is still balanced, but spot is ${deltaPct >= 0 ? 'above' : 'below'} the weighted target, which opens a window for disciplined entry.`,
      trends: state.lang === 'ar'
        ? [
            'الذهب ما زال يعتمد على توجيه الفيدرالي وملف إيران.',
            'الضغط على الجنيه يرفع قيمة الموقف بالجنيه حتى لو بقي الذهب العالمي ثابتًا.',
            'التركيز ينقلب إلى ما إذا كان السعر يثبت فوق الهدف المرجح أو يعيد اختبار القاع.',
          ]
        : [
            'Gold is still reacting to Fed messaging and the Iran story.',
            'Pound weakness is increasing the EGP value of the hedge even if spot is flat.',
            'The key question is whether price can hold above the weighted target or retest lower levels.',
          ],
      suggested_weights: { deesc, base: Math.max(1, base), stag: Math.max(1, stag) },
      weights_reasoning: state.lang === 'ar'
        ? 'تم اختيار هذه الأوزان بناءً على موقع السعر الحالي مقابل الهدف المرجح، مع البقاء متحفظًا في السيناريو الأكثر تشاؤمًا.'
        : 'These weights were chosen from the current position versus the weighted target, with a slightly more defensive stance in the downside case.',
      tranche2: {
        verdict: deltaPct >= 0 ? 'partial' : 'deploy',
        reasoning: state.lang === 'ar'
          ? 'لو بقي السعر فوق الهدف المرجح لمدة عدة ساعات، يمكن الدخول جزئيًا؛ وإذا انخفض أكثر من المتوقع، فالأفضل الدخول الآن مع حد خسارة واضح.'
          : 'If price holds above the weighted target for a few sessions, a partial entry makes sense; if it breaks lower, deploy sooner with a clear risk limit.',
      },
      egp_read: state.lang === 'ar'
        ? 'الجانب الجنيهى يحافظ على فعالية التحوط حتى لو ظل الذهب العالمي ثابتًا، لأن أي ضعف في الجنيه يزيد القيمة بالعملة المحلية.'
        : 'The EGP layer is still supporting the hedge even if spot is flat, because a softer pound raises the local-currency value of the position.',
    };
    return fallback;
  };

  const analyze = async () => {
    if (!activeProvider) {
      setState((prev) => ({
        ...prev,
        ai: { ...prev.ai, loading: false, error: state.lang === 'ar' ? 'محتاج تفعّل مزوّد في الإعدادات الأول' : 'Activate a provider in Settings first' },
      }));
      return;
    }
    setState((prev) => ({ ...prev, ai: { ...prev.ai, loading: true, error: null, data: prev.ai.data, at: prev.ai.at, applied: false } }));
    const weightedTarget = SCEN_META.reduce((sum, scenario) => sum + (state.weights[scenario.key] / 100) * ((scenario.lo + scenario.hi) / 2), 0);
    const watch = state.monitors.map((monitor) => `${state.lang === 'ar' ? monitor.ar : monitor.en}=${['supportive', 'watch', 'risk'][monitor.sig]}`).join(', ');
    const scenarioContext = SCEN_META.map((scenario) => `${t.scen[scenario.key].name} (currently weighted ${state.weights[scenario.key]}%, price band $${fmt(scenario.lo)}-$${fmt(scenario.hi)}): ${t.scen[scenario.key].thesis}`).join(' | ');
    const langName = state.lang === 'ar' ? 'Egyptian colloquial Arabic (مصري)' : 'English';
    let egyptSnapshot = egypt.data;
    if (!egyptSnapshot) {
      egyptSnapshot = await fetchEgyptPrices().catch(() => null);
      if (egyptSnapshot) setEgypt({ loading: false, error: null, data: egyptSnapshot });
    }
    const egyptContext = egyptSnapshot
      ? egyptSnapshot.rows.map((row) => `${EGYPT_KARAT_LABEL[row.karat](t)}: sell ${row.sell} EGP / buy ${row.buy} EGP`).join(', ')
      : null;
    const prompt = `You are a senior precious-metals strategist advising a Cairo-based CIO. LIVE COCKPIT STATE - XAU/USD: ${state.spot}; USD/EGP: ${state.egp}; weighted target: ${Math.round(weightedTarget)}.
CURRENT SCENARIO FRAMEWORK (the user's existing weights and theses — these may be stale): ${scenarioContext}.
Use your live web search to check whether real current events (e.g. shifts in the Iran situation including any resumption of conflict, Fed policy moves, central-bank gold buying, EGP moves) still support these theses as weighted, or whether the balance between the three scenarios has genuinely shifted. Your suggested_weights must reflect this reassessment, not just restate the current weights.
WATCHLIST — treat this as a primary input alongside your own research, not background color. Weigh supportive items toward the scenario they favor and risk items away from it; let them materially move both suggested_weights and the tranche2 verdict: ${watch}.
${egyptContext ? `LOCAL EGYPTIAN MARKET (live retail prices from iSagha.com, EGP per gram): ${egyptContext}. Use this to ground your egp_read specifically in what a buyer/seller sees in the Egyptian market right now, not just the theoretical USD/EGP conversion.` : ''}
${state.aiLevel === 'beginner' ? 'Use simple everyday language.' : 'Be direct and specific.'} Write every string VALUE in ${langName} — the whole analysis, every sentence, must be in ${langName}, no English mixed in unless it's a ticker/number. Respond with ONLY a single JSON object, no markdown code fences, matching EXACTLY this schema and these key names in English (the KEYS stay in English exactly as shown, only the VALUES are translated, no other keys, no nested wrapper object):
{
  "one_liner": "<one-sentence summary of the current read, in ${langName}>",
  "trends": ["<what's moving the market right now, 2-3 short items grounded in your search and the watchlist, in ${langName}>"],
  "suggested_weights": { "deesc": <number 0-100>, "base": <number 0-100>, "stag": <number 0-100> },
  "weights_reasoning": "<why these weights, referencing specifically what changed vs. the current framework, in ${langName}>",
  "tranche2": { "verdict": "<deploy|partial|wait>", "reasoning": "<why, in ${langName}>" },
  "egp_read": "<how the EGP side of the hedge is doing, in ${langName}>"
}
The three suggested_weights values must sum to 100.`;

    try {
      const { text, usedWebSearch } = await analyzeViaBackend(prompt);
      const fallback = buildFallbackAnalysis(weightedTarget);
      const parsedPayload = tryParseJson(text);
      const parsed = parsedPayload
        ? normalizeAIResult(parsedPayload, fallback)
        : normalizeAIResult(
            {
              one_liner: text
                ? (state.lang === 'ar' ? `ملخص من الرد: ${text.slice(0, 180)}` : `Summary from the model reply: ${text.slice(0, 180)}`)
                : fallback.one_liner,
              trends: text ? [text.slice(0, 320)] : fallback.trends,
              suggested_weights: fallback.suggested_weights,
              weights_reasoning: state.lang === 'ar' ? 'تمت صياغة هذا التقرير من النص المجاني الذي أعاده المحلل.' : 'This report was derived from the free-text reply returned by the analyst.',
              tranche2: fallback.tranche2,
              egp_read: fallback.egp_read,
            },
            fallback
          );
      setState((prev) => ({
        ...prev,
        ai: {
          loading: false,
          error: null,
          data: parsed,
          at: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          applied: false,
          usedWebSearch,
          providerLabel: `${activeProvider.label} · ${activeProvider.model}`,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'analysis failed';
      const fallback = buildFallbackAnalysis(weightedTarget);
      const friendlyMessage = message.includes('No active provider')
        ? (state.lang === 'ar' ? 'محتاج تفعّل مزوّد في الإعدادات الأول' : 'Activate a provider in Settings first')
        : message.includes('Failed to fetch') || message.includes('fetch')
          ? (state.lang === 'ar'
            ? 'تم تشغيل تحليل بديل محلي بسبب عدم الوصول إلى خدمة التحليل المباشر.'
            : 'A local fallback analysis is being used because the live service could not be reached.')
          : message.includes('HTTP 500') || message.includes('HTTP 5')
            ? (state.lang === 'ar'
              ? 'الخادم أرجع خطأ داخلي (HTTP 500). حاول إعادة المحاولة بعد لحظة.'
              : 'Server returned an internal error (HTTP 500). Try again later.')
            : message;
      setState((prev) => ({
        ...prev,
        ai: {
          loading: false,
          error: friendlyMessage,
          data: fallback,
          at: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          applied: false,
          usedWebSearch: false,
          providerLabel: null,
        },
      }));
    }
  };

  return (
    <div className={`app-shell ${state.theme}`} dir={state.lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="wrap">
        <div className="header">
          <div>
            <div className="eyebrow">{t.eyebrow}</div>
            <h1>{t.title}</h1>
          </div>
          <button className="langbtn" onClick={toggleLang}>{t.langBtn}</button>
        </div>

        <div className="tab-shell">
          <div className="tabbar">
            {[
              { key: 'home' as const, label: t.homeTab },
              { key: 'market' as const, label: t.marketTab },
              { key: 'calc' as const, label: t.calcTab },
              { key: 'target' as const, label: t.targetTab },
              { key: 'scenarios' as const, label: t.scenTab },
              { key: 'egypt' as const, label: t.egyptTab },
              { key: 'ai' as const, label: t.aiTab },
              { key: 'dca' as const, label: t.dcaTab },
              { key: 'watch' as const, label: t.watchTab },
              { key: 'settings' as const, label: t.settingsTab },
            ].map((tab) => (
              <button key={tab.key} className={`tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
            ))}
          </div>

          <div className={`section-wrap ${activeTab === 'home' || activeTab === 'market' ? 'active' : ''}`}>
            <div className="panel">
              <div className="grid3">
                <div>
                  <div className="lbl">{t.inSpot}</div>
                  <input type="text" inputMode="decimal" className="numf" value={state.spot} onInput={(event) => updateNumber('spot', (event.target as HTMLInputElement).value)} />
                </div>
                <div>
                  <div className="lbl">{t.inEgp}</div>
                  <input type="text" inputMode="decimal" className="numf" value={state.egp} onInput={(event) => updateNumber('egp', (event.target as HTMLInputElement).value)} />
                </div>
                <div>
                  <div className="lbl">{t.inPrem}</div>
                  <input type="text" inputMode="decimal" className="numf" value={state.prem} onInput={(event) => updateNumber('prem', (event.target as HTMLInputElement).value)} />
                </div>
              </div>

              <div className="board">
                <div className="cell hero">
                  <div className="k">{t.ounce}</div>
                  <div className="v">${fmt(state.spot)} · {fmt(ozEgp)} EGP</div>
                  <div className="u">{t.ounceU}</div>
                </div>
                <div className="cell">
                  <div className="k">{t.g24}</div>
                  <div className="v">{fmt(g24)}</div>
                  <div className="u">{t.inclU}</div>
                </div>
                <div className="cell">
                  <div className="k">{t.g21}</div>
                  <div className="v">{fmt(g21)}</div>
                  <div className="u">{t.inclU}</div>
                </div>
                <div className="cell">
                  <div className="k">{t.g18}</div>
                  <div className="v">{fmt(g18)}</div>
                  <div className="u">{t.inclU}</div>
                </div>
                <div className="cell">
                  <div className="k">{t.gp}</div>
                  <div className="v">{fmt(pound)}</div>
                  <div className="u">{t.gpU}</div>
                </div>
              </div>

              <div className="pullrow">
                <button className="pull" onClick={() => void pullLive()}>{t.pull}</button>
                <div id="stamp" className={`stamp ${state.stamp.cls}`}>{state.stamp.txt || t.stampInit}</div>
              </div>
              {state.diag ? <pre className="diag">{state.diag}</pre> : null}
            </div>

            <details>
              <summary>{t.expGramT}</summary>
              <div className="exp">{t.expGram}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'calc' ? 'active' : ''}`}>
            <div className="sechead">
              <div className="lbl">{t.calcT}</div>
            </div>
            <div className="panel" style={{ marginTop: 0 }}>
              <div className="calcrow">
                {t.calcAmt} <input type="text" inputMode="decimal" className="numf" value={state.calcamt} onInput={(event) => updateNumber('calcamt', (event.target as HTMLInputElement).value)} /> {t.calcCur}
              </div>
              <table className="karat">
                <thead>
                  <tr>
                    <th>{t.thK}</th>
                    <th className="n">{t.thP}</th>
                    <th className="n">{t.thQ}</th>
                  </tr>
                </thead>
                <tbody>
                  {karatRows.map((row) => {
                    const perGram = g24 * row.f;
                    return (
                      <tr className={row.hl ? 'hl' : ''}>
                        <td>{row.k}</td>
                        <td className="n">{fmt(perGram)} EGP</td>
                        <td className="n">{fmt(state.calcamt / perGram, 1)}g</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>{t.gpRow}</td>
                    <td className="n">{fmt(pound)} EGP</td>
                    <td className="n">{Math.floor(state.calcamt / pound)} <span className="badge">+ {fmt(state.calcamt - Math.floor(state.calcamt / pound) * pound)} {t.change}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <details>
              <summary>{t.expKaratT}</summary>
              <div className="exp">{t.expKarat}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'target' ? 'active' : ''}`}>
            <div className="target">
              <div className="eyebrow">{t.targetLbl}</div>
              <div className="bignum">${fmt(weighted)}</div>
              <div className="delta" style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                <span className="num">{delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta), 1)}%</span> {t.deltaVs} <span className="num">${fmt(state.spot)}</span>
              </div>
              {!inBand ? <div className="bandnote">{t.bandNote}</div> : null}
            </div>
            <details>
              <summary>{t.expWT}</summary>
              <div className="exp">{t.expW}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'scenarios' ? 'active' : ''}`}>
            {SCEN_META.map((scenario) => {
              const label = t.scen[scenario.key];
              return (
                <div className="panel scen" style={{ borderInlineStartColor: scenario.color }}>
                  <div className="top">
                    <div className="name">{label.name}<span className="sub">{label.sub}</span></div>
                    <div className="w" style={{ color: scenario.color }}>{state.weights[scenario.key]}%</div>
                  </div>
                  <div className="thesis"><span className="num">${fmt(scenario.lo)}–${fmt(scenario.hi)}</span> · {label.thesis}</div>
                  <input type="range" min="2" max="96" value={state.weights[scenario.key]} onInput={(event) => setWeight(scenario.key, Number((event.target as HTMLInputElement).value))} />
                </div>
              );
            })}

            <div className="panel watch-implied">
              <div className="sechead" style={{ margin: 0 }}>
                <div className="lbl">{t.watchImpliedLbl}</div>
              </div>
              <div className="watch-implied-counts">
                <span className="ok">{watchlistCounts.support} {t.siglbl[0]}</span> · <span className="watch">{watchlistCounts.monitor} {t.siglbl[1]}</span> · <span className="risk">{watchlistCounts.risk} {t.siglbl[2]}</span>
              </div>
              <div className="watch-implied-values">{watchlistImpliedWeights.deesc}% / {watchlistImpliedWeights.base}% / {watchlistImpliedWeights.stag}%</div>
              <button className="ai-apply" onClick={applyWatchlistWeights}>{watchApplied ? t.aiApplied : t.watchApplyBtn}</button>
            </div>

            <details>
              <summary>{t.expScT}</summary>
              <div className="exp">{t.expSc}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'egypt' ? 'active' : ''}`}>
            <div className="sechead">
              <div className="lbl">{t.egyptHeading}</div>
              <button className="pull" onClick={loadEgyptPrices} disabled={egypt.loading}>{egypt.loading ? t.egyptLoading : t.pull}</button>
            </div>
            <div className="panel" style={{ marginTop: 0 }}>
              {egypt.error ? <div className="ai-status err">{t.egyptErr}{egypt.error}</div> : null}
              {egypt.data ? (
                <>
                  <table className="karat">
                    <thead>
                      <tr>
                        <th>{t.thK}</th>
                        <th className="n">{t.egyptSell}</th>
                        <th className="n">{t.egyptBuy}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {egypt.data.rows.map((row) => (
                        <tr>
                          <td>{EGYPT_KARAT_LABEL[row.karat](t)}</td>
                          <td className="n">{fmt(row.sell)} EGP</td>
                          <td className="n">{fmt(row.buy)} EGP</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="ai-meta">{t.egyptSourceNote} · {new Date(egypt.data.fetchedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </>
              ) : null}
              {!egypt.data && !egypt.error && egypt.loading ? <div>{t.egyptLoading}</div> : null}
            </div>
          </div>

          <div className={`section-wrap ${activeTab === 'ai' ? 'active' : ''}`}>
            <div className="sechead">
              <div className="lbl">{t.aiT}</div>
            </div>
            <div className="panel ai-panel" style={{ marginTop: 0 }}>
              <div className="ai-providerline">
                {t.aiUsingProvider}: {activeProvider ? `${activeProvider.label} (${providerTypeLabel(activeProvider.provider_type)})` : t.aiNoProvider}
              </div>
              <div className="lvlrow">
                <span className="lvlbl">{t.aiLvl}:</span>
                <button className={`lvl ${state.aiLevel === 'beginner' ? 'on' : ''}`} onClick={() => setState((prev) => ({ ...prev, aiLevel: 'beginner' }))}>{t.aiLvlBeg}</button>
                <button className={`lvl ${state.aiLevel === 'expert' ? 'on' : ''}`} onClick={() => setState((prev) => ({ ...prev, aiLevel: 'expert' }))}>{t.aiLvlExp}</button>
              </div>
              <button className="ai-go" onClick={() => void analyze()} disabled={state.ai.loading}>{state.ai.loading ? t.aiGoing : t.aiGo}</button>
              <div className={`ai-status ${state.ai.error ? 'err' : ''}`}>{state.ai.error ? `${t.aiErr}${state.ai.error}` : ''}</div>
              {state.ai.data ? (
                <div className="ai-result">
                  <div className="ai-section">
                    <div className="ai-section-tape">{state.lang === 'ar' ? 'ملخص سريع' : 'Quick read'}</div>
                    <div className="ai-oneliner">{state.ai.data.one_liner}</div>
                  </div>
                  {state.ai.data.trends && state.ai.data.trends.length ? (
                    <div className="ai-section">
                      <div className="ai-section-tape">{t.aiTrendsH}</div>
                      {(state.ai.data.trends || []).map((item) => <div className="ai-trend">{item}</div>)}
                    </div>
                  ) : null}
                  {state.ai.data.suggested_weights ? (
                    <div className="ai-section">
                      <div className="ai-section-tape">{t.aiWeightsH}</div>
                      <div className="ai-wgrid">
                        {SCEN_META.map((scenario) => (
                          <div className="ai-w">
                            <div className="nm">{t.scen[scenario.key].name}</div>
                            <div className="vals">{state.weights[scenario.key]}% → <span className="new">{state.ai.data?.suggested_weights?.[scenario.key] ?? state.ai.data?.suggested_weights?.[scenario.key as keyof typeof state.ai.data.suggested_weights] ?? '-'}%</span></div>
                          </div>
                        ))}
                      </div>
                      <div className="ai-body">{state.ai.data.weights_reasoning}</div>
                      <button className="ai-apply" onClick={applyAI}>{state.ai.applied ? t.aiApplied : t.aiApply}</button>
                    </div>
                  ) : null}
                  {state.ai.data.tranche2 ? (
                    <div className="ai-section">
                      <div className="ai-section-tape">{t.aiTrancheH}</div>
                      <div className="ai-body">{state.ai.data.tranche2.reasoning}</div>
                    </div>
                  ) : null}
                  {state.ai.data.egp_read ? (
                    <div className="ai-section">
                      <div className="ai-section-tape">{t.aiEgpH}</div>
                      <div className="ai-body">{state.ai.data.egp_read}</div>
                    </div>
                  ) : null}
                  <div className="ai-meta">{state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}</div>
                </div>
              ) : null}
            </div>
            <details>
              <summary>{t.expAiT}</summary>
              <div className="exp">{t.expAi}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'dca' ? 'active' : ''}`}>
            <div className="sechead">
              <div className="lbl">{t.dcaT}</div>
              <div className="budget">{t.budgetLbl} <input type="text" inputMode="decimal" className="numf" value={state.budget} onInput={(event) => updateNumber('budget', (event.target as HTMLInputElement).value)} /> {t.cur}</div>
            </div>
            {tranchePct.map((pct, index) => {
              const amount = state.budget * pct / 100;
              const grams = amount / g21;
              return (
                <div className={`tranche ${trancheStatus[index]}`}>
                  <div className="tpct">{pct}%</div>
                  <div className="tmid">
                    <div className="row1">
                      {t.tranches[index].label} · {t.tranches[index].window}
                      {trancheStatus[index] === 'done' ? ' ✓' : null}
                      {trancheStatus[index] === 'active' ? <span style={{ color: 'var(--gold)' }}> {t.nowMark}</span> : null}
                    </div>
                    <div className="row2">{t.tranches[index].note}</div>
                  </div>
                  <div className="tright"><div className="amt">{fmt(amount)} EGP</div><div>≈ {fmt(grams, 1)}g 21k</div></div>
                </div>
              );
            })}
            <div className="posline">{t.posLine(fmt(pound * 5))}</div>
            <details>
              <summary>{t.expDcaT}</summary>
              <div className="exp">{t.expDca}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'watch' ? 'active' : ''}`}>
            <div className="sechead"><div className="lbl">{t.watchT}</div></div>
            <div className="chips">
              {state.monitors.map((monitor, index) => (
                <span className="chip">
                  <span className="chipmain" onClick={() => cycleSignal(index)}>
                    <span className="dot" style={{ background: SIGCOL[monitor.sig] }} />
                    {state.lang === 'ar' ? monitor.ar : monitor.en}<span className="st">{t.siglbl[monitor.sig]}</span>
                  </span>
                  <span className="x" onClick={() => delMonitor(index)} title={t.delMon}>×</span>
                </span>
              ))}
            </div>
            <div className="addrow">
              <input type="text" value={state.newMonitor} maxLength={40} placeholder={t.addMonPh} onInput={(event) => setState((prev) => ({ ...prev, newMonitor: (event.target as HTMLInputElement).value }))} onKeyDown={(event) => { if (event.key === 'Enter') addMonitor(); }} />
              <button className="addbtn" onClick={addMonitor}>{t.addMonBtn}</button>
            </div>
            <details>
              <summary>{t.expMonT}</summary>
              <div className="exp">{t.expMon}</div>
            </details>
          </div>

          <div className={`section-wrap ${activeTab === 'settings' ? 'active' : ''}`}>
            <div className="sechead"><div className="lbl">{t.settingsHeading}</div></div>

            {providers.length === 0 ? <div className="settings-empty">{t.settingsEmpty}</div> : null}

            <div className="settings-list">
              {providers.map((provider) => (
                <div className={`panel settings-card ${provider.is_active ? 'active' : ''}`}>
                  <div className="settings-card-top">
                    <div>
                      <div className="settings-card-label">{provider.label}</div>
                      <div className="settings-card-meta">{providerTypeLabel(provider.provider_type)} · {provider.model}</div>
                    </div>
                    {provider.is_active ? <span className="badge">{t.settingsActiveBadge}</span> : null}
                  </div>
                  <div className="settings-actions">
                    {!provider.is_active ? <button onClick={() => void activate(provider.id)}>{t.settingsActivateBtn}</button> : null}
                    <button onClick={() => editProvider(provider)}>{t.settingsEditBtn}</button>
                    <button onClick={() => void removeProvider(provider.id)}>{t.settingsDeleteBtn}</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="panel settings-form">
              {providerError ? <div className="settings-error">{providerError}</div> : null}
              <div className="sechead"><div className="lbl">{t.settingsAddHeading}</div></div>

              <div className="settings-field">
                <div className="lbl">{t.settingsTypeLabel}</div>
                <select
                  value={providerForm.provider_type}
                  onChange={(event) => setProviderForm((prev) => ({ ...prev, provider_type: (event.target as HTMLSelectElement).value as ProviderType }))}
                >
                  <option value="ollama">{t.settingsTypeOllama}</option>
                  <option value="openai">{t.settingsTypeOpenAI}</option>
                  <option value="claude">{t.settingsTypeClaude}</option>
                  <option value="custom">{t.settingsTypeCustom}</option>
                </select>
              </div>

              <div className="settings-field">
                <div className="lbl">{t.settingsLabelLabel}</div>
                <input type="text" value={providerForm.label} onInput={(event) => setProviderForm((prev) => ({ ...prev, label: (event.target as HTMLInputElement).value }))} />
              </div>

              {providerForm.provider_type === 'ollama' || providerForm.provider_type === 'custom' ? (
                <div className="settings-field">
                  <div className="lbl">{t.settingsBaseUrlLabel}</div>
                  <input type="text" value={providerForm.base_url ?? ''} onInput={(event) => setProviderForm((prev) => ({ ...prev, base_url: (event.target as HTMLInputElement).value }))} />
                </div>
              ) : null}

              {providerForm.provider_type !== 'ollama' ? (
                <div className="settings-field">
                  <div className="lbl">{t.settingsApiKeyLabel}</div>
                  <input type="password" value={providerForm.api_key ?? ''} placeholder={providerForm.id !== null ? t.settingsApiKeyUnchangedPh : ''} onInput={(event) => setProviderForm((prev) => ({ ...prev, api_key: (event.target as HTMLInputElement).value }))} />
                </div>
              ) : null}

              <div className="settings-field">
                <div className="lbl">{t.settingsModelLabel}</div>
                <input type="text" value={providerForm.model} onInput={(event) => setProviderForm((prev) => ({ ...prev, model: (event.target as HTMLInputElement).value }))} />
              </div>

              <div className="settings-actions">
                <button className="ai-go" onClick={() => void saveProvider()}>{t.settingsSaveBtn}</button>
                <button onClick={() => void testConnection()} disabled={testStatus.loading}>{testStatus.loading ? t.settingsTesting : t.settingsTestBtn}</button>
                {providerForm.id !== null ? <button onClick={resetProviderForm}>{t.settingsCancelBtn}</button> : null}
              </div>
              {testStatus.ok === true ? <div className="settings-success">{t.settingsTestSuccess} {testStatus.message}</div> : null}
              {testStatus.ok === false ? <div className="settings-error">{t.settingsTestError} {testStatus.message}</div> : null}
            </div>
          </div>

          <div className="foot">{t.foot}</div>
        </div>
      </div>
    </div>
  );
}

const T = {
  ar: {
    dir: 'rtl', langBtn: 'EN', eyebrow: 'خاص · مباشر', title: 'غرفة عمليات الذهب', homeTab: 'غرفة العمليات', marketTab: 'الأسعار المباشرة', calcTab: 'حاسبة الشراء بالأعيرة', targetTab: 'السعر المستهدف المرجّح', scenTab: 'سيناريوهات الأوزان', egyptTab: 'السوق المصري', aiTab: 'المحلل الذكي', dcaTab: 'خطة الدخول التدريجي', watchTab: 'قائمة المراقبة', settingsTab: 'الإعدادات',
    egyptHeading: 'أسعار السوق المصري المحلي', egyptSell: 'سعر البيع', egyptBuy: 'سعر الشراء', egyptLoading: 'بيجيب الأسعار من آي صاغة…', egyptErr: 'تعذر جلب أسعار آي صاغة — ', egyptSourceNote: 'المصدر: iSagha.com (آخر تحديث)',
    inSpot: 'أونصة الذهب $', inEgp: 'دولار / جنيه', inPrem: 'مصنعية %', ounce: 'الأونصة', ounceU: 'التحويل المباشر بدون مصنعية',
    g24: 'جرام 24', g21: 'جرام 21', g18: 'جرام 18', gp: 'الجنيه الذهب', inclU: 'جنيه · شامل المصنعية', gpU: 'جنيه · 8 جرام عيار 21',
    pull: '⟳ تحديث الأسعار مباشرة', stampInit: 'بيتحدّث تلقائيًا مع الفتح', expGramT: 'إزاي بنحسب سعر الجرام؟', expGram: 'سعر الذهب عالميًا بيتسعّر بالدولار للأونصة. بناخد سعر الأونصة ÷ 31.1 × سعر الدولار بالجنيه = جرام 24 بالجنيه. عيار 21 = جرام 24 × 0.875، والجنيه الذهب = 8 جرام عيار 21.',
    calcT: 'حاسبة الشراء بالأعيرة', calcAmt: 'المبلغ', calcCur: 'جنيه — يجيبلك:', thK: 'العيار', thP: 'سعر الجرام', thQ: 'الكمية', k24: 'عيار 24 (سبائك)', k22: 'عيار 22', k21: 'عيار 21', k18: 'عيار 18 (مشغولات)', gpRow: 'جنيهات ذهب', change: 'فكة', expKaratT: 'إيه الفرق بين الأعيرة؟', expKarat: 'العيار = نسبة الذهب الخالص. 24 = 99.9% (سبائك)، 22 = 91.7%، 21 = 87.5% (الأشهر في مصر)، 18 = 75% (مشغولات).',
    targetLbl: 'السعر المستهدف المرجّح بالاحتمالات', deltaVs: 'عن السعر الحالي', bandNote: 'السعر الحالي خارج نطاقات السيناريوهات التلاتة. السوق مختلف مع أوزانك — راجعها بالسحب تحت.', expWT: 'يعني إيه "مرجّح بالاحتمالات"؟', expW: 'بدل الرهان على سيناريو واحد، بنحسب متوسط أهداف السيناريوهات التلاتة، كل واحد موزون باحتماله.', scen: { deesc: { name: 'التهدئة', sub: 'De-escalation', thesis: 'صمود اتفاق إيران + تحوّل الفيدرالي + عودة تدفقات الصناديق' }, base: { name: 'السيناريو الأساسي', sub: 'Base Case', thesis: 'شراء البنوك المركزية (~720 طن/سنة) في مواجهة الفايدة المرتفعة' }, stag: { name: 'فخ الركود التضخمي', sub: 'Stagflation', thesis: 'رفع فايدة وسط ضعف اقتصادي + ضغط دولاري + بيع اضطراري' } }, expScT: 'إزاي أستخدم السيناريوهات؟', expSc: 'اسحب أي شريط والباقيين بيتعدّلوا تلقائيًا عشان المجموع يفضل 100%.', watchImpliedLbl: 'الأوزان المقترحة من لوحة المتابعة', watchApplyBtn: 'طبّق أوزان لوحة المتابعة', aiT: 'المحلل الذكي', aiGo: '⚡ حلّل السوق بناءً على إطاري', aiLvl: 'مستوى الشرح', aiLvlBeg: 'مبتدئ', aiLvlExp: 'خبير', aiGoing: 'بيبحث في السوق ويحلل…', aiErr: 'فشل التحليل — ', aiTrendsH: 'اللي حرّك السوق', aiWeightsH: 'الأوزان المقترحة', aiApply: 'طبّق الأوزان دي على السيناريوهات', aiApplied: '✓ اتطبقت', aiTrancheH: 'قرار الدفعة الثانية', aiEgpH: 'قراءة الجنيه', aiDisc: 'تحليل آلي مبني على بحث لحظي — راجعه بعقلك قبل أي قرار.', expAiT: 'إزاي المحلل ده شغال؟', expAi: 'الزرار بيبعت حالة اللوحة كاملة — الأسعار الحية، أوزانك، السعر المرجّح، حالة الدفعات، ألوان المتابعة — لنموذج Claude ومعاه صلاحية بحث في الإنترنت.', dcaT: 'خطة الدخول التدريجي · 40 / 35 / 25', budgetLbl: 'الميزانية', cur: 'جنيه', tranches: [{ label: 'الدفعة الأولى', window: 'مايو–يونيو', note: 'تم شراء 5 جنيهات ذهب — دخول موفق' }, { label: 'الدفعة الثانية', window: 'يوليو–أغسطس', note: 'النافذة مفتوحة دلوقتي' }, { label: 'الدفعة الثالثة', window: 'سبتمبر–أكتوبر', note: 'استنى اجتماع الفيدرالي في سبتمبر' }], nowMark: '← دلوقتي', posLine: (value: string) => `المركز الحالي: 5 جنيهات ذهب ≈ <b class="num">${value}</b> جنيه بأسعار النهارده`, expDcaT: 'ليه الشراء على 3 دفعات مش مرة واحدة؟', expDca: 'دي استراتيجية DCA: توزيع الشراء بدل توقيت السوق. التقسيم 40 / 35 / 25: أكبر دفعة بدري، والباقي على نوافذ مربوطة باجتماعات الفيدرالي.', watchT: 'لوحة المتابعة — اضغط للتبديل · × للحذف', addMonPh: 'متغير جديد (مثلًا: أسعار النفط)…', addMonBtn: 'أضف', delMon: 'احذف المتغير', siglbl: ['داعم', 'مراقبة', 'خطر'] as const, expMonT: 'إيه المتغيرات دي وليه؟', expMon: 'الزر الأخضر = داعم، الأصفر = مراقبة، الأحمر = خطر على الأطروحة.',
    aiUsingProvider: 'المزوّد المستخدم', aiNoProvider: 'مفيش مزوّد مُفعّل — روح الإعدادات', settingsHeading: 'إعدادات نموذج الذكاء الاصطناعي', settingsAddHeading: 'إضافة / تعديل مزوّد', settingsEmpty: 'لسه مفيش مزوّدين متضافين.', settingsTypeLabel: 'النوع', settingsLabelLabel: 'الاسم', settingsBaseUrlLabel: 'رابط الخادم', settingsApiKeyLabel: 'مفتاح API', settingsApiKeyUnchangedPh: 'اتركه فاضي عشان يفضل زي ما هو', settingsModelLabel: 'الموديل', settingsSaveBtn: 'حفظ', settingsCancelBtn: 'إلغاء', settingsActivateBtn: 'تفعيل', settingsActiveBadge: 'مُفعّل', settingsEditBtn: 'تعديل', settingsDeleteBtn: 'حذف', settingsTypeOllama: 'Ollama (محلي)', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'مخصص', settingsTestBtn: 'اختبار الاتصال', settingsTesting: 'بيتم الاختبار…', settingsTestSuccess: '✓ نجح الاتصال —', settingsTestError: '✗ فشل الاتصال —', settingsValidationError: 'الاسم والموديل مطلوبين',
    foot: 'الإطار: جلسة مايو 2026. الأسعار من مصادر مجانية بدون مفاتيح. أداة تحليل شخصية — مش نصيحة استثمارية.' },
  en: {
    dir: 'ltr', langBtn: 'عربي', eyebrow: 'PRIVATE · LIVE', title: 'Gold Hedge Cockpit', homeTab: 'Operations Room', marketTab: 'Live Market', calcTab: 'Karat Purchase Calculator', targetTab: 'Probability-Weighted Target', scenTab: 'Scenario Weights', egyptTab: 'Egypt Market', aiTab: 'AI Analyst', dcaTab: 'DCA Plan', watchTab: 'Watchlist', settingsTab: 'Settings',
    egyptHeading: 'LOCAL EGYPTIAN MARKET PRICES', egyptSell: 'Sell', egyptBuy: 'Buy', egyptLoading: 'Fetching prices from iSagha…', egyptErr: 'Could not reach iSagha — ', egyptSourceNote: 'Source: iSagha.com (last updated)',
    inSpot: 'XAU/USD', inEgp: 'USD/EGP', inPrem: 'PREMIUM %', ounce: 'Ounce', ounceU: 'direct conversion, no premium',
    g24: '24k gram', g21: '21k gram', g18: '18k gram', gp: 'Gold pound', inclU: 'EGP · incl. premium', gpU: 'EGP · 8g of 21k',
    pull: '⟳ PULL LIVE MARKET', stampInit: 'Auto-pulls on open', expGramT: 'How is the gram price computed?', expGram: 'Gold is priced globally in USD per troy ounce. Ounce ÷ 31.1 × USD/EGP = 24k gram in EGP. 21k = 24k × 0.875; a gold pound = 8g of 21k.',
    calcT: 'KARAT PURCHASE CALCULATOR', calcAmt: 'Amount', calcCur: 'EGP buys you:', thK: 'Karat', thP: 'Per gram', thQ: 'Quantity', k24: '24k (bullion)', k22: '22k', k21: '21k', k18: '18k (jewelry)', gpRow: 'Gold pounds', change: 'change', expKaratT: "What's the difference between karats?", expKarat: 'Karat = purity. 24 = 99.9% (bullion), 22 = 91.7%, 21 = 87.5% (Egypt\'s standard), 18 = 75% (jewelry).',
    targetLbl: 'PROBABILITY-WEIGHTED TARGET', deltaVs: 'vs. spot', bandNote: 'Spot sits outside all three bands. The market disagrees with your weights — drag below.', expWT: 'What does "probability-weighted" mean?', expW: 'Instead of betting on one scenario, we average the three targets, each weighted by its probability.', scen: { deesc: { name: 'De-escalation', sub: 'التهدئة', thesis: 'Iran deal holds, Fed pivots, ETF inflows return' }, base: { name: 'Base Case', sub: 'الأساسي', thesis: 'CB buying ~720t/yr vs. elevated rates — grind higher' }, stag: { name: 'Stagflation Trap', sub: 'فخ الركود', thesis: 'Fed hikes into weakness, dollar squeeze, forced selling' } }, expScT: 'How do I use the scenarios?', expSc: 'Drag any slider and the other two rebalance so the total stays 100%.', watchImpliedLbl: 'Watchlist-implied weights', watchApplyBtn: 'Apply watchlist weights', aiT: 'AI ANALYST', aiGo: '⚡ Analyze the market against my framework', aiLvl: 'Explanation level', aiLvlBeg: 'Beginner', aiLvlExp: 'Expert', aiGoing: 'Searching & analyzing…', aiErr: 'Analysis failed — ', aiTrendsH: 'WHAT MOVED THE MARKET', aiWeightsH: 'SUGGESTED WEIGHTS', aiApply: 'Apply these weights to the scenarios', aiApplied: '✓ Applied', aiTrancheH: 'TRANCHE 2 CALL', aiEgpH: 'EGP READ', aiDisc: 'Machine analysis on live search — apply your own judgment before acting.', expAiT: 'How does this analyst work?', expAi: 'The button sends your full cockpit state — live prices, your weights, the weighted target, tranche status, watchlist colors — to Claude with web-search access.', dcaT: 'DCA PLAN · 40 / 35 / 25', budgetLbl: 'Budget', cur: 'EGP', tranches: [{ label: 'Tranche 1', window: 'May–Jun', note: '5 gold pounds bought — good entry' }, { label: 'Tranche 2', window: 'Jul–Aug', note: 'Window open now' }, { label: 'Tranche 3', window: 'Sep–Oct', note: 'Hold for Fed September meeting' }], nowMark: '← now', posLine: (value: string) => `Current position: 5 gold pounds ≈ <b class="num">${value}</b> EGP at today\'s rates`, expDcaT: 'Why three tranches instead of one buy?', expDca: 'This is DCA: staged entry instead of timing the market. The 40 / 35 / 25 split puts the largest tranche early, with the rest tied to Fed-meeting windows.', watchT: 'WATCHLIST — TAP TO CYCLE · × TO DELETE', addMonPh: 'New variable (e.g. oil prices)…', addMonBtn: 'Add', delMon: 'Delete variable', siglbl: ['OK', 'Watch', 'Risk'] as const, expMonT: 'What are these variables?', expMon: 'Green = supportive, amber = watch, red = thesis risk.',
    aiUsingProvider: 'Using provider', aiNoProvider: 'No active provider — go to Settings', settingsHeading: 'AI Model Settings', settingsAddHeading: 'Add / Edit Provider', settingsEmpty: 'No providers configured yet.', settingsTypeLabel: 'Type', settingsLabelLabel: 'Label', settingsBaseUrlLabel: 'Base URL', settingsApiKeyLabel: 'API key', settingsApiKeyUnchangedPh: 'Leave blank to keep unchanged', settingsModelLabel: 'Model', settingsSaveBtn: 'Save', settingsCancelBtn: 'Cancel', settingsActivateBtn: 'Set active', settingsActiveBadge: 'Active', settingsEditBtn: 'Edit', settingsDeleteBtn: 'Delete', settingsTypeOllama: 'Ollama (local)', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'Custom', settingsTestBtn: 'Test connection', settingsTesting: 'Testing…', settingsTestSuccess: '✓ Connection worked —', settingsTestError: '✗ Connection failed —', settingsValidationError: 'Label and Model are required',
    foot: 'Framework: May 2026. Live prices from free keyless feeds. Personal analysis tool — not financial advice.' },
};

export default App;
