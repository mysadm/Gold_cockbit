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
import { fetchDcaPlan, updateDcaPlan, type DcaPlan } from './api/dcaPlan';
import {
  fetchWalletHoldings,
  updateWalletHoldings,
  recordWalletSnapshot,
  fetchWalletSnapshots,
  recordWalletTransaction,
  updateWalletTransaction,
  deleteWalletTransaction,
  fetchWalletTransactions,
  fetchWalletCostBasis,
  type WalletHoldingsRecord,
  type WalletSnapshot,
  type WalletTransaction,
  type WalletUnit,
  type WalletCostBasis,
} from './api/wallet';
import { fetchAlertRules, createAlertRule, setAlertRuleActive, type AlertRule } from './api/alertRules';

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
  wallet_read?: string;
  watchlist_read?: string;
};

type TabKey = 'home' | 'market' | 'calc' | 'target' | 'scenarios' | 'egypt' | 'ai' | 'dca' | 'watch' | 'wallet' | 'settings';

type WalletHoldings = {
  oz: number;
  g24: number;
  g21: number;
  g18: number;
  pounds: number;
};

type AppState = {
  spot: number;
  egp: number;
  prem: number;
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
  const walletRead = typeof source.wallet_read === 'string' && source.wallet_read.trim() ? source.wallet_read : fallback.wallet_read;
  const watchlistRead = typeof source.watchlist_read === 'string' && source.watchlist_read.trim() ? source.watchlist_read : fallback.watchlist_read;
  const weightsReasoning = typeof source.weights_reasoning === 'string' && source.weights_reasoning.trim() ? source.weights_reasoning : fallback.weights_reasoning;
  return {
    one_liner: oneLiner,
    trends,
    suggested_weights: suggestedWeights,
    weights_reasoning: weightsReasoning,
    tranche2,
    egp_read: egpRead,
    wallet_read: walletRead,
    watchlist_read: watchlistRead,
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
    if ((activeTab === 'egypt' || activeTab === 'wallet') && !egypt.data && !egypt.loading && !egypt.error) {
      loadEgyptPrices();
    }
  }, [activeTab]);

  const [dcaPlan, setDcaPlan] = useState<{ loading: boolean; error: string | null; data: DcaPlan | null }>({
    loading: false,
    error: null,
    data: null,
  });

  useEffect(() => {
    setDcaPlan((prev) => ({ ...prev, loading: true, error: null }));
    fetchDcaPlan()
      .then((data) => setDcaPlan({ loading: false, error: null, data }))
      .catch((error) => setDcaPlan({ loading: false, error: error instanceof Error ? error.message : 'failed', data: null }));
  }, []);

  const patchDcaPlan = (updates: Partial<DcaPlan>) => {
    setDcaPlan((prev) => (prev.data ? { ...prev, data: { ...prev.data, ...updates } } : prev));
    updateDcaPlan(updates).catch((error) => {
      setDcaPlan((prev) => ({ ...prev, error: error instanceof Error ? error.message : 'failed' }));
    });
  };

  const [walletHoldings, setWalletHoldings] = useState<{ loading: boolean; error: string | null; data: WalletHoldingsRecord | null }>({
    loading: false,
    error: null,
    data: null,
  });
  const [walletSnapshots, setWalletSnapshots] = useState<{ loading: boolean; error: string | null; data: WalletSnapshot[] }>({
    loading: false,
    error: null,
    data: [],
  });
  const [walletSnapshotRecorded, setWalletSnapshotRecorded] = useState(false);

  useEffect(() => {
    setWalletHoldings((prev) => ({ ...prev, loading: true, error: null }));
    fetchWalletHoldings()
      .then((data) => setWalletHoldings({ loading: false, error: null, data }))
      .catch((error) => setWalletHoldings({ loading: false, error: error instanceof Error ? error.message : 'failed', data: null }));
  }, []);

  const [walletDraft, setWalletDraft] = useState<WalletHoldings | null>(null);
  const [walletEditing, setWalletEditing] = useState(false);
  const [walletSaving, setWalletSaving] = useState(false);

  useEffect(() => {
    if (!walletHoldings.data || walletHoldings.data.locked || walletEditing) return;
    setWalletDraft({
      oz: walletHoldings.data.oz,
      g24: walletHoldings.data.g24,
      g21: walletHoldings.data.g21,
      g18: walletHoldings.data.g18,
      pounds: walletHoldings.data.pounds,
    });
    setWalletEditing(true);
  }, [walletHoldings.data]);

  const startWalletEdit = () => {
    if (!walletHoldings.data) return;
    setWalletDraft({
      oz: walletHoldings.data.oz,
      g24: walletHoldings.data.g24,
      g21: walletHoldings.data.g21,
      g18: walletHoldings.data.g18,
      pounds: walletHoldings.data.pounds,
    });
    setWalletEditing(true);
  };

  const cancelWalletEdit = () => {
    setWalletDraft(null);
    setWalletEditing(false);
  };

  const patchWalletHoldings = (field: keyof WalletHoldings, raw: string) => {
    const value = field === 'oz' ? Math.round(normNum(raw)) : normNum(raw);
    setWalletDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveWalletHoldings = async () => {
    if (!walletDraft) return;
    setWalletSaving(true);
    try {
      const wasLocked = walletHoldings.data?.locked ?? false;
      const data = await updateWalletHoldings(wasLocked ? walletDraft : { ...walletDraft, locked: true });
      setWalletHoldings({ loading: false, error: null, data });
      setWalletSnapshotRecorded(false);
      setWalletDraft(null);
      setWalletEditing(false);
    } catch (error) {
      setWalletHoldings((prev) => ({ ...prev, error: error instanceof Error ? error.message : 'failed' }));
    } finally {
      setWalletSaving(false);
    }
  };

  const todayDateString = () => new Date().toISOString().slice(0, 10);

  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [txForm, setTxForm] = useState<{ unit: WalletUnit; side: 'buy' | 'sell'; amount: string; price: string; date: string }>({
    unit: 'g24',
    side: 'buy',
    amount: '',
    price: '',
    date: todayDateString(),
  });
  const [txEditingId, setTxEditingId] = useState<number | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txSubmitting, setTxSubmitting] = useState(false);

  useEffect(() => {
    if (activeTab !== 'wallet') return;
    fetchWalletTransactions()
      .then(setWalletTransactions)
      .catch(() => {});
  }, [activeTab, walletHoldings.data?.updated_at]);

  const [walletCostBasis, setWalletCostBasis] = useState<WalletCostBasis[]>([]);

  useEffect(() => {
    if (activeTab !== 'wallet') return;
    fetchWalletCostBasis()
      .then(setWalletCostBasis)
      .catch(() => {});
  }, [activeTab, walletHoldings.data?.updated_at, walletTransactions]);

  const resetTxForm = () => {
    setTxEditingId(null);
    setTxForm({ unit: 'g24', side: 'buy', amount: '', price: '', date: todayDateString() });
    setTxError(null);
  };

  const startEditWalletTransaction = (tx: WalletTransaction) => {
    setTxEditingId(tx.id);
    setTxForm({
      unit: tx.unit,
      side: tx.side,
      amount: String(tx.amount),
      price: String(tx.price_egp),
      date: tx.recorded_at.slice(0, 10),
    });
    setTxError(null);
  };

  const submitWalletTransaction = async () => {
    setTxError(null);
    const amount = normNum(txForm.amount);
    const price = normNum(txForm.price);
    if (amount <= 0) {
      setTxError(t.walletTxAmountError);
      return;
    }
    setTxSubmitting(true);
    try {
      const input = {
        unit: txForm.unit,
        side: txForm.side,
        amount: txForm.unit === 'oz' ? Math.round(amount) : amount,
        price_egp: price,
        recorded_at: txForm.date,
      };
      const { holdings, transaction } =
        txEditingId !== null ? await updateWalletTransaction(txEditingId, input) : await recordWalletTransaction(input);
      setWalletHoldings({ loading: false, error: null, data: holdings });
      setWalletDraft((prev) => (prev ? { oz: holdings.oz, g24: holdings.g24, g21: holdings.g21, g18: holdings.g18, pounds: holdings.pounds } : prev));
      setWalletTransactions((prev) =>
        txEditingId !== null ? prev.map((tx) => (tx.id === transaction.id ? transaction : tx)) : [transaction, ...prev]
      );
      setWalletSnapshotRecorded(false);
      resetTxForm();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : String(err));
    } finally {
      setTxSubmitting(false);
    }
  };

  const removeWalletTransaction = async (id: number) => {
    if (!window.confirm(t.walletTxDeleteConfirm)) return;
    try {
      const holdings = await deleteWalletTransaction(id);
      setWalletHoldings({ loading: false, error: null, data: holdings });
      setWalletDraft((prev) => (prev ? { oz: holdings.oz, g24: holdings.g24, g21: holdings.g21, g18: holdings.g18, pounds: holdings.pounds } : prev));
      setWalletTransactions((prev) => prev.filter((tx) => tx.id !== id));
      setWalletSnapshotRecorded(false);
      if (txEditingId === id) resetTxForm();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : String(err));
    }
  };

  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [targetBannerDismissed, setTargetBannerDismissed] = useState(false);
  const [dcaBannerDismissed, setDcaBannerDismissed] = useState(false);

  const refreshAlertRules = () => {
    fetchAlertRules().then(setAlertRules).catch(() => {});
  };

  useEffect(() => {
    refreshAlertRules();
  }, []);

  const targetAlertRule = alertRules.find((rule) => rule.rule_type === 'band_edge') ?? null;
  const dcaAlertRule = alertRules.find((rule) => rule.rule_type === 'tranche_window') ?? null;

  const toggleTargetAlert = async () => {
    if (targetAlertRule) {
      const updated = await setAlertRuleActive(targetAlertRule.id, !targetAlertRule.active);
      setAlertRules((prev) => prev.map((rule) => (rule.id === updated.id ? updated : rule)));
    } else {
      const created = await createAlertRule('band_edge');
      setAlertRules((prev) => [...prev, created]);
    }
  };

  const toggleDcaAlert = async () => {
    if (dcaAlertRule) {
      const updated = await setAlertRuleActive(dcaAlertRule.id, !dcaAlertRule.active);
      setAlertRules((prev) => prev.map((rule) => (rule.id === updated.id ? updated : rule)));
    } else {
      const created = await createAlertRule('tranche_window');
      setAlertRules((prev) => [...prev, created]);
    }
  };

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

  useEffect(() => {
    if (delta <= 0) setTargetBannerDismissed(false);
  }, [delta <= 0]);

  const weightedBreakdown = useMemo(
    () => SCEN_META.map((scenario) => `${state.weights[scenario.key]}% × $${fmt((scenario.lo + scenario.hi) / 2)}`).join(' + '),
    [state.weights]
  );
  const g24 = useMemo(() => (state.spot / OZ) * state.egp * (1 + state.prem / 100), [state.spot, state.egp, state.prem]);
  const g21 = useMemo(() => g24 * 0.875, [g24]);
  const g18 = useMemo(() => g24 * 0.75, [g24]);
  const pound = useMemo(() => g21 * 8, [g21]);

  const findEgyptRow = (karat: EgyptGoldSnapshot['rows'][number]['karat']) =>
    egypt.data?.rows.find((row) => row.karat === karat) ?? null;

  const walletRows = useMemo(() => {
    const holdings = walletHoldings.data;
    const row24 = findEgyptRow('24k');
    const row21 = findEgyptRow('21k');
    const row18 = findEgyptRow('18k');
    const rowPound = findEgyptRow('gold_pound');
    return [
      { key: 'oz' as const, labelKey: 'walletOzLbl' as const, amount: holdings?.oz ?? 0, intlPrice: g24 * OZ, egyptPrice: row24 ? row24.buy * OZ : null },
      { key: 'g24' as const, labelKey: 'walletG24Lbl' as const, amount: holdings?.g24 ?? 0, intlPrice: g24, egyptPrice: row24?.buy ?? null },
      { key: 'g21' as const, labelKey: 'walletG21Lbl' as const, amount: holdings?.g21 ?? 0, intlPrice: g21, egyptPrice: row21?.buy ?? null },
      { key: 'g18' as const, labelKey: 'walletG18Lbl' as const, amount: holdings?.g18 ?? 0, intlPrice: g18, egyptPrice: row18?.buy ?? null },
      { key: 'pounds' as const, labelKey: 'walletPoundsLbl' as const, amount: holdings?.pounds ?? 0, intlPrice: pound, egyptPrice: rowPound?.buy ?? null },
    ];
  }, [walletHoldings.data, g24, g21, g18, pound, egypt.data]);

  const walletIntlValue = useMemo(
    () => walletRows.reduce((sum, row) => sum + row.amount * row.intlPrice, 0),
    [walletRows]
  );

  const walletEgyptValue = useMemo(() => {
    if (!egypt.data || walletRows.some((row) => row.egyptPrice === null)) return null;
    return walletRows.reduce((sum, row) => sum + row.amount * (row.egyptPrice ?? 0), 0);
  }, [walletRows, egypt.data]);

  const walletHasHoldings = walletRows.some((row) => row.amount > 0);

  useEffect(() => {
    if (activeTab !== 'wallet') return;
    if (!walletHoldings.data || !walletHasHoldings || walletSnapshotRecorded) return;
    setWalletSnapshotRecorded(true);
    recordWalletSnapshot({ intl_value_egp: walletIntlValue, egypt_value_egp: walletEgyptValue, usd_egp_rate: state.egp }).catch(() => {});
  }, [activeTab, walletHoldings.data, walletHasHoldings, walletIntlValue, walletEgyptValue, walletSnapshotRecorded]);

  useEffect(() => {
    if (activeTab !== 'wallet' || !walletHoldings.data) return;
    setWalletSnapshots((prev) => ({ ...prev, loading: true }));
    fetchWalletSnapshots(walletHoldings.data.updated_at)
      .then((data) => setWalletSnapshots({ loading: false, error: null, data }))
      .catch((error) => setWalletSnapshots({ loading: false, error: error instanceof Error ? error.message : 'failed', data: [] }));
  }, [activeTab, walletHoldings.data?.updated_at, walletSnapshotRecorded]);

  const walletLastEvaluation = walletSnapshots.data.length >= 2 ? walletSnapshots.data[walletSnapshots.data.length - 2] : null;
  const walletIntlChangePct = walletLastEvaluation
    ? ((walletIntlValue - walletLastEvaluation.intl_value_egp) / walletLastEvaluation.intl_value_egp) * 100
    : null;
  const walletEgyptChangePct = walletLastEvaluation && walletLastEvaluation.egypt_value_egp && walletEgyptValue !== null
    ? ((walletEgyptValue - walletLastEvaluation.egypt_value_egp) / walletLastEvaluation.egypt_value_egp) * 100
    : null;

  const walletTrendChart = useMemo(() => {
    const snaps = walletSnapshots.data;
    if (snaps.length < 2) return null;
    const width = 600;
    const height = 160;
    const times = snaps.map((s) => new Date(s.recorded_at).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const intlValues = snaps.map((s) => s.intl_value_egp);
    const egyptSnaps = snaps.filter((s) => s.egypt_value_egp !== null);
    const allValues = [...intlValues, ...egyptSnaps.map((s) => s.egypt_value_egp as number)];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    const xFor = (t: number) => (maxTime === minTime ? width / 2 : ((t - minTime) / (maxTime - minTime)) * (width - 20) + 10);
    const yFor = (v: number) => (maxVal === minVal ? height / 2 : height - 10 - ((v - minVal) / (maxVal - minVal)) * (height - 20));
    const intlPoints = snaps.map((s) => `${xFor(new Date(s.recorded_at).getTime())},${yFor(s.intl_value_egp)}`).join(' ');
    const egyptPoints = egyptSnaps.length >= 2
      ? egyptSnaps.map((s) => `${xFor(new Date(s.recorded_at).getTime())},${yFor(s.egypt_value_egp as number)}`).join(' ')
      : null;
    return { width, height, intlPoints, egyptPoints };
  }, [walletSnapshots.data]);

  const walletHedgeMetric = useMemo(() => {
    const baseline = walletSnapshots.data.find((s) => s.usd_egp_rate !== null && s.usd_egp_rate > 0);
    if (!baseline || baseline.usd_egp_rate === null || baseline.intl_value_egp <= 0) return null;
    const walletChangePct = ((walletIntlValue - baseline.intl_value_egp) / baseline.intl_value_egp) * 100;
    const egpChangePct = ((state.egp - baseline.usd_egp_rate) / baseline.usd_egp_rate) * 100;
    return { walletChangePct, egpChangePct, diffPct: walletChangePct - egpChangePct, sinceDate: baseline.recorded_at };
  }, [walletSnapshots.data, walletIntlValue, state.egp]);
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
  const tranchePct = [40, 35, 25];
  const TRANCHE_SPACING_MONTHS = 2;

  const dcaWindows = useMemo(() => {
    if (!dcaPlan.data) return null;
    const start = new Date(`${dcaPlan.data.start_date}T00:00:00`);
    return tranchePct.map((_, index) => {
      const windowStart = new Date(start);
      windowStart.setMonth(windowStart.getMonth() + index * TRANCHE_SPACING_MONTHS);
      const windowEnd = new Date(start);
      windowEnd.setMonth(windowEnd.getMonth() + (index + 1) * TRANCHE_SPACING_MONTHS);
      return { windowStart, windowEnd };
    });
  }, [dcaPlan.data]);

  const trancheStatus = useMemo((): ('done' | 'active' | 'pending')[] => {
    if (!dcaWindows) return tranchePct.map(() => 'pending');
    const now = new Date();
    return dcaWindows.map(({ windowStart, windowEnd }) => {
      if (now >= windowEnd) return 'done';
      if (now >= windowStart) return 'active';
      return 'pending';
    });
  }, [dcaWindows]);

  const dcaTrancheOpen = trancheStatus.includes('active');

  useEffect(() => {
    if (!dcaTrancheOpen) setDcaBannerDismissed(false);
  }, [dcaTrancheOpen]);

  const formatTrancheWindow = (windowStart: Date, windowEnd: Date) => {
    const locale = state.lang === 'ar' ? 'ar-EG' : 'en-GB';
    const fmt = (d: Date) => d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
    return `${fmt(windowStart)} – ${fmt(windowEnd)}`;
  };

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

  const updateNumber = (field: 'spot' | 'egp' | 'prem' | 'calcamt', raw: string) => {
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
      wallet_read: walletHasHoldings
        ? (state.lang === 'ar'
            ? `محفظتك الحالية بتساوي دلوقتي حوالي ${fmt(walletIntlValue)} جنيه بالسعر العالمي${walletEgyptValue !== null ? ` و${fmt(walletEgyptValue)} جنيه بسعر السوق المصري الحي` : ''}. مع السعر الحالي ${deltaPct >= 0 ? 'فوق' : 'تحت'} هدفك المرجح، ده وقت معقول إنك ${deltaPct >= 0 ? 'تستحمل الموقف كما هو' : 'تضيف عليه لو خطتك بتسمح'}.`
            : `Your current wallet is worth about ${fmt(walletIntlValue)} EGP at the international price${walletEgyptValue !== null ? ` and ${fmt(walletEgyptValue)} EGP at the live Egyptian market price` : ''}. With spot currently ${deltaPct >= 0 ? 'above' : 'below'} your weighted target, this is a reasonable time to ${deltaPct >= 0 ? 'hold what you have' : 'add to it if your plan allows'}.`)
        : undefined,
      watchlist_read: state.monitors.length > 0
        ? (() => {
            const names = (sig: 0 | 1 | 2) => state.monitors.filter((m) => m.sig === sig).map((m) => (state.lang === 'ar' ? m.ar : m.en));
            const supportive = names(0);
            const risk = names(2);
            if (state.lang === 'ar') {
              return `${supportive.length ? `المتغيرات الداعمة (${supportive.join('، ')}) بتميل ناحية السيناريوهات الإيجابية.` : 'مفيش متغيرات داعمة واضحة دلوقتي.'} ${risk.length ? `والمتغيرات اللي فيها خطر (${risk.join('، ')}) بتحط ضغط على السيناريو المتشائم — راقبها كويس.` : 'مفيش متغيرات خطر واضحة دلوقتي.'}`;
            }
            return `${supportive.length ? `Supportive variables (${supportive.join(', ')}) lean toward the upside scenarios.` : 'No clearly supportive variables right now.'} ${risk.length ? `Risk-flagged variables (${risk.join(', ')}) are pressuring the downside case — keep an eye on them.` : 'No clearly risky variables right now.'}`;
          })()
        : undefined,
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
    const walletContext = walletHasHoldings
      ? walletRows.filter((row) => row.amount > 0).map((row) => `${t[row.labelKey]}: ${row.amount}${row.key === 'pounds' ? '' : 'g'}`).join(', ')
      : null;
    const prompt = `You are a senior precious-metals strategist advising a Cairo-based CIO. LIVE COCKPIT STATE - XAU/USD: ${state.spot}; USD/EGP: ${state.egp}; weighted target: ${Math.round(weightedTarget)}.
CURRENT SCENARIO FRAMEWORK (the user's existing weights and theses — these may be stale): ${scenarioContext}.
Use your live web search to check whether real current events (e.g. shifts in global geopolitical tensions — Iran, Russia/Ukraine, trade wars, or any other major flashpoint — Fed policy moves, central-bank gold buying, EGP moves) still support these theses as weighted, or whether the balance between the three scenarios has genuinely shifted. Your suggested_weights must reflect this reassessment, not just restate the current weights.
WATCHLIST — treat this as a primary input alongside your own research, not background color. Weigh supportive items toward the scenario they favor and risk items away from it; let them materially move both suggested_weights and the tranche2 verdict: ${watch}. Write watchlist_read as an explicit, named walk-through of these specific variables — call out which ones are currently supportive vs. risk, whether your live research still backs the user's current signal on each, and flag any where you think the user's own color-coding looks stale or wrong given what you found.
${egyptContext ? `LOCAL EGYPTIAN MARKET (live retail prices from iSagha.com, EGP per gram): ${egyptContext}. Use this to ground your egp_read specifically in what a buyer/seller sees in the Egyptian market right now, not just the theoretical USD/EGP conversion.` : ''}
${walletContext ? `HIS PHYSICAL WALLET (what he actually owns today): ${walletContext}. Current value: ~${fmt(walletIntlValue)} EGP at the international price${walletEgyptValue !== null ? `, ~${fmt(walletEgyptValue)} EGP at the live Egyptian market price` : ''}. Write wallet_read as a fresh re-evaluation of THIS SPECIFIC holding given today's read — is it well-positioned given the scenario reassessment above, should he add, hold, or trim, and note if the international and Egyptian-market valuations of it diverge meaningfully.` : ''}
${state.aiLevel === 'beginner' ? 'Use simple everyday language.' : 'Apply institutional-grade discipline: treat only what you verified via search as fact, mark anything else as background. Weigh central-bank buying and the full breadth of active geopolitical risk (not one conflict) as structural drivers, not just headlines. Prioritize the Egyptian-market angle throughout — the local premium over the international price and the implied "souq-dollar" vs. the official EGP rate — since that\'s the layer the user actually holds. Be concise: short, dense sentences, no filler, no restated caveats, state only what changes the call.'} Write every string VALUE in ${langName} — the whole analysis, every sentence, must be in ${langName}, no English mixed in unless it's a ticker/number. Respond with ONLY a single JSON object, no markdown code fences, matching EXACTLY this schema and these key names in English (the KEYS stay in English exactly as shown, only the VALUES are translated, no other keys, no nested wrapper object):
{
  "one_liner": "<one-sentence summary of the current read, in ${langName}>",
  "trends": ["<what's moving the market right now, 2-3 short items grounded in your search and the watchlist, in ${langName}>"],
  "suggested_weights": { "deesc": <number 0-100>, "base": <number 0-100>, "stag": <number 0-100> },
  "weights_reasoning": "<why these weights, referencing specifically what changed vs. the current framework, in ${langName}>",
  "tranche2": { "verdict": "<deploy|partial|wait>", "reasoning": "<why, in ${langName}>" },
  "egp_read": "<how the EGP side of the hedge is doing, in ${langName}>"${walletContext ? `,\n  "wallet_read": "<re-evaluation of his physical wallet given today's read, in ${langName}>"` : ''}${watch ? `,\n  "watchlist_read": "<named walk-through of the watchlist variables and whether your research still backs the user's signal on each, in ${langName}>"` : ''}
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
              wallet_read: fallback.wallet_read,
              watchlist_read: fallback.watchlist_read,
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
              { key: 'wallet' as const, label: t.walletTab },
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
              <div className="ai-meta">{t.calcSpreadNote}</div>
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

            {targetAlertRule?.active && delta > 0 && !targetBannerDismissed ? (
              <div className="panel" style={{ borderInlineStartColor: 'var(--green)', borderInlineStartWidth: 3 }}>
                {t.targetBuyHint}
                <span className="linklike" style={{ cursor: 'pointer', textDecoration: 'underline', marginInlineStart: 10 }} onClick={() => setTargetBannerDismissed(true)}>
                  {t.alertDismissBtn}
                </span>
              </div>
            ) : null}

            <div className="panel" style={{ marginTop: 0 }}>
              <div className="toggle-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!targetAlertRule?.active}
                  className={`toggle-switch ${targetAlertRule?.active ? 'on' : ''}`}
                  onClick={() => void toggleTargetAlert()}
                >
                  <span className="knob" />
                </button>
                <div className="toggle-text">
                  <div className="lbl2">{targetAlertRule?.active ? t.alertTargetOnLbl : t.alertTargetOffLbl}</div>
                  <div className="note">
                    {delta > 0
                      ? t.alertTargetNoteBelow.replace('{pct}', fmt(Math.abs(delta), 1))
                      : t.alertTargetNoteAbove.replace('{pct}', fmt(Math.abs(delta), 1))}
                  </div>
                </div>
              </div>
            </div>

            <details>
              <summary>{t.expWT}</summary>
              <div className="exp">
                {t.expW}
                <div className="formula"><span className="num">{t.formulaLbl} ({weightedBreakdown}) ÷ 100 = ${fmt(weighted)}</span></div>
                <div style={{ marginTop: 8 }}>{t.expWUse}</div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>{delta > 0 ? t.targetBuyHint : t.targetHoldHint}</div>
                <div style={{ marginTop: 4, opacity: 0.75 }}>{t.targetCaveat}</div>
              </div>
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
                  {egypt.data.stale ? (
                    <div className="ai-status err">
                      {t.egyptStaleNote} {new Date(egypt.data.fetchedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ) : null}
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
                  {state.ai.data.wallet_read ? (
                    <div className="ai-section">
                      <div className="ai-section-tape">{t.aiWalletH}</div>
                      <div className="ai-body">{state.ai.data.wallet_read}</div>
                    </div>
                  ) : null}
                  {state.ai.data.watchlist_read ? (
                    <div className="ai-section">
                      <div className="ai-section-tape">{t.aiWatchH}</div>
                      <div className="ai-body">{state.ai.data.watchlist_read}</div>
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
              <div className="budget">
                {t.startDateLbl} <input type="date" className="numf" value={dcaPlan.data?.start_date ?? ''} onInput={(event) => patchDcaPlan({ start_date: (event.target as HTMLInputElement).value })} />
              </div>
              <div className="budget">
                {t.budgetLbl} <input type="text" inputMode="decimal" className="numf" value={dcaPlan.data?.total_investment_egp ?? 0} onInput={(event) => patchDcaPlan({ total_investment_egp: normNum((event.target as HTMLInputElement).value) })} /> {t.cur}
              </div>
            </div>
            {dcaPlan.error ? <div className="ai-status err">{dcaPlan.error}</div> : null}

            {dcaAlertRule?.active && dcaTrancheOpen && !dcaBannerDismissed ? (
              <div className="panel" style={{ borderInlineStartColor: 'var(--gold)', borderInlineStartWidth: 3 }}>
                {t.alertDcaOpenMsg}
                <span className="linklike" style={{ cursor: 'pointer', textDecoration: 'underline', marginInlineStart: 10 }} onClick={() => setDcaBannerDismissed(true)}>
                  {t.alertDismissBtn}
                </span>
              </div>
            ) : null}

            <div className="panel" style={{ marginTop: 0 }}>
              <div className="toggle-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!dcaAlertRule?.active}
                  className={`toggle-switch ${dcaAlertRule?.active ? 'on' : ''}`}
                  onClick={() => void toggleDcaAlert()}
                >
                  <span className="knob" />
                </button>
                <div className="toggle-text">
                  <div className="lbl2">{dcaAlertRule?.active ? t.alertDcaOnLbl : t.alertDcaOffLbl}</div>
                  <div className="note">
                    {(() => {
                      if (dcaTrancheOpen) return t.alertDcaNoteOpen;
                      const nextIndex = trancheStatus.findIndex((status) => status === 'pending');
                      if (nextIndex === -1 || !dcaWindows) return t.alertDcaNoteDone;
                      const locale = state.lang === 'ar' ? 'ar-EG' : 'en-GB';
                      const date = dcaWindows[nextIndex].windowStart.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
                      return t.alertDcaNoteNext.replace('{date}', date);
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {tranchePct.map((pct, index) => {
              const totalInvestment = dcaPlan.data?.total_investment_egp ?? 0;
              const amount = totalInvestment * pct / 100;
              const grams = amount / g21;
              const window = dcaWindows ? formatTrancheWindow(dcaWindows[index].windowStart, dcaWindows[index].windowEnd) : '';
              return (
                <div className={`tranche ${trancheStatus[index]}`}>
                  <div className="tpct">{pct}%</div>
                  <div className="tmid">
                    <div className="row1">
                      {t.tranches[index]} · {window}
                      {trancheStatus[index] === 'done' ? ' ✓' : null}
                      {trancheStatus[index] === 'active' ? <span style={{ color: 'var(--gold)' }}> {t.nowMark}</span> : null}
                    </div>
                  </div>
                  <div className="tright"><div className="amt">{fmt(amount)} EGP</div><div>≈ {fmt(grams, 1)}g 21k</div></div>
                </div>
              );
            })}
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

          <div className={`section-wrap ${activeTab === 'wallet' ? 'active' : ''}`}>
            <div className="sechead"><div className="lbl">{t.walletT}</div></div>

            <div className="panel" style={{ marginTop: 0 }}>
              <table className="karat">
                <thead>
                  <tr>
                    <th>{t.walletKaratCol}</th>
                    <th className="n">{t.walletAmountCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {walletRows.map((row) => {
                    const draftValue = walletDraft ? walletDraft[row.key] : row.amount;
                    return (
                      <tr className={row.key === 'g24' || row.key === 'oz' ? 'hl' : ''}>
                        <td>{t[row.labelKey]}</td>
                        <td className="n">
                          {walletEditing ? (
                            <input
                              type="text"
                              inputMode={row.key === 'oz' ? 'numeric' : 'decimal'}
                              className="numf"
                              value={row.key === 'oz' ? Math.round(draftValue) : Number(draftValue.toFixed(1))}
                              onInput={(event) => patchWalletHoldings(row.key, (event.target as HTMLInputElement).value)}
                            />
                          ) : (
                            <span>{row.key === 'oz' ? Math.round(row.amount) : Number(row.amount.toFixed(1))}</span>
                          )}
                          {row.key === 'oz' || row.key === 'pounds' ? '' : ' g'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {walletHoldings.data?.locked ? (
                <div className="toggle-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={walletEditing}
                    className={`toggle-switch ${walletEditing ? 'on' : ''}`}
                    onClick={() => (walletEditing ? cancelWalletEdit() : startWalletEdit())}
                  >
                    <span className="knob" />
                  </button>
                  <div className="toggle-text">
                    <div className="lbl2">{walletEditing ? t.walletCorrectingLbl : t.walletModifyBtn}</div>
                    <div className="note">{walletEditing ? t.walletLockNote : t.walletLockedNote}</div>
                  </div>
                </div>
              ) : (
                <div className="ai-meta">{t.walletLockNote}</div>
              )}
              {walletEditing ? (
                <button className="ai-go" style={{ marginTop: 10 }} onClick={() => void saveWalletHoldings()} disabled={walletSaving}>
                  {walletSaving ? t.walletSaving : t.walletSaveBtn}
                </button>
              ) : null}
            </div>

            <div className="panel">
              <div className="sechead" style={{ margin: 0 }}>
                <div className="lbl">{txEditingId !== null ? t.walletTxEditingT : t.walletTxT}</div>
              </div>
              <div className="calcrow">
                {t.walletTxUnitLbl}
                <select
                  value={txForm.unit}
                  onChange={(event) => setTxForm((prev) => ({ ...prev, unit: (event.target as HTMLSelectElement).value as WalletUnit }))}
                >
                  {walletRows.map((row) => (
                    <option value={row.key}>{t[row.labelKey]}</option>
                  ))}
                </select>
              </div>
              <div className="calcrow">
                <button
                  className={`lvl ${txForm.side === 'buy' ? 'on' : ''}`}
                  onClick={() => setTxForm((prev) => ({ ...prev, side: 'buy' }))}
                >
                  {t.walletTxBuy}
                </button>
                <button
                  className={`lvl ${txForm.side === 'sell' ? 'on' : ''}`}
                  onClick={() => setTxForm((prev) => ({ ...prev, side: 'sell' }))}
                >
                  {t.walletTxSell}
                </button>
              </div>
              <div className="calcrow">
                {t.walletTxAmountLbl}
                <input
                  type="text"
                  inputMode={txForm.unit === 'oz' ? 'numeric' : 'decimal'}
                  className="numf"
                  value={txForm.amount}
                  onInput={(event) => setTxForm((prev) => ({ ...prev, amount: (event.target as HTMLInputElement).value }))}
                />
              </div>
              <div className="calcrow">
                {t.walletTxPriceLbl}
                <input
                  type="text"
                  inputMode="decimal"
                  className="numf"
                  value={txForm.price}
                  onInput={(event) => setTxForm((prev) => ({ ...prev, price: (event.target as HTMLInputElement).value }))}
                />
                {t.cur}
              </div>
              {(() => {
                const selectedRow = walletRows.find((r) => r.key === txForm.unit);
                if (!selectedRow) return null;
                return (
                  <div className="ai-meta">
                    {t.walletTxLookupLbl} {fmt(selectedRow.intlPrice)} {t.cur} ({t.walletIntlLbl})
                    {selectedRow.egyptPrice !== null ? ` · ${fmt(selectedRow.egyptPrice)} ${t.cur} (${t.walletEgyptLbl})` : ''}
                    {' · '}
                    <span
                      className="linklike"
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => setTxForm((prev) => ({ ...prev, price: String(selectedRow.intlPrice.toFixed(0)) }))}
                    >
                      {t.walletTxUseLookup}
                    </span>
                  </div>
                );
              })()}
              <div className="calcrow">
                {t.walletTxDateLbl}
                <input
                  type="date"
                  className="numf"
                  value={txForm.date}
                  onInput={(event) => setTxForm((prev) => ({ ...prev, date: (event.target as HTMLInputElement).value }))}
                />
              </div>
              {txError ? <div className="ai-status err">{txError}</div> : null}
              <button className="ai-go" onClick={() => void submitWalletTransaction()} disabled={txSubmitting}>
                {txSubmitting ? t.walletTxSubmitting : txEditingId !== null ? t.walletTxUpdate : t.walletTxSubmit}
              </button>
              {txEditingId !== null ? (
                <button onClick={resetTxForm} style={{ marginInlineStart: 8 }}>
                  {t.settingsCancelBtn}
                </button>
              ) : null}

              {walletTransactions.length > 0 ? (
                <>
                <table className="karat" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>{t.walletKaratCol}</th>
                      <th className="n">{t.walletTxAmountLbl}</th>
                      <th className="n">{t.walletTxPriceLbl}</th>
                      <th className="n">{t.walletTxDateLbl}</th>
                      <th className="n"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletTransactions.slice(0, 10).map((tx) => {
                      const row = walletRows.find((r) => r.key === tx.unit);
                      return (
                        <tr>
                          <td>
                            <span style={{ color: tx.side === 'buy' ? 'var(--green)' : 'var(--red)' }}>{tx.side === 'buy' ? t.walletTxBuy : t.walletTxSell}</span>
                            {' · '}{row ? t[row.labelKey] : tx.unit}
                          </td>
                          <td className="n">{fmt(tx.amount, tx.unit === 'oz' ? 0 : 1)}</td>
                          <td className="n">{fmt(tx.price_egp)} {t.cur}</td>
                          <td className="n">{tx.recorded_at.slice(0, 10)}</td>
                          <td className="n">
                            <span className="linklike" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => startEditWalletTransaction(tx)}>
                              {t.settingsEditBtn}
                            </span>
                            {' · '}
                            <span className="linklike" style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--red)' }} onClick={() => void removeWalletTransaction(tx.id)}>
                              {t.settingsDeleteBtn}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <a href="/api/wallet/transactions/export.csv" download className="ai-apply">{t.walletExportBtn}</a>
                </>
              ) : null}
            </div>

            {walletHasHoldings ? (
              <div className="panel">
                <table className="karat">
                  <thead>
                    <tr>
                      <th>{t.walletKaratCol}</th>
                      <th className="n">{t.walletIntlLbl}</th>
                      <th className="n">{t.walletEgyptLbl}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletRows.filter((row) => row.amount > 0).map((row) => (
                      <tr>
                        <td>{t[row.labelKey]}</td>
                        <td className="n">{fmt(row.amount * row.intlPrice)} {t.cur}</td>
                        <td className="n">{row.egyptPrice !== null ? `${fmt(row.amount * row.egyptPrice)} ${t.cur}` : '—'}</td>
                      </tr>
                    ))}
                    <tr className="hl">
                      <td>{t.walletTotalLbl}</td>
                      <td className="n">{fmt(walletIntlValue)} {t.cur}</td>
                      <td className="n">{walletEgyptValue !== null ? `${fmt(walletEgyptValue)} ${t.cur}` : '—'}</td>
                    </tr>
                  </tbody>
                </table>
                {walletEgyptValue !== null ? (
                  <div className="delta" style={{ color: walletEgyptValue >= walletIntlValue ? 'var(--green)' : 'var(--red)' }}>
                    <span className="num">{walletEgyptValue >= walletIntlValue ? '▲' : '▼'} {fmt(Math.abs(((walletEgyptValue - walletIntlValue) / walletIntlValue) * 100), 1)}%</span> {t.walletDeltaLbl}
                  </div>
                ) : (
                  <div className="ai-status err">{egypt.loading ? t.egyptLoading : t.walletNoEgyptData}</div>
                )}
                <div className="ai-meta">{t.calcSpreadNote}</div>
              </div>
            ) : (
              <div className="panel">{t.walletEmptyHint}</div>
            )}

            {walletCostBasis.some((cb) => cb.openQty > 0 || cb.realizedEgp !== 0) ? (
              <div className="panel">
                <div className="sechead" style={{ margin: 0 }}><div className="lbl">{t.walletCostBasisLbl}</div></div>
                <table className="karat">
                  <thead>
                    <tr>
                      <th>{t.walletKaratCol}</th>
                      <th className="n">{t.walletAvgCostLbl}</th>
                      <th className="n">{t.walletUnrealizedLbl}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletCostBasis.filter((cb) => cb.openQty > 0).map((cb) => {
                      const row = walletRows.find((r) => r.key === cb.unit);
                      const unrealizedPct = row && cb.avgCostEgp > 0 ? ((row.intlPrice - cb.avgCostEgp) / cb.avgCostEgp) * 100 : null;
                      return (
                        <tr>
                          <td>{row ? t[row.labelKey] : cb.unit}</td>
                          <td className="n">{fmt(cb.avgCostEgp)} {t.cur}</td>
                          <td className="n">
                            {unrealizedPct !== null ? (
                              <span style={{ color: unrealizedPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {unrealizedPct >= 0 ? '▲' : '▼'} {fmt(Math.abs(unrealizedPct), 1)}%
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {(() => {
                  const totalRealized = walletCostBasis.reduce((sum, cb) => sum + cb.realizedEgp, 0);
                  if (totalRealized === 0) return null;
                  return (
                    <div className="delta" style={{ color: totalRealized >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      <span className="num">{totalRealized >= 0 ? '▲' : '▼'} {fmt(Math.abs(totalRealized))} {t.cur}</span> {t.walletRealizedLbl}
                    </div>
                  );
                })()}
                <div className="ai-meta">{t.walletCostBasisNote}</div>
              </div>
            ) : null}

            {walletHasHoldings && walletLastEvaluation ? (
              <div className="panel">
                <div className="sechead" style={{ margin: 0 }}><div className="lbl">{t.walletChangeLbl}</div></div>
                {walletIntlChangePct !== null ? (
                  <div className="delta" style={{ color: walletIntlChangePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    <span className="num">{walletIntlChangePct >= 0 ? '▲' : '▼'} {fmt(Math.abs(walletIntlChangePct), 1)}%</span> {t.walletIntlLbl}
                  </div>
                ) : null}
                {walletEgyptChangePct !== null ? (
                  <div className="delta" style={{ color: walletEgyptChangePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    <span className="num">{walletEgyptChangePct >= 0 ? '▲' : '▼'} {fmt(Math.abs(walletEgyptChangePct), 1)}%</span> {t.walletEgyptLbl}
                  </div>
                ) : null}
                <div className="ai-meta">{t.walletSinceLbl} {new Date(walletLastEvaluation.recorded_at).toLocaleDateString(state.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</div>
              </div>
            ) : null}

            {walletHasHoldings ? (
              <div className="panel">
                <div className="sechead" style={{ margin: 0 }}><div className="lbl">{t.walletTrendLbl}</div></div>
                {walletTrendChart ? (
                  <>
                    <svg viewBox={`0 0 ${walletTrendChart.width} ${walletTrendChart.height}`} style={{ width: '100%', height: 160 }}>
                      <polyline points={walletTrendChart.intlPoints} fill="none" stroke="var(--gold)" strokeWidth="2" />
                      {walletTrendChart.egyptPoints ? (
                        <polyline points={walletTrendChart.egyptPoints} fill="none" stroke="var(--green)" strokeWidth="2" />
                      ) : null}
                    </svg>
                    <div className="ai-meta">
                      <span style={{ color: 'var(--gold)' }}>● {t.walletIntlLbl}</span>
                      {walletTrendChart.egyptPoints ? <span style={{ color: 'var(--green)', marginInlineStart: 12 }}>● {t.walletEgyptLbl}</span> : null}
                    </div>
                  </>
                ) : (
                  <div className="ai-meta">{t.walletTrendEmpty}</div>
                )}
                {walletHedgeMetric ? (
                  <div style={{ marginTop: 14, borderTop: '1px dashed #dfe8dc', paddingTop: 12 }}>
                    <div className="lbl" style={{ marginBottom: 6 }}>{t.walletHedgeLbl}</div>
                    <div className="delta" style={{ color: walletHedgeMetric.diffPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      <span className="num">{walletHedgeMetric.diffPct >= 0 ? '▲' : '▼'} {fmt(Math.abs(walletHedgeMetric.diffPct), 1)}%</span>{' '}
                      {walletHedgeMetric.diffPct >= 0
                        ? t.walletHedgeAheadMsg.replace('{gold}', fmt(walletHedgeMetric.walletChangePct, 1)).replace('{egp}', fmt(walletHedgeMetric.egpChangePct, 1))
                        : t.walletHedgeBehindMsg.replace('{gold}', fmt(walletHedgeMetric.walletChangePct, 1)).replace('{egp}', fmt(walletHedgeMetric.egpChangePct, 1))}
                    </div>
                    <div className="ai-meta">{t.walletSinceLbl} {new Date(walletHedgeMetric.sinceDate).toLocaleDateString(state.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <details>
              <summary>{t.expWalletT}</summary>
              <div className="exp">{t.expWallet}</div>
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

          <div className="foot">
            {t.footFramework.replace('{date}', new Date().toLocaleDateString(state.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' }))} {t.foot}
          </div>
        </div>
      </div>
    </div>
  );
}

const T = {
  ar: {
    dir: 'rtl', langBtn: 'EN', eyebrow: 'خاص · مباشر', title: 'غرفة عمليات الذهب', homeTab: 'غرفة العمليات', marketTab: 'الأسعار المباشرة', calcTab: 'حاسبة الشراء بالأعيرة', targetTab: 'السعر المستهدف المرجّح', scenTab: 'سيناريوهات الأوزان', egyptTab: 'السوق المصري', aiTab: 'المحلل الذكي', dcaTab: 'خطة الدخول التدريجي', watchTab: 'قائمة المراقبة', walletTab: 'محفظتي', settingsTab: 'الإعدادات',
    egyptHeading: 'أسعار السوق المصري المحلي', egyptSell: 'سعر البيع', egyptBuy: 'سعر الشراء', egyptLoading: 'بيجيب الأسعار من آي صاغة…', egyptErr: 'تعذر جلب أسعار آي صاغة — ', egyptSourceNote: 'المصدر: iSagha.com (آخر تحديث)', egyptStaleNote: 'تعذر سحب الأسعار الحية — دي آخر أسعار معروفة من',
    inSpot: 'أونصة الذهب $', inEgp: 'دولار / جنيه', inPrem: 'مصنعية %', ounce: 'الأونصة', ounceU: 'التحويل المباشر بدون مصنعية',
    g24: 'جرام 24', g21: 'جرام 21', g18: 'جرام 18', gp: 'الجنيه الذهب', inclU: 'جنيه · شامل المصنعية', gpU: 'جنيه · 8 جرام عيار 21',
    pull: '⟳ تحديث الأسعار مباشرة', stampInit: 'بيتحدّث تلقائيًا مع الفتح', expGramT: 'إزاي بنحسب سعر الجرام؟', expGram: 'سعر الذهب عالميًا بيتسعّر بالدولار للأونصة. بناخد سعر الأونصة ÷ 31.1 × سعر الدولار بالجنيه = جرام 24 بالجنيه. عيار 21 = جرام 24 × 0.875، والجنيه الذهب = 8 جرام عيار 21.',
    calcT: 'حاسبة الشراء بالأعيرة', calcAmt: 'المبلغ', calcCur: 'جنيه — يجيبلك:', thK: 'العيار', thP: 'سعر الجرام', thQ: 'الكمية', k24: 'عيار 24 (سبائك)', k22: 'عيار 22', k21: 'عيار 21', k18: 'عيار 18 (مشغولات)', gpRow: 'جنيهات ذهب', change: 'فكة', expKaratT: 'إيه الفرق بين الأعيرة؟', expKarat: 'العيار = نسبة الذهب الخالص. 24 = 99.9% (سبائك)، 22 = 91.7%، 21 = 87.5% (الأشهر في مصر)، 18 = 75% (مشغولات).', calcSpreadNote: 'دي قيمة الذهب الخام بالسعر اللي حددته + الهامش بتاعك — التاجر هيضيف مصاريف بيع/شراء (سبريد)، والمشغولات (عيار 18) بتضاف عليها مصنعية ممكن تبقى نسبة كبيرة من السعر. السعر الفعلي عند البيع أو الشراء هيكون مختلف.',
    targetLbl: 'السعر المستهدف المرجّح بالاحتمالات', deltaVs: 'عن السعر الحالي', bandNote: 'السعر الحالي خارج نطاقات السيناريوهات التلاتة. السوق مختلف مع أوزانك — راجعها بالسحب تحت.', expWT: 'يعني إيه "مرجّح بالاحتمالات"؟', expW: 'بدل ما تراهن على سيناريو واحد، بنحسب متوسط مرجّح للسيناريوهات التلاتة — وكل ما تبقى واثق أكتر في سيناريو معين (يعني رفعت وزنه)، بيأثر أكتر في الناتج. طريقة الحساب: نضرب متوسط نطاق سعر كل سيناريو (أقل سعر + أعلى سعر ÷ 2) في وزنه، نجمع التلاتة، وبعدين نقسم على 100. لو رفعت وزن سيناريو، الهدف هيتحرك ناحية نطاقه.', formulaLbl: 'الحساب المباشر:', expWUse: 'إزاي تستخدمه: السعر ده مش توقّع لسعر الذهب — هو نقطة مرجعية مبنية على رؤيتك انت، وتقارنه بالسعر الحالي فوق عشان تعرف موقفك.', targetBuyHint: 'السعر الحالي أقل من هدفك، يعني الذهب رخيص نسبيًا مقارنة بأوزان السيناريوهات بتاعتك — غالبًا إشارة معقولة إنك تشتري أو تنفّذ الدفعة الجاية من خطة الدخول.', targetHoldHint: 'السعر الحالي مساوي أو أعلى من هدفك، يعني الذهب غالي نسبيًا مقارنة بأوزانك — غالبًا إشارة إنك تستنى فرصة دخول أحسن بدل ما تستعجل.', targetCaveat: 'ده مؤشر بسيط مبني على مدخلاتك انت مش نصيحة مالية — خد بالك من عوامل تانية قبل أي قرار.', alertTargetOnLbl: 'هتتنبّه لو السعر نزل تحت هدفك', alertTargetOffLbl: 'نبّهني لو السعر نزل تحت هدفك', alertDismissBtn: 'إخفاء', alertTargetNoteBelow: 'السعر الحالي أقل من هدفك بـ {pct}%. ده معناه إن الذهب حاليًا أرخص من القيمة اللي أوزان السيناريوهات بتاعتك بتقول عليها — غالبًا فرصة معقولة إنك تشتري أو تنفّذ دفعة من خطة الدخول التدريجي بدل ما تستنى. لو الزرار مفعّل، التنبيه ده هيبان دلوقتي فوق.', alertTargetNoteAbove: 'السعر الحالي أعلى من هدفك بـ {pct}%، يعني الذهب غالي شوية مقارنة برؤيتك انت — مفيش داعي تشتري دلوقتي. فعّل التنبيه عشان نقولك أول ما يرجع ينزل تحت الهدف، بدل ما تفضل تراجع بنفسك كل يوم.', scen: { deesc: { name: 'تغيرات جيوسياسية', sub: 'Geopolitical Changes', thesis: 'تهدئة عالمية في التوترات الجيوسياسية (مش بس إيران) + تحوّل الفيدرالي + عودة تدفقات الصناديق' }, base: { name: 'السيناريو الأساسي', sub: 'Base Case', thesis: 'شراء البنوك المركزية (~720 طن/سنة) في مواجهة الفايدة المرتفعة' }, stag: { name: 'فخ الركود التضخمي', sub: 'Stagflation', thesis: 'رفع فايدة وسط ضعف اقتصادي + ضغط دولاري + بيع اضطراري' } }, expScT: 'إيه هي السيناريوهات والأوزان دي؟', expSc: 'كل بطاقة هي سيناريو: نطاق سعر محتمل للذهب (الباند) وليه وزن (%) بيعبّر عن مدى ثقتك إن السيناريو ده هيحصل — كل ما الوزن أعلى، كل ما ثقتك فيه أكبر. مجموع الأوزان التلاتة لازم يفضل دايمًا 100%، فلو رفعت وزن سيناريو، الاتنين التانيين بينزلوا تلقائيًا. الأوزان دي هي اللي بتحدد السعر المستهدف المرجّح فوق مباشرة — والمحلل الذكي كمان ممكن يقترح أوزان جديدة بناءً على بحث لحظي، وتقدر تطبقها بضغطة واحدة.', watchImpliedLbl: 'الأوزان المقترحة من لوحة المتابعة', watchApplyBtn: 'طبّق أوزان لوحة المتابعة', aiT: 'المحلل الذكي', aiGo: '⚡ حلّل السوق بناءً على إطاري', aiLvl: 'مستوى الشرح', aiLvlBeg: 'مبتدئ', aiLvlExp: 'خبير', aiGoing: 'بيبحث في السوق ويحلل…', aiErr: 'فشل التحليل — ', aiTrendsH: 'اللي حرّك السوق', aiWeightsH: 'الأوزان المقترحة', aiApply: 'طبّق الأوزان دي على السيناريوهات', aiApplied: '✓ اتطبقت', aiTrancheH: 'قرار الدفعة الثانية', aiEgpH: 'قراءة الجنيه', aiWalletH: 'إعادة تقييم المحفظة', aiWatchH: 'قراءة لوحة المتابعة', aiDisc: 'تحليل آلي مبني على بحث لحظي — راجعه بعقلك قبل أي قرار.', expAiT: 'إزاي المحلل ده شغال؟', expAi: 'الزرار بيبعت حالة اللوحة كاملة — الأسعار الحية، أوزانك، السعر المرجّح، حالة الدفعات، ألوان المتابعة — لنموذج Claude ومعاه صلاحية بحث في الإنترنت.', dcaT: 'خطة الدخول التدريجي · 40 / 35 / 25', startDateLbl: 'تاريخ البداية', budgetLbl: 'إجمالي مبلغ الاستثمار', cur: 'جنيه', tranches: ['الدفعة الأولى', 'الدفعة الثانية', 'الدفعة الثالثة'], nowMark: '← دلوقتي', expDcaT: 'ليه الشراء على 3 دفعات مش مرة واحدة؟', expDca: 'دي استراتيجية DCA: توزيع الشراء بدل توقيت السوق بدل ما تشتري كل حاجة مرة واحدة. حدد تاريخ البداية وإجمالي المبلغ، والتقسيم 40 / 35 / 25 بيوزّعهم على 3 دفعات كل واحدة بعد التانية بشهرين.', alertDcaOnLbl: 'هتتنبّه لما دفعة تفتح', alertDcaOffLbl: 'نبّهني لما دفعة تفتح', alertDcaOpenMsg: 'دفعة من خطة الدخول التدريجي فتحت. فكرة الـDCA إنك تشتري على دفعات ثابتة بدل ما تحاول تحزر أحسن توقيت — نفّذ الدفعة دي حتى لو السعر مش شكله مثالي، عشان تحافظ على انضباط الخطة.', alertDcaNoteOpen: 'في دفعة مفتوحة دلوقتي وجاهزة للتنفيذ. فعّل التنبيه عشان تتأكد إنك مش هتفوّت الالتزام بجدول الدخول التدريجي.', alertDcaNoteNext: 'الدفعة الجاية هتفتح في {date}. مفيش داعي تتصرف قبل كده — هدف الـDCA إنك توزّع الشراء بدل ما تحاول تدخل في التوقيت "المثالي".', alertDcaNoteDone: 'كل الدفعات خلصت. راجع لو لسه محتاج تزوّد استثمارك في الذهب، أو ابدأ خطة جديدة لو عايز تكمل الدخول التدريجي.', watchT: 'لوحة المتابعة — اضغط للتبديل · × للحذف', addMonPh: 'متغير جديد (مثلًا: أسعار النفط)…', addMonBtn: 'أضف', delMon: 'احذف المتغير', siglbl: ['داعم', 'مراقبة', 'خطر'] as const, expMonT: 'إيه المتغيرات دي وليه؟', expMon: 'الزر الأخضر = داعم، الأصفر = مراقبة، الأحمر = خطر على الأطروحة.',
    walletT: 'قيمة محفظتي', walletKaratCol: 'العيار / الوحدة', walletAmountCol: 'الكمية اللي معاك', walletTotalLbl: 'الإجمالي', walletOzLbl: 'أونصة (عيار 24)', walletG24Lbl: 'دهب 24 (سبائك)', walletG21Lbl: 'دهب 21 (فكة/جرامات)', walletG18Lbl: 'دهب 18 (مشغولات)', walletPoundsLbl: 'جنيهات ذهب (كل جنيه = 8 جرام 21)', walletIntlLbl: 'القيمة بالسعر العالمي', walletEgyptLbl: 'القيمة بالسوق المصري (حي)', walletDeltaLbl: 'فرق عن السعر العالمي', walletNoEgyptData: 'اضغط "اسحب أسعار مصر" في تبويب السوق المصري الأول', walletEmptyHint: 'دخّل كمية الدهب اللي معاك في أي عيار عشان تشوف قيمة محفظتك.', walletSaveBtn: 'حفظ الكمية', walletSaving: 'بيتحفظ…', walletLockNote: 'بعد الحفظ، الكميات دي هتتقفل ومش هتتعدل غير عن طريق عمليات شراء/بيع، أو لو طلبت تصحيح.', walletModifyBtn: 'طلب تصحيح / تعديل الكمية', walletCorrectingLbl: 'وضع التصحيح مفعّل', walletLockedNote: 'الكميات دي متقفلة عشان تفضل متزامنة مع سجل عمليات الشراء والبيع. لو فيه غلط، اطلب تصحيح.', walletChangeLbl: 'نسبة الربح/الخسارة من آخر تقييم', walletSinceLbl: 'مقارنةً بـ', walletTrendLbl: 'اتجاه قيمة المحفظة', walletTrendEmpty: 'لسه مفيش بيانات كفاية للرسم — ارجع تاني بكرة عشان تشوف الاتجاه.', walletHedgeLbl: 'فعالية التحوّط ضد الجنيه', walletHedgeAheadMsg: 'محفظتك زادت {gold}% بينما الدولار زاد {egp}% مقابل الجنيه — يعني الذهب حماك من تراجع الجنيه وكمان زوّد قيمتك الحقيقية.', walletHedgeBehindMsg: 'محفظتك زادت {gold}% بينما الدولار زاد {egp}% مقابل الجنيه — يعني الذهب مقدرش يواكب معدل تراجع الجنيه في الفترة دي.', walletTxT: 'سجّل عملية شراء أو بيع', walletTxUnitLbl: 'الوحدة', walletTxBuy: 'شراء', walletTxSell: 'بيع', walletTxAmountLbl: 'الكمية', walletTxPriceLbl: 'السعر', walletTxSubmit: 'سجّل العملية', walletTxSubmitting: 'بيتسجل…', walletTxAmountError: 'أدخل كمية أكبر من صفر', walletTxEditingT: 'تعديل العملية', walletTxUpdate: 'حفظ التعديل', walletTxDateLbl: 'تاريخ العملية', walletTxLookupLbl: 'السعر المرجعي الحالي:', walletTxUseLookup: 'استخدم هذا السعر', walletTxDeleteConfirm: 'متأكد إنك عايز تحذف العملية دي؟ هيتم تعديل رصيد المحفظة تبعًا لذلك.', walletExportBtn: 'تحميل سجل العمليات (CSV)', walletCostBasisLbl: 'الربح والخسارة مقارنة بسعر الشراء', walletAvgCostLbl: 'متوسط سعر الشراء', walletUnrealizedLbl: 'ربح/خسارة غير محقق', walletRealizedLbl: 'إجمالي الربح المحقق من البيع', walletCostBasisNote: 'ده مقارنة بالسعر اللي فعلاً دفعته وقت الشراء (من سجل العمليات)، مش بآخر تقييم — عشان تعرف هل أنت رابح أو خسران فعليًا من أول ما اشتريت.', expWalletT: 'إزاي بتتحسب القيمة دي؟', expWallet: 'دخّل اللي معاك بكل عيار (بما فيها الأونصة)، وهنحسبلك قيمتين بالجنيه المصري: الأولى بالسعر العالمي (نفس السعر المحسوب في تبويب الحاسبة، بناءً على سعر الأونصة العالمي + سعر الدولار + الهامش اللي حددته)، والتانية بسعر السوق المصري الحي فعليًا (سعر الشراء اللي التاجر هيدفعهولك لو بعت النهارده، من نفس بيانات تبويب السوق المصري). الفرق بين الاتنين بيوريك هل السوق المحلي بيدفع زيادة أو ناقص عن القيمة العالمية النظرية.',
    aiUsingProvider: 'المزوّد المستخدم', aiNoProvider: 'مفيش مزوّد مُفعّل — روح الإعدادات', settingsHeading: 'إعدادات نموذج الذكاء الاصطناعي', settingsAddHeading: 'إضافة / تعديل مزوّد', settingsEmpty: 'لسه مفيش مزوّدين متضافين.', settingsTypeLabel: 'النوع', settingsLabelLabel: 'الاسم', settingsBaseUrlLabel: 'رابط الخادم', settingsApiKeyLabel: 'مفتاح API', settingsApiKeyUnchangedPh: 'اتركه فاضي عشان يفضل زي ما هو', settingsModelLabel: 'الموديل', settingsSaveBtn: 'حفظ', settingsCancelBtn: 'إلغاء', settingsActivateBtn: 'تفعيل', settingsActiveBadge: 'مُفعّل', settingsEditBtn: 'تعديل', settingsDeleteBtn: 'حذف', settingsTypeOllama: 'Ollama (محلي)', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'مخصص', settingsTestBtn: 'اختبار الاتصال', settingsTesting: 'بيتم الاختبار…', settingsTestSuccess: '✓ نجح الاتصال —', settingsTestError: '✗ فشل الاتصال —', settingsValidationError: 'الاسم والموديل مطلوبين',
    foot: 'الأسعار من مصادر مجانية بدون مفاتيح. أداة تحليل شخصية — مش نصيحة استثمارية.', footFramework: 'الإطار: {date}.' },
  en: {
    dir: 'ltr', langBtn: 'عربي', eyebrow: 'PRIVATE · LIVE', title: 'Gold Hedge Cockpit', homeTab: 'Operations Room', marketTab: 'Live Market', calcTab: 'Karat Purchase Calculator', targetTab: 'Probability-Weighted Target', scenTab: 'Scenario Weights', egyptTab: 'Egypt Market', aiTab: 'AI Analyst', dcaTab: 'DCA Plan', watchTab: 'Watchlist', walletTab: 'My Wallet', settingsTab: 'Settings',
    egyptHeading: 'LOCAL EGYPTIAN MARKET PRICES', egyptSell: 'Sell', egyptBuy: 'Buy', egyptLoading: 'Fetching prices from iSagha…', egyptErr: 'Could not reach iSagha — ', egyptSourceNote: 'Source: iSagha.com (last updated)', egyptStaleNote: 'Live pull failed — showing last known prices from',
    inSpot: 'XAU/USD', inEgp: 'USD/EGP', inPrem: 'PREMIUM %', ounce: 'Ounce', ounceU: 'direct conversion, no premium',
    g24: '24k gram', g21: '21k gram', g18: '18k gram', gp: 'Gold pound', inclU: 'EGP · incl. premium', gpU: 'EGP · 8g of 21k',
    pull: '⟳ PULL LIVE MARKET', stampInit: 'Auto-pulls on open', expGramT: 'How is the gram price computed?', expGram: 'Gold is priced globally in USD per troy ounce. Ounce ÷ 31.1 × USD/EGP = 24k gram in EGP. 21k = 24k × 0.875; a gold pound = 8g of 21k.',
    calcT: 'KARAT PURCHASE CALCULATOR', calcAmt: 'Amount', calcCur: 'EGP buys you:', thK: 'Karat', thP: 'Per gram', thQ: 'Quantity', k24: '24k (bullion)', k22: '22k', k21: '21k', k18: '18k (jewelry)', gpRow: 'Gold pounds', change: 'change', expKaratT: "What's the difference between karats?", expKarat: 'Karat = purity. 24 = 99.9% (bullion), 22 = 91.7%, 21 = 87.5% (Egypt\'s standard), 18 = 75% (jewelry).', calcSpreadNote: 'This is raw metal value at your set price + premium — dealers add their own buy/sell spread, and jewelry (18k) usually adds a manufacturing charge that can be a large share of the price. The price you actually pay or receive will differ from this figure.',
    targetLbl: 'PROBABILITY-WEIGHTED TARGET', deltaVs: 'vs. spot', bandNote: 'Spot sits outside all three bands. The market disagrees with your weights — drag below.', expWT: 'What does "probability-weighted" mean?', expW: 'Instead of betting on one scenario, we take a weighted average of the three scenario targets — the more likely you think a scenario is (the higher its weight), the more it counts. How it\'s calculated: multiply each scenario\'s price-band midpoint (low + high ÷ 2) by its weight, add the three together, then divide by 100. Raise a scenario\'s weight and the target shifts toward its band.', formulaLbl: 'Live calculation:', expWUse: 'How to use it: this isn\'t a price prediction — it\'s a reference point built from your own view. Compare it against the live spot price above to see where you stand.', targetBuyHint: 'Spot is trading below your target, which means gold looks relatively cheap against your own scenario weights — often a reasonable signal to buy or deploy your next DCA tranche.', targetHoldHint: 'Spot is trading at or above your target, which means gold looks relatively expensive against your own scenario weights — often a reasonable signal to hold off and wait for a better entry.', targetCaveat: 'This is a simple heuristic based on your own inputs, not financial advice — weigh other factors before deciding.', alertTargetOnLbl: "You'll be notified when spot drops below your target", alertTargetOffLbl: 'Notify me when spot drops below my target', alertDismissBtn: 'Dismiss', alertTargetNoteBelow: 'Spot is {pct}% below your target, which means gold is currently trading cheaper than what your own scenario weights say it should be worth — often a reasonable moment to buy, or to run your next DCA tranche instead of waiting. With this on, that would show as a notice above right now.', alertTargetNoteAbove: "Spot is {pct}% above your target, so gold looks a bit expensive against your own view — no strong reason to buy at this price. Turn this on and we'll flag it the moment it drops back below your target, instead of you having to check manually every day.", scen: { deesc: { name: 'Geopolitical Changes', sub: 'تغيرات جيوسياسية', thesis: 'Global geopolitical tensions ease broadly (not just Iran), Fed pivots, ETF inflows return' }, base: { name: 'Base Case', sub: 'الأساسي', thesis: 'CB buying ~720t/yr vs. elevated rates — grind higher' }, stag: { name: 'Stagflation Trap', sub: 'فخ الركود', thesis: 'Fed hikes into weakness, dollar squeeze, forced selling' } }, expScT: 'What are these scenarios and weights?', expSc: 'Each panel is a scenario: a possible price range for gold (the band) with a weight (%) showing how confident you are it plays out — the higher the weight, the more confident. The three weights always add up to 100%, so raising one scenario\'s weight automatically lowers the other two. These weights directly drive the probability-weighted target above — the AI Analyst can also suggest new weights based on live research, which you can apply with one tap.', watchImpliedLbl: 'Watchlist-implied weights', watchApplyBtn: 'Apply watchlist weights', aiT: 'AI ANALYST', aiGo: '⚡ Analyze the market against my framework', aiLvl: 'Explanation level', aiLvlBeg: 'Beginner', aiLvlExp: 'Expert', aiGoing: 'Searching & analyzing…', aiErr: 'Analysis failed — ', aiTrendsH: 'WHAT MOVED THE MARKET', aiWeightsH: 'SUGGESTED WEIGHTS', aiApply: 'Apply these weights to the scenarios', aiApplied: '✓ Applied', aiTrancheH: 'TRANCHE 2 CALL', aiEgpH: 'EGP READ', aiWalletH: 'WALLET RE-EVALUATION', aiWatchH: 'WATCHLIST READ', aiDisc: 'Machine analysis on live search — apply your own judgment before acting.', expAiT: 'How does this analyst work?', expAi: 'The button sends your full cockpit state — live prices, your weights, the weighted target, tranche status, watchlist colors — to Claude with web-search access.', dcaT: 'DCA PLAN · 40 / 35 / 25', startDateLbl: 'Start date', budgetLbl: 'Total investment', cur: 'EGP', tranches: ['Tranche 1', 'Tranche 2', 'Tranche 3'], nowMark: '← now', expDcaT: 'Why three tranches instead of one buy?', expDca: 'This is DCA: staged entry instead of timing the market or buying it all at once. Set your start date and total amount, and the 40 / 35 / 25 split spreads it across 3 tranches, each two months after the last.', alertDcaOnLbl: "You'll be notified when a tranche window opens", alertDcaOffLbl: 'Notify me when a tranche window opens', alertDcaOpenMsg: "A DCA tranche window is open. The point of dollar-cost averaging is to buy on a fixed schedule instead of trying to guess the best moment — go ahead and execute this tranche even if the price doesn't feel perfect, to keep the plan disciplined.", alertDcaNoteOpen: "A tranche window is open and ready to execute. Turn this on so you don't miss staying on schedule with your staged entry plan.", alertDcaNoteNext: 'Your next tranche opens {date}. No action needed before then — DCA works by spreading purchases out rather than trying to time the "perfect" entry.', alertDcaNoteDone: 'All tranches are complete. Review whether you want to add more to your gold position, or start a new plan to keep dollar-cost averaging.', watchT: 'WATCHLIST — TAP TO CYCLE · × TO DELETE', addMonPh: 'New variable (e.g. oil prices)…', addMonBtn: 'Add', delMon: 'Delete variable', siglbl: ['OK', 'Watch', 'Risk'] as const, expMonT: 'What are these variables?', expMon: 'Green = supportive, amber = watch, red = thesis risk.',
    walletT: 'My Wallet Value', walletKaratCol: 'Karat / unit', walletAmountCol: 'Amount you own', walletTotalLbl: 'Total', walletOzLbl: 'Ounces (24k)', walletG24Lbl: '24k gold (bullion)', walletG21Lbl: '21k gold (loose grams)', walletG18Lbl: '18k gold (jewelry)', walletPoundsLbl: 'Gold pounds (each = 8g of 21k)', walletIntlLbl: 'Value at international price', walletEgyptLbl: 'Value at Egyptian market (live)', walletDeltaLbl: 'vs. international value', walletNoEgyptData: 'Hit "Pull Egypt prices" on the Egypt Market tab first', walletEmptyHint: 'Enter how much gold you own in any karat to see your wallet\'s value.', walletSaveBtn: 'Save amounts', walletSaving: 'Saving…', walletLockNote: "Once saved, these amounts lock and can only change through buy/sell transactions, or by requesting a correction.", walletModifyBtn: 'Request a correction / edit amounts', walletCorrectingLbl: 'Correction mode on', walletLockedNote: 'These amounts are locked so they stay in sync with your buy/sell transaction history. If something is wrong, request a correction.', walletChangeLbl: 'Profit/loss since last evaluation', walletSinceLbl: 'vs.', walletTrendLbl: 'Wallet value trend', walletTrendEmpty: 'Not enough data yet to plot a trend — check back tomorrow to see it build up.', walletHedgeLbl: 'Hedge effectiveness vs. the pound', walletHedgeAheadMsg: 'Your wallet is up {gold}% while the dollar is up {egp}% against the pound — gold protected you from the pound\'s slide and added real value on top.', walletHedgeBehindMsg: "Your wallet is up {gold}% while the dollar is up {egp}% against the pound — gold hasn't kept pace with the pound's decline over this period.", walletTxT: 'Record a buy or sell', walletTxUnitLbl: 'Unit', walletTxBuy: 'Buy', walletTxSell: 'Sell', walletTxAmountLbl: 'Amount', walletTxPriceLbl: 'Price', walletTxSubmit: 'Record transaction', walletTxSubmitting: 'Recording…', walletTxAmountError: 'Enter an amount greater than zero', walletTxEditingT: 'Edit transaction', walletTxUpdate: 'Save changes', walletTxDateLbl: 'Transaction date', walletTxLookupLbl: 'Current reference price:', walletTxUseLookup: 'Use this price', walletTxDeleteConfirm: 'Delete this transaction? Your wallet balance will be adjusted accordingly.', walletExportBtn: 'Download transaction history (CSV)', walletCostBasisLbl: 'Profit/loss vs. what you paid', walletAvgCostLbl: 'Average buy price', walletUnrealizedLbl: 'Unrealized P&L', walletRealizedLbl: 'Total realized profit from sales', walletCostBasisNote: "This compares against what you actually paid at purchase (from your transaction history), not the last evaluation snapshot — so you know if you're really ahead or behind since you bought.", expWalletT: 'How is this value calculated?', expWallet: 'Enter what you own per karat (including ounces), and we compute two values in Egyptian Pounds: one at the international price (the same rate as the Calculator tab — global ounce price + USD/EGP rate + your set premium), and one at the actual live Egyptian market price (the dealer buy-back price for today, from the same data as the Egypt Market tab). The difference between the two shows whether the local market is paying more or less than the theoretical international value.',
    aiUsingProvider: 'Using provider', aiNoProvider: 'No active provider — go to Settings', settingsHeading: 'AI Model Settings', settingsAddHeading: 'Add / Edit Provider', settingsEmpty: 'No providers configured yet.', settingsTypeLabel: 'Type', settingsLabelLabel: 'Label', settingsBaseUrlLabel: 'Base URL', settingsApiKeyLabel: 'API key', settingsApiKeyUnchangedPh: 'Leave blank to keep unchanged', settingsModelLabel: 'Model', settingsSaveBtn: 'Save', settingsCancelBtn: 'Cancel', settingsActivateBtn: 'Set active', settingsActiveBadge: 'Active', settingsEditBtn: 'Edit', settingsDeleteBtn: 'Delete', settingsTypeOllama: 'Ollama (local)', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'Custom', settingsTestBtn: 'Test connection', settingsTesting: 'Testing…', settingsTestSuccess: '✓ Connection worked —', settingsTestError: '✗ Connection failed —', settingsValidationError: 'Label and Model are required',
    foot: 'Live prices from free keyless feeds. Personal analysis tool — not financial advice.', footFramework: 'Framework: {date}.' },
};

export default App;
