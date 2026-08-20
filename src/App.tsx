import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  activateProvider,
  analyzeViaBackend,
  createProvider,
  deleteProvider,
  fetchAnalyzeQuota,
  listProviders,
  testProvider,
  updateProvider,
  type AnalyzeQuota,
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
import { Sidebar, NAV_LABELS, type ScreenKey } from './ui/Sidebar';
import { Card, SectionLabel, Hairline, MetricRow, GlowBar, ChangeTag, Icon } from './ui/primitives';

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

const WALLET_UNIT_KEYS: (keyof WalletHoldings)[] = ['oz', 'g24', 'g21', 'g18', 'pounds'];

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

const TAB_KEYS: TabKey[] = ['home', 'market', 'calc', 'target', 'scenarios', 'egypt', 'ai', 'dca', 'watch', 'wallet', 'settings'];

function initialTabFromUrl(): TabKey {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return (TAB_KEYS as string[]).includes(tab ?? '') ? (tab as TabKey) : 'home';
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTabFromUrl);
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

  const [trancheDraft, setTrancheDraft] = useState<number[] | null>(null);
  const [trancheDraftError, setTrancheDraftError] = useState<string | null>(null);

  useEffect(() => {
    if (dcaPlan.data && trancheDraft === null) setTrancheDraft(dcaPlan.data.tranche_pcts);
  }, [dcaPlan.data, trancheDraft]);

  const updateTrancheDraftPct = (index: number, raw: string) => {
    setTrancheDraft((prev) => (prev ? prev.map((pct, i) => (i === index ? normNum(raw) : pct)) : prev));
  };

  const addTrancheDraftRow = () => setTrancheDraft((prev) => (prev ? [...prev, 0] : prev));
  const removeTrancheDraftRow = (index: number) =>
    setTrancheDraft((prev) => (prev && prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const saveTrancheDraft = () => {
    if (!trancheDraft) return;
    const sum = trancheDraft.reduce((total, pct) => total + pct, 0);
    if (Math.abs(sum - 100) > 0.01) {
      setTrancheDraftError(t.dcaSplitSumError.replace('{sum}', fmt(sum, 1)));
      return;
    }
    setTrancheDraftError(null);
    patchDcaPlan({ tranche_pcts: trancheDraft });
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

      if (!wasLocked) {
        // First-time entry: server-side holdings are still 0 for every unit
        // at this point, so instead of writing the numbers directly, back
        // each nonzero unit with a same-day "buy" transaction at today's
        // local price. That gives every unit a real cost basis from day
        // one instead of leaving it untracked — and if the user actually
        // knows their real historical purchase price/date, they can edit
        // or delete these afterward and log the real ones; transactions
        // always remain the source of truth for cost basis.
        const today = todayDateString();
        for (const unit of WALLET_UNIT_KEYS) {
          const qty = walletDraft[unit];
          if (qty <= 0) continue;
          const row = walletRows.find((r) => r.key === unit);
          const basePrice = row?.egyptPrice ?? row?.intlPrice ?? 0;
          if (basePrice <= 0) continue;
          await recordWalletTransaction({ unit, side: 'buy', amount: qty, price_egp: basePrice, recorded_at: today });
        }
        const data = await updateWalletHoldings({ locked: true });
        setWalletHoldings({ loading: false, error: null, data });
        const [transactions, costBasis] = await Promise.all([fetchWalletTransactions(), fetchWalletCostBasis()]);
        setWalletTransactions(transactions);
        setWalletCostBasis(costBasis);
      } else {
        const data = await updateWalletHoldings(walletDraft);
        setWalletHoldings({ loading: false, error: null, data });
      }

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
      // txForm.price holds the TOTAL transaction value, not the per-unit
      // price stored on the record — convert back for editing.
      price: String(Math.round(tx.price_egp * tx.amount * 100) / 100),
      date: tx.recorded_at.slice(0, 10),
    });
    setTxError(null);
  };

  const submitWalletTransaction = async () => {
    setTxError(null);
    const amount = normNum(txForm.amount);
    const totalPrice = normNum(txForm.price);
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
        // The form collects the total EGP paid/received for the whole
        // transaction (how people naturally think about a purchase); the
        // API stores and computes cost-basis in per-unit price, so convert
        // here rather than asking the user to do the division themselves.
        price_egp: totalPrice / amount,
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
    api_key: (providerForm.provider_type === 'ollama' || providerForm.provider_type === 'shared')
      ? null
      : (providerForm.api_key || null),
    model: providerForm.provider_type === 'shared' ? 'shared' : providerForm.model,
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
    const modelRequired = providerForm.provider_type !== 'shared';
    if (!providerForm.label.trim() || (modelRequired && !providerForm.model.trim())) {
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
    ({ ollama: t.settingsTypeOllama, openai: t.settingsTypeOpenAI, claude: t.settingsTypeClaude, custom: t.settingsTypeCustom, shared: t.settingsTypeShared }[type]);

  const [analyzeQuota, setAnalyzeQuota] = useState<AnalyzeQuota | null>(null);

  useEffect(() => {
    fetchAnalyzeQuota().then(setAnalyzeQuota).catch(() => {});
  }, [activeProvider?.id, state.ai.at]);

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
  const RECURRING_DISPLAY_COUNT = 12;
  const RECURRING_LOOKAHEAD_COUNT = 24;
  const tranchePct = dcaPlan.data?.tranche_pcts ?? [40, 35, 25];
  const dcaMode = dcaPlan.data?.mode ?? 'fixed';

  const dcaWindows = useMemo(() => {
    if (!dcaPlan.data) return null;
    const start = new Date(`${dcaPlan.data.start_date}T00:00:00`);
    const spacing = dcaPlan.data.spacing_months;
    const count = dcaPlan.data.mode === 'recurring' ? RECURRING_LOOKAHEAD_COUNT : dcaPlan.data.tranche_pcts.length;
    return Array.from({ length: count }, (_, index) => {
      const windowStart = new Date(start);
      windowStart.setMonth(windowStart.getMonth() + index * spacing);
      const windowEnd = new Date(start);
      windowEnd.setMonth(windowEnd.getMonth() + (index + 1) * spacing);
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

  const ar = state.lang === 'ar';
  const vault = state.theme === 'vault';
  const sidebarScreen: ScreenKey = activeTab === 'market' ? 'home' : (activeTab as ScreenKey);
  const screenTitle = NAV_LABELS[sidebarScreen][ar ? 'ar' : 'en'];

  return (
    <div className={vault ? 'theme-vault' : ''} style={{ height: '100vh', display: 'flex', background: 'var(--bg)' }} dir={ar ? 'rtl' : 'ltr'}>
      <Sidebar
        screen={sidebarScreen}
        setScreen={(s) => setActiveTab(s)}
        ar={ar}
        vault={vault}
        toggleTheme={() => setState((prev) => ({ ...prev, theme: prev.theme === 'vault' ? 'light' : 'vault' }))}
        toggleLang={toggleLang}
        liveLabel={`LIVE · $${fmt(state.spot)}`}
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--surface)',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--text)', fontFamily: ar ? 'var(--font-arabic)' : 'var(--font-sans)' }}>
              {screenTitle}
            </h1>
            <div className="muted-text font-mono" style={{ fontSize: 15, marginTop: 2 }}>{t.eyebrow}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="live-dot" />
              <span className="font-mono" style={{ fontSize: 16, color: 'var(--text-soft)' }}>XAU/USD</span>
              <span className="font-mono gold-text" style={{ fontSize: 18, fontWeight: 600 }}>${fmt(state.spot)}</span>
            </div>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>

          {(activeTab === 'home' || activeTab === 'market') && (
            <div>
              <Card>
                <SectionLabel text={t.ounce.toUpperCase()} />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span className="font-display" style={{ fontSize: 52, color: 'var(--text)', lineHeight: 1 }}>
                    ${fmt(state.spot)}
                  </span>
                  <span className="font-mono soft-text" style={{ fontSize: 17 }}>{fmt(ozEgp)} EGP</span>
                </div>
                <div className="muted-text" style={{ fontSize: 15, marginTop: 6 }}>{t.ounceU}</div>
              </Card>

              <div style={{ height: 16 }} />

              <Card>
                <SectionLabel text={t.calcT.toUpperCase()} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.inSpot}</div>
                    <input type="text" inputMode="decimal" className="font-mono" value={state.spot} onInput={(event) => updateNumber('spot', (event.target as HTMLInputElement).value)} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.inEgp}</div>
                    <input type="text" inputMode="decimal" className="font-mono" value={state.egp} onInput={(event) => updateNumber('egp', (event.target as HTMLInputElement).value)} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.inPrem}</div>
                    <input type="text" inputMode="decimal" className="font-mono" value={state.prem} onInput={(event) => updateNumber('prem', (event.target as HTMLInputElement).value)} style={{ width: '100%' }} />
                  </div>
                </div>
              </Card>

              <div style={{ height: 16 }} />

              <Card>
                <SectionLabel text={t.g24.toUpperCase() + ' / ' + t.g21.toUpperCase() + ' / ' + t.g18.toUpperCase() + ' / ' + t.gp.toUpperCase()} />
                <MetricRow label={t.g24} value={`${fmt(g24)} EGP`} gold />
                <Hairline />
                <MetricRow label={t.g21} value={`${fmt(g21)} EGP`} />
                <Hairline />
                <MetricRow label={t.g18} value={`${fmt(g18)} EGP`} />
                <Hairline />
                <MetricRow label={t.gp} value={`${fmt(pound)} EGP`} />
              </Card>

              <div style={{ height: 16 }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button className="btn-primary" onClick={() => void pullLive()}>{t.pull}</button>
                <div id="stamp" className="muted-text font-mono" style={{ fontSize: 14 }}>{state.stamp.txt || t.stampInit}</div>
              </div>
              {state.diag ? <pre className="font-mono" style={{ fontSize: 12, color: 'var(--down)', marginTop: 12, whiteSpace: 'pre-wrap' }}>{state.diag}</pre> : null}

              <details className="legacy-ui" style={{ marginTop: 16 }}>
                <summary>{t.expGramT}</summary>
                <div className="exp">{t.expGram}</div>
              </details>
            </div>
          )}

          {activeTab === 'calc' && (
            <div>
              <SectionLabel text={t.calcT.toUpperCase()} />
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span className="soft-text" style={{ fontSize: 17 }}>{t.calcAmt}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="font-mono"
                    value={state.calcamt}
                    onInput={(event) => updateNumber('calcamt', (event.target as HTMLInputElement).value)}
                    style={{ width: 140 }}
                  />
                  <span className="soft-text" style={{ fontSize: 17 }}>{t.calcCur}</span>
                </div>
              </Card>

              <div style={{ height: 14 }} />

              <Card>
                <div style={{ display: 'flex', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 0 10px' }}>
                  <span style={{ flex: 1 }}>{t.thK}</span>
                  <span style={{ flex: 1, textAlign: 'end' }}>{t.thP}</span>
                  <span style={{ flex: 1, textAlign: 'end' }}>{t.thQ}</span>
                </div>
                {karatRows.map((row) => {
                  const perGram = g24 * row.f;
                  return (
                    <div key={row.k} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 17, color: row.hl ? 'var(--gold)' : 'var(--text)' }}>{row.k}</span>
                      <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 17, color: row.hl ? 'var(--gold)' : 'var(--text)' }}>{fmt(perGram)} EGP</span>
                      <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 17, color: row.hl ? 'var(--gold)' : 'var(--text)' }}>{fmt(state.calcamt / perGram, 1)}g</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, fontSize: 17 }}>{t.gpRow}</span>
                  <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 17 }}>{fmt(pound)} EGP</span>
                  <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 17 }}>
                    {Math.floor(state.calcamt / pound)} <span className="muted-text" style={{ fontSize: 14 }}>+ {fmt(state.calcamt - Math.floor(state.calcamt / pound) * pound)} {t.change}</span>
                  </span>
                </div>
                <Hairline />
                <div className="muted-text" style={{ fontSize: 14, lineHeight: 1.7 }}>{t.calcSpreadNote}</div>
              </Card>

              <details className="legacy-ui" style={{ marginTop: 16 }}>
                <summary>{t.expKaratT}</summary>
                <div className="exp">{t.expKarat}</div>
              </details>
            </div>
          )}

          {activeTab === 'target' && (
            <div>
              <Card>
                <SectionLabel text={t.targetLbl.toUpperCase()} />
                <div className="font-display" style={{ fontSize: 52, color: 'var(--text)', lineHeight: 1 }}>${fmt(weighted)}</div>
                <div className="font-mono" style={{ fontSize: 16, marginTop: 8, color: delta >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta), 1)}% {t.deltaVs} ${fmt(state.spot)}
                </div>
                {!inBand ? <div className="muted-text" style={{ fontSize: 15, marginTop: 10, lineHeight: 1.7 }}>{t.bandNote}</div> : null}
              </Card>

              {targetAlertRule?.active && delta > 0 && !targetBannerDismissed ? (
                <>
                  <div style={{ height: 14 }} />
                  <Card style={{ borderInlineStartColor: 'var(--gold)', borderInlineStartWidth: 3 }} className="soft-text">
                    <span style={{ fontSize: 16 }}>{t.targetBuyHint}</span>
                    <span className="gold-text" style={{ cursor: 'pointer', textDecoration: 'underline', marginInlineStart: 10, fontSize: 16 }} onClick={() => setTargetBannerDismissed(true)}>
                      {t.alertDismissBtn}
                    </span>
                  </Card>
                </>
              ) : null}

              <div style={{ height: 14 }} />

              <Card>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!targetAlertRule?.active}
                    onClick={() => void toggleTargetAlert()}
                    style={{
                      position: 'relative',
                      flexShrink: 0,
                      width: 40,
                      height: 22,
                      marginTop: 1,
                      padding: 0,
                      border: 'none',
                      borderRadius: 999,
                      background: targetAlertRule?.active ? 'var(--gold)' : 'var(--border-solid)',
                      cursor: 'pointer',
                      transition: 'background .15s ease',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        insetInlineStart: targetAlertRule?.active ? 20 : 2,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: '#fff',
                        boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                        transition: 'inset-inline-start .15s ease',
                      }}
                    />
                  </button>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{targetAlertRule?.active ? t.alertTargetOnLbl : t.alertTargetOffLbl}</div>
                    <div className="muted-text" style={{ fontSize: 14, marginTop: 3, lineHeight: 1.6 }}>
                      {delta > 0
                        ? t.alertTargetNoteBelow.replace('{pct}', fmt(Math.abs(delta), 1))
                        : t.alertTargetNoteAbove.replace('{pct}', fmt(Math.abs(delta), 1))}
                    </div>
                  </div>
                </div>
              </Card>

              <details className="legacy-ui" style={{ marginTop: 16 }}>
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
          )}

          {activeTab === 'scenarios' && (
            <div>
              {SCEN_META.map((scenario) => {
                const label = t.scen[scenario.key];
                return (
                  <div key={scenario.key} style={{ marginBottom: 14 }}>
                    <Card style={{ borderInlineStartColor: scenario.color, borderInlineStartWidth: 3 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                          {label.name}
                          <span className="font-mono muted-text" style={{ fontSize: 13, marginInlineStart: 10 }}>{label.sub}</span>
                        </div>
                        <div className="font-mono" style={{ fontSize: 24, color: scenario.color }}>{state.weights[scenario.key]}%</div>
                      </div>
                      <div className="soft-text" style={{ fontSize: 14, margin: '6px 0 14px', lineHeight: 1.7 }}>
                        <span className="font-mono">${fmt(scenario.lo)}–${fmt(scenario.hi)}</span> · {label.thesis}
                      </div>
                      <GlowBar pct={state.weights[scenario.key]} color={scenario.color} />
                      <input
                        type="range"
                        min="2"
                        max="96"
                        value={state.weights[scenario.key]}
                        onInput={(event) => setWeight(scenario.key, Number((event.target as HTMLInputElement).value))}
                        style={{ width: '100%', marginTop: 10 }}
                      />
                    </Card>
                  </div>
                );
              })}

              <Card>
                <SectionLabel text={t.watchImpliedLbl.toUpperCase()} />
                <div className="soft-text font-mono" style={{ fontSize: 15, marginBottom: 8 }}>
                  <span className="up-text">{watchlistCounts.support} {t.siglbl[0]}</span> · <span className="gold-text">{watchlistCounts.monitor} {t.siglbl[1]}</span> · <span className="down-text">{watchlistCounts.risk} {t.siglbl[2]}</span>
                </div>
                <div className="font-mono" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                  {watchlistImpliedWeights.deesc}% / {watchlistImpliedWeights.base}% / {watchlistImpliedWeights.stag}%
                </div>
                <button className="btn-outline" onClick={applyWatchlistWeights}>{watchApplied ? t.aiApplied : t.watchApplyBtn}</button>
              </Card>

              <details className="legacy-ui" style={{ marginTop: 16 }}>
                <summary>{t.expScT}</summary>
                <div className="exp">{t.expSc}</div>
              </details>
            </div>
          )}

          {activeTab === 'egypt' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <SectionLabel text={t.egyptHeading.toUpperCase()} />
                <button className="btn-outline" onClick={loadEgyptPrices} disabled={egypt.loading} style={{ padding: '6px 14px', fontSize: 15 }}>
                  {egypt.loading ? t.egyptLoading : t.pull}
                </button>
              </div>
              <Card>
                {egypt.error ? <div className="down-text" style={{ fontSize: 15, marginBottom: 10 }}>{t.egyptErr}{egypt.error}</div> : null}
                {egypt.data ? (
                  <>
                    {egypt.data.stale ? (
                      <div className="down-text" style={{ fontSize: 14, marginBottom: 10 }}>
                        {t.egyptStaleNote} {new Date(egypt.data.fetchedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 0 10px' }}>
                      <span style={{ flex: 1 }}>{t.thK}</span>
                      <span style={{ flex: 1, textAlign: 'end' }}>{t.egyptSell}</span>
                      <span style={{ flex: 1, textAlign: 'end' }}>{t.egyptBuy}</span>
                    </div>
                    {egypt.data.rows.map((row) => (
                      <div key={row.karat} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ flex: 1, fontSize: 17 }}>{EGYPT_KARAT_LABEL[row.karat](t)}</span>
                        <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 17 }}>{fmt(row.sell)} EGP</span>
                        <span className="font-mono gold-text" style={{ flex: 1, textAlign: 'end', fontSize: 17 }}>{fmt(row.buy)} EGP</span>
                      </div>
                    ))}
                    <Hairline />
                    <div className="muted-text" style={{ fontSize: 13 }}>
                      {t.egyptSourceNote} · {new Date(egypt.data.fetchedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </>
                ) : null}
                {!egypt.data && !egypt.error && egypt.loading ? <div className="soft-text" style={{ fontSize: 16 }}>{t.egyptLoading}</div> : null}
              </Card>
            </div>
          )}

          {activeTab === 'ai' && (
            <div>
              <SectionLabel text={t.aiT.toUpperCase()} />
              <Card>
                <div className="soft-text" style={{ fontSize: 15, marginBottom: 6 }}>
                  {t.aiUsingProvider}: {activeProvider ? `${activeProvider.label} (${providerTypeLabel(activeProvider.provider_type)})` : t.aiNoProvider}
                </div>
                {analyzeQuota?.shared ? (
                  <div className="soft-text" style={{ fontSize: 15, marginBottom: 6 }}>
                    {t.aiQuotaLabel}: {analyzeQuota.limit - analyzeQuota.used}/{analyzeQuota.limit}
                  </div>
                ) : null}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 16px' }}>
                  <span className="muted-text" style={{ fontSize: 15 }}>{t.aiLvl}:</span>
                  <button className={state.aiLevel === 'beginner' ? 'btn-primary' : 'btn-outline'} style={{ padding: '5px 12px', fontSize: 15 }} onClick={() => setState((prev) => ({ ...prev, aiLevel: 'beginner' }))}>{t.aiLvlBeg}</button>
                  <button className={state.aiLevel === 'expert' ? 'btn-primary' : 'btn-outline'} style={{ padding: '5px 12px', fontSize: 15 }} onClick={() => setState((prev) => ({ ...prev, aiLevel: 'expert' }))}>{t.aiLvlExp}</button>
                </div>
                <button className="btn-primary" style={{ width: '100%' }} onClick={() => void analyze()} disabled={state.ai.loading}>{state.ai.loading ? t.aiGoing : t.aiGo}</button>
                {state.ai.error ? <div className="down-text" style={{ fontSize: 14, marginTop: 10, textAlign: 'center' }}>{t.aiErr}{state.ai.error}</div> : null}
                {state.ai.data ? (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div className="section-label gold-text" style={{ marginBottom: 6 }}>{state.lang === 'ar' ? 'ملخص سريع' : 'Quick read'}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.6 }}>{state.ai.data.one_liner}</div>
                    </div>
                    {state.ai.data.trends && state.ai.data.trends.length ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiTrendsH}</div>
                        {(state.ai.data.trends || []).map((item) => <div key={item} className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>• {item}</div>)}
                      </div>
                    ) : null}
                    {state.ai.data.suggested_weights ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiWeightsH}</div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          {SCEN_META.map((scenario) => (
                            <div key={scenario.key} style={{ flex: 1, background: 'var(--elevated)', border: '1px solid var(--border)', padding: 10, textAlign: 'center', borderRadius: 8 }}>
                              <div className="muted-text" style={{ fontSize: 12 }}>{t.scen[scenario.key].name}</div>
                              <div className="font-mono" style={{ fontSize: 16, marginTop: 4 }}>
                                {state.weights[scenario.key]}% → <span className="gold-text" style={{ fontWeight: 700 }}>{state.ai.data?.suggested_weights?.[scenario.key] ?? '-'}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>{state.ai.data.weights_reasoning}</div>
                        <button className="btn-outline" style={{ marginTop: 8, padding: '6px 14px', fontSize: 14 }} onClick={applyAI}>{state.ai.applied ? t.aiApplied : t.aiApply}</button>
                      </div>
                    ) : null}
                    {state.ai.data.tranche2 ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiTrancheH}</div>
                        <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>{state.ai.data.tranche2.reasoning}</div>
                      </div>
                    ) : null}
                    {state.ai.data.egp_read ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiEgpH}</div>
                        <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>{state.ai.data.egp_read}</div>
                      </div>
                    ) : null}
                    {state.ai.data.wallet_read ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiWalletH}</div>
                        <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>{state.ai.data.wallet_read}</div>
                      </div>
                    ) : null}
                    {state.ai.data.watchlist_read ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiWatchH}</div>
                        <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>{state.ai.data.watchlist_read}</div>
                      </div>
                    ) : null}
                    <div className="muted-text font-mono" style={{ fontSize: 13, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                      {state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}
                    </div>
                  </div>
                ) : null}
              </Card>
              <details className="legacy-ui" style={{ marginTop: 16 }}>
                <summary>{t.expAiT}</summary>
                <div className="exp">{t.expAi}</div>
              </details>
            </div>
          )}

          {activeTab === 'dca' && (
            <div>
              <SectionLabel text={`${t.dcaT}${dcaMode === 'fixed' ? ` · ${tranchePct.join(' / ')}` : ''}`.toUpperCase()} />
              <Card>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  <button className={dcaMode === 'fixed' ? 'btn-primary' : 'btn-outline'} style={{ padding: '6px 14px', fontSize: 15 }} onClick={() => patchDcaPlan({ mode: 'fixed' })}>{t.dcaModeFixed}</button>
                  <button className={dcaMode === 'recurring' ? 'btn-primary' : 'btn-outline'} style={{ padding: '6px 14px', fontSize: 15 }} onClick={() => patchDcaPlan({ mode: 'recurring' })}>{t.dcaModeRecurring}</button>
                </div>
                <div style={{ padding: '6px 0 4px' }}>
                  <span className="soft-text" style={{ fontSize: 17 }}>{t.startDateLbl}</span>
                </div>
                <input type="date" value={dcaPlan.data?.start_date ?? ''} onInput={(event) => patchDcaPlan({ start_date: (event.target as HTMLInputElement).value })} style={{ width: '100%', marginBottom: 8 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span className="soft-text" style={{ fontSize: 17, flex: 1 }}>{dcaMode === 'recurring' ? t.budgetMonthlyLbl : t.budgetLbl}</span>
                  <input type="text" inputMode="decimal" className="font-mono" value={dcaPlan.data?.total_investment_egp ?? 0} onInput={(event) => patchDcaPlan({ total_investment_egp: normNum((event.target as HTMLInputElement).value) })} style={{ width: 120 }} />
                  <span className="muted-text" style={{ fontSize: 15 }}>{t.cur}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span className="soft-text" style={{ fontSize: 17, flex: 1 }}>{t.spacingLbl}</span>
                  <input type="text" inputMode="numeric" className="font-mono" value={dcaPlan.data?.spacing_months ?? 2} onInput={(event) => patchDcaPlan({ spacing_months: Math.max(1, Math.round(normNum((event.target as HTMLInputElement).value))) })} style={{ width: 60 }} />
                  <span className="muted-text" style={{ fontSize: 15 }}>{t.spacingUnitLbl}</span>
                </div>
              </Card>
              {dcaPlan.error ? <div className="down-text" style={{ fontSize: 14, marginTop: 8 }}>{dcaPlan.error}</div> : null}

              {dcaMode === 'fixed' && trancheDraft ? (
                <>
                  <div style={{ height: 14 }} />
                  <Card>
                    <SectionLabel text={t.dcaSplitLbl.toUpperCase()} />
                    {trancheDraft.map((pct, index) => (
                      <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                        <span className="soft-text" style={{ fontSize: 16, flex: 1 }}>{t.trancheLbl} {index + 1}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="font-mono"
                          value={pct}
                          onInput={(event) => updateTrancheDraftPct(index, (event.target as HTMLInputElement).value)}
                          style={{ width: 70 }}
                        />
                        <span className="soft-text" style={{ fontSize: 16 }}>%</span>
                        {trancheDraft.length > 1 ? (
                          <span className="down-text" style={{ cursor: 'pointer', textDecoration: 'underline', fontSize: 14 }} onClick={() => removeTrancheDraftRow(index)}>
                            {t.settingsDeleteBtn}
                          </span>
                        ) : null}
                      </div>
                    ))}
                    <div className="muted-text font-mono" style={{ fontSize: 14, marginTop: 6 }}>
                      {t.dcaSplitSumLbl} {fmt(trancheDraft.reduce((total, pct) => total + pct, 0), 1)}%
                    </div>
                    {trancheDraftError ? <div className="down-text" style={{ fontSize: 14, marginTop: 4 }}>{trancheDraftError}</div> : null}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button className="btn-outline" style={{ padding: '6px 14px', fontSize: 15 }} onClick={addTrancheDraftRow}>{t.dcaAddTrancheBtn}</button>
                      <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 15 }} onClick={saveTrancheDraft}>{t.dcaSaveSplitBtn}</button>
                    </div>
                  </Card>
                </>
              ) : null}

              {dcaAlertRule?.active && dcaTrancheOpen && !dcaBannerDismissed ? (
                <>
                  <div style={{ height: 14 }} />
                  <Card style={{ borderInlineStartColor: 'var(--gold)', borderInlineStartWidth: 3 }} className="soft-text">
                    <span style={{ fontSize: 16 }}>{t.alertDcaOpenMsg}</span>
                    <span className="gold-text" style={{ cursor: 'pointer', textDecoration: 'underline', marginInlineStart: 10, fontSize: 16 }} onClick={() => setDcaBannerDismissed(true)}>
                      {t.alertDismissBtn}
                    </span>
                  </Card>
                </>
              ) : null}

              <div style={{ height: 14 }} />

              <Card>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!dcaAlertRule?.active}
                    onClick={() => void toggleDcaAlert()}
                    style={{
                      position: 'relative', flexShrink: 0, width: 40, height: 22, marginTop: 1, padding: 0, border: 'none',
                      borderRadius: 999, background: dcaAlertRule?.active ? 'var(--gold)' : 'var(--border-solid)', cursor: 'pointer',
                    }}
                  >
                    <span style={{ position: 'absolute', top: 2, insetInlineStart: dcaAlertRule?.active ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
                  </button>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{dcaAlertRule?.active ? t.alertDcaOnLbl : t.alertDcaOffLbl}</div>
                    <div className="muted-text" style={{ fontSize: 14, marginTop: 3, lineHeight: 1.6 }}>
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
              </Card>

              <div style={{ height: 14 }} />

              {(dcaMode === 'fixed'
                ? tranchePct.map((pct, index) => {
                    const totalInvestment = dcaPlan.data?.total_investment_egp ?? 0;
                    const amount = totalInvestment * pct / 100;
                    const grams = amount / g21;
                    const window = dcaWindows ? formatTrancheWindow(dcaWindows[index].windowStart, dcaWindows[index].windowEnd) : '';
                    const status = trancheStatus[index];
                    return (
                      <div key={index} style={{ marginBottom: 10 }}>
                        <Card
                          style={{
                            background: status === 'active' ? 'var(--gold-glow)' : undefined,
                            borderColor: status === 'active' ? 'var(--gold-dim)' : status === 'done' ? 'var(--up)' : undefined,
                            borderWidth: status !== 'pending' ? 2 : 1,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div className="font-display" style={{ fontSize: 26, color: status === 'active' ? 'var(--gold)' : 'var(--text)' }}>{pct}%</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 15, color: status === 'active' ? 'var(--gold)' : 'var(--text-soft)' }}>
                                {t.trancheLbl} {index + 1} · {window}
                                {status === 'done' ? ' ✓' : null}
                                {status === 'active' ? ` ${t.nowMark}` : null}
                              </div>
                            </div>
                            <div style={{ textAlign: 'end' }}>
                              <div className="font-mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{fmt(amount)} EGP</div>
                              <div className="font-mono muted-text" style={{ fontSize: 13 }}>≈ {fmt(grams, 1)}g 21k</div>
                            </div>
                          </div>
                        </Card>
                      </div>
                    );
                  })
                : (dcaWindows ?? []).slice(0, RECURRING_DISPLAY_COUNT).map(({ windowStart, windowEnd }, index) => {
                    const amount = dcaPlan.data?.total_investment_egp ?? 0;
                    const grams = amount / g21;
                    const window = formatTrancheWindow(windowStart, windowEnd);
                    const status = trancheStatus[index];
                    return (
                      <div key={index} style={{ marginBottom: 10 }}>
                        <Card
                          style={{
                            background: status === 'active' ? 'var(--gold-glow)' : undefined,
                            borderColor: status === 'active' ? 'var(--gold-dim)' : status === 'done' ? 'var(--up)' : undefined,
                            borderWidth: status !== 'pending' ? 2 : 1,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div className="font-display" style={{ fontSize: 26, color: status === 'active' ? 'var(--gold)' : 'var(--text)' }}>#{index + 1}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 15, color: status === 'active' ? 'var(--gold)' : 'var(--text-soft)' }}>
                                {t.deploymentLbl} · {window}
                                {status === 'done' ? ' ✓' : null}
                                {status === 'active' ? ` ${t.nowMark}` : null}
                              </div>
                            </div>
                            <div style={{ textAlign: 'end' }}>
                              <div className="font-mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{fmt(amount)} EGP</div>
                              <div className="font-mono muted-text" style={{ fontSize: 13 }}>≈ {fmt(grams, 1)}g 21k</div>
                            </div>
                          </div>
                        </Card>
                      </div>
                    );
                  }))}

              <details className="legacy-ui" style={{ marginTop: 6 }}>
                <summary>{t.expDcaT}</summary>
                <div className="exp">{t.expDca}</div>
              </details>
            </div>
          )}

          {activeTab === 'watch' && (
            <div>
              <SectionLabel text={t.watchT.toUpperCase()} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {state.monitors.map((monitor, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999,
                      background: 'var(--elevated)', border: '1px solid var(--border)', fontSize: 14, color: 'var(--text)',
                    }}
                  >
                    <span
                      onClick={() => cycleSignal(index)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: SIGCOL[monitor.sig] }} />
                      <span style={{ fontWeight: 600 }}>{state.lang === 'ar' ? monitor.ar : monitor.en}</span>
                      <span className="muted-text">· {t.siglbl[monitor.sig]}</span>
                    </span>
                    <span onClick={() => delMonitor(index)} title={t.delMon} className="muted-text" style={{ cursor: 'pointer', fontSize: 16 }}>×</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={state.newMonitor}
                  maxLength={40}
                  placeholder={t.addMonPh}
                  onInput={(event) => setState((prev) => ({ ...prev, newMonitor: (event.target as HTMLInputElement).value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') addMonitor(); }}
                  style={{ flex: 1 }}
                />
                <button className="btn-primary" onClick={addMonitor}>{t.addMonBtn}</button>
              </div>
              <details className="legacy-ui" style={{ marginTop: 16 }}>
                <summary>{t.expMonT}</summary>
                <div className="exp">{t.expMon}</div>
              </details>
            </div>
          )}

          {activeTab === 'wallet' && (
            <div>
              <SectionLabel text={t.walletT.toUpperCase()} />

              <Card>
                <div style={{ display: 'flex', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 0 10px' }}>
                  <span style={{ flex: 1 }}>{t.walletKaratCol}</span>
                  <span style={{ flex: 1, textAlign: 'end' }}>{t.walletAmountCol}</span>
                </div>
                {walletRows.map((row) => {
                  const draftValue = walletDraft ? walletDraft[row.key] : row.amount;
                  const hl = row.key === 'g24' || row.key === 'oz';
                  return (
                    <div key={row.key} style={{ display: 'flex', alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 17, color: hl ? 'var(--gold)' : 'var(--text)' }}>{t[row.labelKey]}</span>
                      <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 17, color: hl ? 'var(--gold)' : 'var(--text)' }}>
                        {walletEditing ? (
                          <input
                            type="text"
                            inputMode={row.key === 'oz' ? 'numeric' : 'decimal'}
                            className="font-mono"
                            value={row.key === 'oz' ? Math.round(draftValue) : Number(draftValue.toFixed(1))}
                            onInput={(event) => patchWalletHoldings(row.key, (event.target as HTMLInputElement).value)}
                            style={{ width: 100, textAlign: 'end' }}
                          />
                        ) : (
                          <span>{row.key === 'oz' ? Math.round(row.amount) : Number(row.amount.toFixed(1))}</span>
                        )}
                        {row.key === 'oz' || row.key === 'pounds' ? '' : ' g'}
                      </span>
                    </div>
                  );
                })}
                {walletHoldings.data?.locked ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 14 }}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={walletEditing}
                      onClick={() => (walletEditing ? cancelWalletEdit() : startWalletEdit())}
                      style={{
                        position: 'relative', flexShrink: 0, width: 40, height: 22, marginTop: 1, padding: 0, border: 'none',
                        borderRadius: 999, background: walletEditing ? 'var(--gold)' : 'var(--border-solid)', cursor: 'pointer',
                      }}
                    >
                      <span style={{ position: 'absolute', top: 2, insetInlineStart: walletEditing ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
                    </button>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{walletEditing ? t.walletCorrectingLbl : t.walletModifyBtn}</div>
                      <div className="muted-text" style={{ fontSize: 14, marginTop: 3, lineHeight: 1.6 }}>{walletEditing ? t.walletLockNote : t.walletLockedNote}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="muted-text" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.7 }}>{t.walletLockNote}</div>
                    <div className="muted-text" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.7 }}>{t.walletFirstSaveNote}</div>
                  </>
                )}
                {walletEditing ? (
                  <button className="btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={() => void saveWalletHoldings()} disabled={walletSaving}>
                    {walletSaving ? t.walletSaving : t.walletSaveBtn}
                  </button>
                ) : null}
              </Card>

              <div style={{ height: 14 }} />

              <Card>
                <SectionLabel text={(txEditingId !== null ? t.walletTxEditingT : t.walletTxT).toUpperCase()} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span className="soft-text" style={{ fontSize: 16, flex: 1 }}>{t.walletTxUnitLbl}</span>
                  <select
                    value={txForm.unit}
                    onChange={(event) => setTxForm((prev) => ({ ...prev, unit: (event.target as HTMLSelectElement).value as WalletUnit }))}
                  >
                    {walletRows.map((row) => (
                      <option key={row.key} value={row.key}>{t[row.labelKey]}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
                  <button
                    className={txForm.side === 'buy' ? 'btn-primary' : 'btn-outline'}
                    style={{ flex: 1, padding: '6px 0', fontSize: 15 }}
                    onClick={() => setTxForm((prev) => ({ ...prev, side: 'buy' }))}
                  >
                    {t.walletTxBuy}
                  </button>
                  <button
                    className={txForm.side === 'sell' ? 'btn-primary' : 'btn-outline'}
                    style={{ flex: 1, padding: '6px 0', fontSize: 15 }}
                    onClick={() => setTxForm((prev) => ({ ...prev, side: 'sell' }))}
                  >
                    {t.walletTxSell}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span className="soft-text" style={{ fontSize: 16, flex: 1 }}>{t.walletTxAmountLbl}</span>
                  <input
                    type="text"
                    inputMode={txForm.unit === 'oz' ? 'numeric' : 'decimal'}
                    className="font-mono"
                    value={txForm.amount}
                    onInput={(event) => setTxForm((prev) => ({ ...prev, amount: (event.target as HTMLInputElement).value }))}
                    style={{ width: 110 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span className="soft-text" style={{ fontSize: 16, flex: 1 }}>{t.walletTxPriceLbl}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="font-mono"
                    value={txForm.price}
                    onInput={(event) => setTxForm((prev) => ({ ...prev, price: (event.target as HTMLInputElement).value }))}
                    style={{ width: 110 }}
                  />
                  <span className="muted-text" style={{ fontSize: 14 }}>{t.cur}</span>
                </div>
                {(() => {
                  const amount = normNum(txForm.amount);
                  const total = normNum(txForm.price);
                  if (amount <= 0 || total <= 0) return null;
                  return (
                    <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
                      {t.walletTxPerUnitNote} {fmt(total / amount)} {t.cur}
                    </div>
                  );
                })()}
                {(() => {
                  const selectedRow = walletRows.find((r) => r.key === txForm.unit);
                  if (!selectedRow) return null;
                  const amount = normNum(txForm.amount);
                  const suggestedTotal = selectedRow.intlPrice * (amount > 0 ? amount : 1);
                  return (
                    <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
                      {t.walletTxLookupLbl} {fmt(selectedRow.intlPrice)} {t.cur} ({t.walletIntlLbl})
                      {selectedRow.egyptPrice !== null ? ` · ${fmt(selectedRow.egyptPrice)} ${t.cur} (${t.walletEgyptLbl})` : ''}
                      {' · '}
                      <span
                        className="gold-text"
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => setTxForm((prev) => ({ ...prev, price: String(suggestedTotal.toFixed(0)) }))}
                      >
                        {t.walletTxUseLookup}
                      </span>
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 6px' }}>
                  <span className="soft-text" style={{ fontSize: 16, flex: 1 }}>{t.walletTxDateLbl}</span>
                  <input
                    type="date"
                    value={txForm.date}
                    onInput={(event) => setTxForm((prev) => ({ ...prev, date: (event.target as HTMLInputElement).value }))}
                  />
                </div>
                {txError ? <div className="down-text" style={{ fontSize: 14, marginTop: 6 }}>{txError}</div> : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-primary" onClick={() => void submitWalletTransaction()} disabled={txSubmitting}>
                    {txSubmitting ? t.walletTxSubmitting : txEditingId !== null ? t.walletTxUpdate : t.walletTxSubmit}
                  </button>
                  {txEditingId !== null ? (
                    <button className="btn-outline" onClick={resetTxForm}>{t.settingsCancelBtn}</button>
                  ) : null}
                </div>

                {walletTransactions.length > 0 ? (
                  <>
                    <Hairline />
                    {walletTransactions.slice(0, 10).map((tx) => {
                      const row = walletRows.find((r) => r.key === tx.unit);
                      return (
                        <div key={tx.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 15, gap: 10 }}>
                          <div>
                            <span style={{ color: tx.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>{tx.side === 'buy' ? t.walletTxBuy : t.walletTxSell}</span>
                            {' · '}{row ? t[row.labelKey] : tx.unit}
                            <div className="muted-text" style={{ fontSize: 13, marginTop: 2 }}>{tx.recorded_at.slice(0, 10)}</div>
                          </div>
                          <div style={{ textAlign: 'end' }}>
                            <div className="font-mono">{fmt(tx.amount, tx.unit === 'oz' ? 0 : 1)}</div>
                            <div className="font-mono" style={{ fontSize: 14 }}>{fmt(tx.price_egp * tx.amount)} {t.cur}</div>
                            <div className="muted-text font-mono" style={{ fontSize: 12 }}>{fmt(tx.price_egp)} {t.cur} {t.walletTxPerUnitSuffix}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                            <span className="gold-text" style={{ cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }} onClick={() => startEditWalletTransaction(tx)}>
                              {t.settingsEditBtn}
                            </span>
                            <span className="down-text" style={{ cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }} onClick={() => void removeWalletTransaction(tx.id)}>
                              {t.settingsDeleteBtn}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <a href="/api/wallet/transactions/export.csv" download className="btn-outline" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none', fontSize: 14, padding: '6px 14px' }}>{t.walletExportBtn}</a>
                  </>
                ) : null}
              </Card>

              <div style={{ height: 14 }} />

              {walletHasHoldings ? (
                <Card>
                  <div style={{ display: 'flex', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 0 10px' }}>
                    <span style={{ flex: 1 }}>{t.walletKaratCol}</span>
                    <span style={{ flex: 1, textAlign: 'end' }}>{t.walletIntlLbl}</span>
                    <span style={{ flex: 1, textAlign: 'end' }}>{t.walletEgyptLbl}</span>
                  </div>
                  {walletRows.filter((row) => row.amount > 0).map((row) => (
                    <div key={row.key} style={{ display: 'flex', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 16 }}>{t[row.labelKey]}</span>
                      <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 16 }}>{fmt(row.amount * row.intlPrice)} {t.cur}</span>
                      <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 16 }}>{row.egyptPrice !== null ? `${fmt(row.amount * row.egyptPrice)} ${t.cur}` : '—'}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{t.walletTotalLbl}</span>
                    <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{fmt(walletIntlValue)} {t.cur}</span>
                    <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{walletEgyptValue !== null ? `${fmt(walletEgyptValue)} ${t.cur}` : '—'}</span>
                  </div>
                  {walletEgyptValue !== null ? (
                    <div className="font-mono" style={{ fontSize: 15, marginTop: 10, color: walletEgyptValue >= walletIntlValue ? 'var(--up)' : 'var(--down)' }}>
                      {walletEgyptValue >= walletIntlValue ? '▲' : '▼'} {fmt(Math.abs(((walletEgyptValue - walletIntlValue) / walletIntlValue) * 100), 1)}% {t.walletDeltaLbl}
                    </div>
                  ) : (
                    <div className="down-text" style={{ fontSize: 14, marginTop: 10 }}>{egypt.loading ? t.egyptLoading : t.walletNoEgyptData}</div>
                  )}
                  <div className="muted-text" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>{t.calcSpreadNote}</div>
                </Card>
              ) : (
                <Card className="soft-text" style={{ fontSize: 16 }}>{t.walletEmptyHint}</Card>
              )}

              {(() => {
                const totalRealized = walletCostBasis.reduce((sum, cb) => sum + cb.realizedEgp, 0);
                if (!walletHasHoldings && totalRealized === 0) return null;
                const anyUntracked = walletRows.some((row) => {
                  const cb = walletCostBasis.find((c) => c.unit === row.key);
                  return row.amount > (cb?.openQty ?? 0) + 0.001;
                });
                return (
                  <>
                    <div style={{ height: 14 }} />
                    <Card>
                      <SectionLabel text={t.walletCostBasisLbl.toUpperCase()} />
                      {walletHasHoldings ? (
                        <>
                          <div style={{ display: 'flex', fontSize: 14, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 0 10px' }}>
                            <span style={{ flex: 1 }}>{t.walletKaratCol}</span>
                            <span style={{ flex: 1, textAlign: 'end' }}>{t.walletAvgCostLbl}</span>
                            <span style={{ flex: 1, textAlign: 'end' }}>{t.walletUnrealizedLbl}</span>
                          </div>
                          {walletRows.filter((row) => row.amount > 0).map((row) => {
                            const cb = walletCostBasis.find((c) => c.unit === row.key);
                            const trackedQty = cb?.openQty ?? 0;
                            const untrackedQty = Math.max(0, row.amount - trackedQty);
                            const hasTrackedCost = cb && trackedQty > 0.001 && cb.avgCostEgp > 0;
                            const unrealizedPct = hasTrackedCost ? ((row.intlPrice - cb.avgCostEgp) / cb.avgCostEgp) * 100 : null;
                            return (
                              <div key={row.key} style={{ display: 'flex', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                                <span style={{ flex: 1, fontSize: 16 }}>
                                  {t[row.labelKey]}
                                  {untrackedQty > 0.001 ? (
                                    <span className="muted-text" style={{ display: 'block', fontSize: 13 }}>
                                      {t.walletUntrackedNote.replace('{qty}', fmt(untrackedQty, row.key === 'oz' ? 0 : 1))}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 16 }}>{hasTrackedCost ? `${fmt(cb!.avgCostEgp)} ${t.cur}` : '—'}</span>
                                <span className="font-mono" style={{ flex: 1, textAlign: 'end', fontSize: 16 }}>
                                  {unrealizedPct !== null ? (
                                    <span style={{ color: unrealizedPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                                      {unrealizedPct >= 0 ? '▲' : '▼'} {fmt(Math.abs(unrealizedPct), 1)}%
                                    </span>
                                  ) : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </>
                      ) : null}
                      {totalRealized !== 0 ? (
                        <div className="font-mono" style={{ fontSize: 15, marginTop: 10, color: totalRealized >= 0 ? 'var(--up)' : 'var(--down)' }}>
                          {totalRealized >= 0 ? '▲' : '▼'} {fmt(Math.abs(totalRealized))} {t.cur} {t.walletRealizedLbl}
                        </div>
                      ) : null}
                      <div className="muted-text" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>{t.walletCostBasisNote}</div>
                      {anyUntracked ? <div className="muted-text" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>{t.walletUntrackedGeneralNote}</div> : null}
                    </Card>
                  </>
                );
              })()}

              {walletHasHoldings && walletLastEvaluation ? (
                <>
                  <div style={{ height: 14 }} />
                  <Card>
                    <SectionLabel text={t.walletChangeLbl.toUpperCase()} />
                    {walletIntlChangePct !== null ? (
                      <div className="font-mono" style={{ fontSize: 15, color: walletIntlChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {walletIntlChangePct >= 0 ? '▲' : '▼'} {fmt(Math.abs(walletIntlChangePct), 1)}% {t.walletIntlLbl}
                      </div>
                    ) : null}
                    {walletEgyptChangePct !== null ? (
                      <div className="font-mono" style={{ fontSize: 15, marginTop: 4, color: walletEgyptChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {walletEgyptChangePct >= 0 ? '▲' : '▼'} {fmt(Math.abs(walletEgyptChangePct), 1)}% {t.walletEgyptLbl}
                      </div>
                    ) : null}
                    <div className="muted-text" style={{ fontSize: 13, marginTop: 8 }}>{t.walletSinceLbl} {new Date(walletLastEvaluation.recorded_at).toLocaleDateString(state.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</div>
                  </Card>
                </>
              ) : null}

              {walletHasHoldings ? (
                <>
                  <div style={{ height: 14 }} />
                  <Card>
                    <SectionLabel text={t.walletTrendLbl.toUpperCase()} />
                    {walletTrendChart ? (
                      <>
                        <svg viewBox={`0 0 ${walletTrendChart.width} ${walletTrendChart.height}`} style={{ width: '100%', height: 160 }}>
                          <polyline points={walletTrendChart.intlPoints} fill="none" stroke="var(--gold)" strokeWidth="2" />
                          {walletTrendChart.egyptPoints ? (
                            <polyline points={walletTrendChart.egyptPoints} fill="none" stroke="var(--up)" strokeWidth="2" />
                          ) : null}
                        </svg>
                        <div className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>
                          <span className="gold-text">● {t.walletIntlLbl}</span>
                          {walletTrendChart.egyptPoints ? <span className="up-text" style={{ marginInlineStart: 12 }}>● {t.walletEgyptLbl}</span> : null}
                        </div>
                      </>
                    ) : (
                      <div className="muted-text" style={{ fontSize: 15 }}>{t.walletTrendEmpty}</div>
                    )}
                    {walletHedgeMetric ? (
                      <div style={{ marginTop: 14, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
                        <div className="section-label" style={{ marginBottom: 6 }}>{t.walletHedgeLbl}</div>
                        <div className="font-mono" style={{ fontSize: 15, color: walletHedgeMetric.diffPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                          {walletHedgeMetric.diffPct >= 0 ? '▲' : '▼'} {fmt(Math.abs(walletHedgeMetric.diffPct), 1)}%{' '}
                          {walletHedgeMetric.diffPct >= 0
                            ? t.walletHedgeAheadMsg.replace('{gold}', fmt(walletHedgeMetric.walletChangePct, 1)).replace('{egp}', fmt(walletHedgeMetric.egpChangePct, 1))
                            : t.walletHedgeBehindMsg.replace('{gold}', fmt(walletHedgeMetric.walletChangePct, 1)).replace('{egp}', fmt(walletHedgeMetric.egpChangePct, 1))}
                        </div>
                        <div className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>{t.walletSinceLbl} {new Date(walletHedgeMetric.sinceDate).toLocaleDateString(state.lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</div>
                      </div>
                    ) : null}
                  </Card>
                </>
              ) : null}

              <details className="legacy-ui" style={{ marginTop: 16 }}>
                <summary>{t.expWalletT}</summary>
                <div className="exp">{t.expWallet}</div>
              </details>
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              <SectionLabel text={t.settingsHeading.toUpperCase()} />

              <Card>
                {providers.length === 0 ? <div className="soft-text" style={{ fontSize: 16 }}>{t.settingsEmpty}</div> : null}
                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      padding: '10px 12px', marginBottom: 8, borderRadius: 8,
                      background: provider.is_active ? 'var(--gold-glow)' : 'var(--elevated)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{provider.label}</div>
                      <div className="muted-text" style={{ fontSize: 14, marginTop: 2 }}>{providerTypeLabel(provider.provider_type)} · {provider.model}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {provider.is_active ? (
                        <span style={{ background: 'var(--gold)', color: '#0e1210', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}>{t.settingsActiveBadge}</span>
                      ) : (
                        <button className="btn-outline" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => void activate(provider.id)}>{t.settingsActivateBtn}</button>
                      )}
                      <button className="btn-outline" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => editProvider(provider)}>{t.settingsEditBtn}</button>
                      <button className="btn-outline" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => void removeProvider(provider.id)}>{t.settingsDeleteBtn}</button>
                    </div>
                  </div>
                ))}
              </Card>

              <div style={{ height: 14 }} />

              <Card>
                {providerError ? <div className="down-text" style={{ fontSize: 14, marginBottom: 10 }}>{providerError}</div> : null}
                <SectionLabel text={t.settingsAddHeading.toUpperCase()} />

                <div style={{ marginBottom: 12 }}>
                  <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.settingsTypeLabel}</div>
                  <select
                    value={providerForm.provider_type}
                    onChange={(event) => setProviderForm((prev) => ({ ...prev, provider_type: (event.target as HTMLSelectElement).value as ProviderType }))}
                    style={{ width: '100%' }}
                  >
                    <option value="ollama">{t.settingsTypeOllama}</option>
                    <option value="shared">{t.settingsTypeShared}</option>
                    <option value="openai">{t.settingsTypeOpenAI}</option>
                    <option value="claude">{t.settingsTypeClaude}</option>
                    <option value="custom">{t.settingsTypeCustom}</option>
                  </select>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.settingsLabelLabel}</div>
                  <input type="text" value={providerForm.label} onInput={(event) => setProviderForm((prev) => ({ ...prev, label: (event.target as HTMLInputElement).value }))} style={{ width: '100%' }} />
                </div>

                {providerForm.provider_type === 'ollama' || providerForm.provider_type === 'custom' ? (
                  <div style={{ marginBottom: 12 }}>
                    <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.settingsBaseUrlLabel}</div>
                    <input type="text" value={providerForm.base_url ?? ''} onInput={(event) => setProviderForm((prev) => ({ ...prev, base_url: (event.target as HTMLInputElement).value }))} style={{ width: '100%' }} />
                  </div>
                ) : null}

                {providerForm.provider_type !== 'ollama' && providerForm.provider_type !== 'shared' ? (
                  <div style={{ marginBottom: 12 }}>
                    <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.settingsApiKeyLabel}</div>
                    <input type="password" value={providerForm.api_key ?? ''} placeholder={providerForm.id !== null ? t.settingsApiKeyUnchangedPh : ''} onInput={(event) => setProviderForm((prev) => ({ ...prev, api_key: (event.target as HTMLInputElement).value }))} style={{ width: '100%' }} />
                  </div>
                ) : null}

                {providerForm.provider_type === 'shared' ? (
                  <div className="soft-text" style={{ fontSize: 15, marginBottom: 12 }}>{t.settingsSharedNote}</div>
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    <div className="section-label" style={{ marginBottom: 6, fontSize: 13 }}>{t.settingsModelLabel}</div>
                    <input type="text" value={providerForm.model} onInput={(event) => setProviderForm((prev) => ({ ...prev, model: (event.target as HTMLInputElement).value }))} style={{ width: '100%' }} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" onClick={() => void saveProvider()}>{t.settingsSaveBtn}</button>
                  <button className="btn-outline" onClick={() => void testConnection()} disabled={testStatus.loading}>{testStatus.loading ? t.settingsTesting : t.settingsTestBtn}</button>
                  {providerForm.id !== null ? <button className="btn-outline" onClick={resetProviderForm}>{t.settingsCancelBtn}</button> : null}
                </div>
                {testStatus.ok === true ? <div className="up-text" style={{ fontSize: 14, marginTop: 10 }}>{t.settingsTestSuccess} {testStatus.message}</div> : null}
                {testStatus.ok === false ? <div className="down-text" style={{ fontSize: 14, marginTop: 10 }}>{t.settingsTestError} {testStatus.message}</div> : null}
              </Card>
            </div>
          )}

          <div className="muted-text" style={{ fontSize: 13, lineHeight: 2, marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            {t.footFramework.replace('{date}', new Date().toLocaleDateString(state.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' }))} {t.foot}
          </div>
          </div>
        </div>
      </main>
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
    targetLbl: 'السعر المستهدف المرجّح بالاحتمالات', deltaVs: 'عن السعر الحالي', bandNote: 'السعر الحالي خارج نطاقات السيناريوهات التلاتة. السوق مختلف مع أوزانك — راجعها بالسحب تحت.', expWT: 'يعني إيه "مرجّح بالاحتمالات"؟', expW: 'بدل ما تراهن على سيناريو واحد، بنحسب متوسط مرجّح للسيناريوهات التلاتة — وكل ما تبقى واثق أكتر في سيناريو معين (يعني رفعت وزنه)، بيأثر أكتر في الناتج. طريقة الحساب: نضرب متوسط نطاق سعر كل سيناريو (أقل سعر + أعلى سعر ÷ 2) في وزنه، نجمع التلاتة، وبعدين نقسم على 100. لو رفعت وزن سيناريو، الهدف هيتحرك ناحية نطاقه.', formulaLbl: 'الحساب المباشر:', expWUse: 'إزاي تستخدمه: السعر ده مش توقّع لسعر الذهب — هو نقطة مرجعية مبنية على رؤيتك انت، وتقارنه بالسعر الحالي فوق عشان تعرف موقفك.', targetBuyHint: 'السعر الحالي أقل من هدفك، يعني الذهب رخيص نسبيًا مقارنة بأوزان السيناريوهات بتاعتك — غالبًا إشارة معقولة إنك تشتري أو تنفّذ الدفعة الجاية من خطة الدخول.', targetHoldHint: 'السعر الحالي مساوي أو أعلى من هدفك، يعني الذهب غالي نسبيًا مقارنة بأوزانك — غالبًا إشارة إنك تستنى فرصة دخول أحسن بدل ما تستعجل.', targetCaveat: 'ده مؤشر بسيط مبني على مدخلاتك انت مش نصيحة مالية — خد بالك من عوامل تانية قبل أي قرار.', alertTargetOnLbl: 'هتتنبّه لو السعر نزل تحت هدفك', alertTargetOffLbl: 'نبّهني لو السعر نزل تحت هدفك', alertDismissBtn: 'إخفاء', alertTargetNoteBelow: 'السعر الحالي أقل من هدفك بـ {pct}%. ده معناه إن الذهب حاليًا أرخص من القيمة اللي أوزان السيناريوهات بتاعتك بتقول عليها — غالبًا فرصة معقولة إنك تشتري أو تنفّذ دفعة من خطة الدخول التدريجي بدل ما تستنى. لو الزرار مفعّل، التنبيه ده هيبان دلوقتي فوق.', alertTargetNoteAbove: 'السعر الحالي أعلى من هدفك بـ {pct}%، يعني الذهب غالي شوية مقارنة برؤيتك انت — مفيش داعي تشتري دلوقتي. فعّل التنبيه عشان نقولك أول ما يرجع ينزل تحت الهدف، بدل ما تفضل تراجع بنفسك كل يوم.', scen: { deesc: { name: 'تغيرات جيوسياسية', sub: 'Geopolitical Changes', thesis: 'تهدئة عالمية في التوترات الجيوسياسية (مش بس إيران) + تحوّل الفيدرالي + عودة تدفقات الصناديق' }, base: { name: 'السيناريو الأساسي', sub: 'Base Case', thesis: 'شراء البنوك المركزية (~720 طن/سنة) في مواجهة الفايدة المرتفعة' }, stag: { name: 'فخ الركود التضخمي', sub: 'Stagflation', thesis: 'رفع فايدة وسط ضعف اقتصادي + ضغط دولاري + بيع اضطراري' } }, expScT: 'إيه هي السيناريوهات والأوزان دي؟', expSc: 'كل بطاقة هي سيناريو: نطاق سعر محتمل للذهب (الباند) وليه وزن (%) بيعبّر عن مدى ثقتك إن السيناريو ده هيحصل — كل ما الوزن أعلى، كل ما ثقتك فيه أكبر. مجموع الأوزان التلاتة لازم يفضل دايمًا 100%، فلو رفعت وزن سيناريو، الاتنين التانيين بينزلوا تلقائيًا. الأوزان دي هي اللي بتحدد السعر المستهدف المرجّح فوق مباشرة — والمحلل الذكي كمان ممكن يقترح أوزان جديدة بناءً على بحث لحظي، وتقدر تطبقها بضغطة واحدة.', watchImpliedLbl: 'الأوزان المقترحة من لوحة المتابعة', watchApplyBtn: 'طبّق أوزان لوحة المتابعة', aiT: 'المحلل الذكي', aiGo: '⚡ حلّل السوق بناءً على إطاري', aiLvl: 'مستوى الشرح', aiLvlBeg: 'مبتدئ', aiLvlExp: 'خبير', aiGoing: 'بيبحث في السوق ويحلل…', aiErr: 'فشل التحليل — ', aiTrendsH: 'اللي حرّك السوق', aiWeightsH: 'الأوزان المقترحة', aiApply: 'طبّق الأوزان دي على السيناريوهات', aiApplied: '✓ اتطبقت', aiTrancheH: 'قرار الدفعة الثانية', aiEgpH: 'قراءة الجنيه', aiWalletH: 'إعادة تقييم المحفظة', aiWatchH: 'قراءة لوحة المتابعة', aiDisc: 'تحليل آلي مبني على بحث لحظي — راجعه بعقلك قبل أي قرار.', expAiT: 'إزاي المحلل ده شغال؟', expAi: 'الزرار بيبعت حالة اللوحة كاملة — الأسعار الحية، أوزانك، السعر المرجّح، حالة الدفعات، ألوان المتابعة — لنموذج Claude ومعاه صلاحية بحث في الإنترنت.', dcaT: 'خطة الدخول التدريجي', startDateLbl: 'تاريخ البداية', budgetLbl: 'إجمالي مبلغ الاستثمار', budgetMonthlyLbl: 'مبلغ الاستثمار الشهري', spacingLbl: 'المسافة بين الدفعات', spacingUnitLbl: 'شهر', cur: 'جنيه', nowMark: '← دلوقتي', dcaModeFixed: 'دفعات محددة', dcaModeRecurring: 'شراء شهري مستمر', dcaSplitLbl: 'توزيع الدفعات', dcaSplitSumLbl: 'الإجمالي:', dcaSplitSumError: 'مجموع النسب لازم يكون 100% (دلوقتي {sum}%)', dcaAddTrancheBtn: 'أضف دفعة', dcaSaveSplitBtn: 'احفظ التوزيع', trancheLbl: 'الدفعة', deploymentLbl: 'دفعة شهرية', expDcaT: 'ليه الشراء على دفعات مش مرة واحدة؟', expDca: 'دي استراتيجية DCA: توزيع الشراء بدل توقيت السوق بدل ما تشتري كل حاجة مرة واحدة. اختار "دفعات محددة" لو عايز تقسّم مبلغ إجمالي على دفعات بنسب مختلفة، أو "شراء شهري مستمر" لو عايز تستثمر مبلغ ثابت كل فترة من غير نهاية محددة.', alertDcaOnLbl: 'هتتنبّه لما دفعة تفتح', alertDcaOffLbl: 'نبّهني لما دفعة تفتح', alertDcaOpenMsg: 'دفعة من خطة الدخول التدريجي فتحت. فكرة الـDCA إنك تشتري على دفعات ثابتة بدل ما تحاول تحزر أحسن توقيت — نفّذ الدفعة دي حتى لو السعر مش شكله مثالي، عشان تحافظ على انضباط الخطة.', alertDcaNoteOpen: 'في دفعة مفتوحة دلوقتي وجاهزة للتنفيذ. فعّل التنبيه عشان تتأكد إنك مش هتفوّت الالتزام بجدول الدخول التدريجي.', alertDcaNoteNext: 'الدفعة الجاية هتفتح في {date}. مفيش داعي تتصرف قبل كده — هدف الـDCA إنك توزّع الشراء بدل ما تحاول تدخل في التوقيت "المثالي".', alertDcaNoteDone: 'كل الدفعات خلصت. راجع لو لسه محتاج تزوّد استثمارك في الذهب، أو ابدأ خطة جديدة لو عايز تكمل الدخول التدريجي.', watchT: 'لوحة المتابعة — اضغط للتبديل · × للحذف', addMonPh: 'متغير جديد (مثلًا: أسعار النفط)…', addMonBtn: 'أضف', delMon: 'احذف المتغير', siglbl: ['داعم', 'مراقبة', 'خطر'] as const, expMonT: 'إيه المتغيرات دي وليه؟', expMon: 'الزر الأخضر = داعم، الأصفر = مراقبة، الأحمر = خطر على الأطروحة.',
    walletT: 'قيمة محفظتي', walletKaratCol: 'العيار / الوحدة', walletAmountCol: 'الكمية اللي معاك', walletTotalLbl: 'الإجمالي', walletOzLbl: 'أونصة (عيار 24)', walletG24Lbl: 'دهب 24 (سبائك)', walletG21Lbl: 'دهب 21 (فكة/جرامات)', walletG18Lbl: 'دهب 18 (مشغولات)', walletPoundsLbl: 'جنيهات ذهب (كل جنيه = 8 جرام 21)', walletIntlLbl: 'القيمة بالسعر العالمي', walletEgyptLbl: 'القيمة بالسوق المصري (حي)', walletDeltaLbl: 'فرق عن السعر العالمي', walletNoEgyptData: 'اضغط "اسحب أسعار مصر" في تبويب السوق المصري الأول', walletEmptyHint: 'دخّل كمية الدهب اللي معاك في أي عيار عشان تشوف قيمة محفظتك.', walletSaveBtn: 'حفظ الكمية', walletSaving: 'بيتحفظ…', walletLockNote: 'بعد الحفظ، الكميات دي هتتقفل ومش هتتعدل غير عن طريق عمليات شراء/بيع، أو لو طلبت تصحيح.', walletFirstSaveNote: 'هنسجّل الكمية دي كعملية شراء بسعر السوق المحلي بتاريخ النهارده، عشان يبقى عندك سعر أساس تتابع منه الربح والخسارة. لو عندك سعر وتاريخ الشراء الحقيقي، تقدر تعدّل أو تحذف العملية دي بعد الحفظ وتسجّل العملية الحقيقية بدالها من قايمة العمليات تحت.', walletModifyBtn: 'طلب تصحيح / تعديل الكمية', walletCorrectingLbl: 'وضع التصحيح مفعّل', walletLockedNote: 'الكميات دي متقفلة عشان تفضل متزامنة مع سجل عمليات الشراء والبيع. لو فيه غلط، اطلب تصحيح.', walletChangeLbl: 'نسبة الربح/الخسارة من آخر تقييم', walletSinceLbl: 'مقارنةً بـ', walletTrendLbl: 'اتجاه قيمة المحفظة', walletTrendEmpty: 'لسه مفيش بيانات كفاية للرسم — ارجع تاني بكرة عشان تشوف الاتجاه.', walletHedgeLbl: 'فعالية التحوّط ضد الجنيه', walletHedgeAheadMsg: 'محفظتك زادت {gold}% بينما الدولار زاد {egp}% مقابل الجنيه — يعني الذهب حماك من تراجع الجنيه وكمان زوّد قيمتك الحقيقية.', walletHedgeBehindMsg: 'محفظتك زادت {gold}% بينما الدولار زاد {egp}% مقابل الجنيه — يعني الذهب مقدرش يواكب معدل تراجع الجنيه في الفترة دي.', walletTxT: 'سجّل عملية شراء أو بيع', walletTxUnitLbl: 'الوحدة', walletTxBuy: 'شراء', walletTxSell: 'بيع', walletTxAmountLbl: 'الكمية', walletTxPriceLbl: 'الإجمالي المدفوع/المستلم', walletTxPerUnitNote: '≈ للوحدة الواحدة:', walletTxPerUnitSuffix: '/ وحدة', walletTxSubmit: 'سجّل العملية', walletTxSubmitting: 'بيتسجل…', walletTxAmountError: 'أدخل كمية أكبر من صفر', walletTxEditingT: 'تعديل العملية', walletTxUpdate: 'حفظ التعديل', walletTxDateLbl: 'تاريخ العملية', walletTxLookupLbl: 'السعر المرجعي الحالي:', walletTxUseLookup: 'استخدم هذا السعر', walletTxDeleteConfirm: 'متأكد إنك عايز تحذف العملية دي؟ هيتم تعديل رصيد المحفظة تبعًا لذلك.', walletExportBtn: 'تحميل سجل العمليات (CSV)', walletCostBasisLbl: 'الربح والخسارة مقارنة بسعر الشراء', walletAvgCostLbl: 'متوسط سعر الشراء', walletUnrealizedLbl: 'ربح/خسارة غير محقق', walletRealizedLbl: 'إجمالي الربح المحقق من البيع', walletCostBasisNote: 'ده مقارنة بالسعر اللي فعلاً دفعته وقت الشراء (من سجل العمليات)، مش بآخر تقييم — عشان تعرف هل أنت رابح أو خسران فعليًا من أول ما اشتريت.', walletUntrackedNote: '{qty} من غير سعر شراء مسجّل', walletUntrackedGeneralNote: 'الكميات اللي اتضافت مباشرة (من غير عملية شراء مسجّلة) مفيهاش سعر شراء معروف، فمينفعش نحسبلها ربح أو خسارة. سجّل عملية شراء بتاريخ رجعي لو عايز تتبعها.', expWalletT: 'إزاي بتتحسب القيمة دي؟', expWallet: 'دخّل اللي معاك بكل عيار (بما فيها الأونصة)، وهنحسبلك قيمتين بالجنيه المصري: الأولى بالسعر العالمي (نفس السعر المحسوب في تبويب الحاسبة، بناءً على سعر الأونصة العالمي + سعر الدولار + الهامش اللي حددته)، والتانية بسعر السوق المصري الحي فعليًا (سعر الشراء اللي التاجر هيدفعهولك لو بعت النهارده، من نفس بيانات تبويب السوق المصري). الفرق بين الاتنين بيوريك هل السوق المحلي بيدفع زيادة أو ناقص عن القيمة العالمية النظرية.',
    aiUsingProvider: 'المزوّد المستخدم', aiNoProvider: 'مفيش مزوّد مُفعّل — روح الإعدادات', aiQuotaLabel: 'التحليلات المجانية المتبقية اليوم', settingsHeading: 'إعدادات نموذج الذكاء الاصطناعي', settingsAddHeading: 'إضافة / تعديل مزوّد', settingsEmpty: 'لسه مفيش مزوّدين متضافين.', settingsTypeLabel: 'النوع', settingsLabelLabel: 'الاسم', settingsBaseUrlLabel: 'رابط الخادم', settingsApiKeyLabel: 'مفتاح API', settingsApiKeyUnchangedPh: 'اتركه فاضي عشان يفضل زي ما هو', settingsModelLabel: 'الموديل', settingsSaveBtn: 'حفظ', settingsCancelBtn: 'إلغاء', settingsActivateBtn: 'تفعيل', settingsActiveBadge: 'مُفعّل', settingsEditBtn: 'تعديل', settingsDeleteBtn: 'حذف', settingsTypeOllama: 'Ollama (محلي)', settingsTypeShared: 'مشترك (Claude Haiku، تحليلين/يوم مجانًا)', settingsSharedNote: 'خدمة مُدارة من الخادم — الموديل والاتصال مُعدّين مسبقًا، مفيش إعدادات مطلوبة.', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'مخصص', settingsTestBtn: 'اختبار الاتصال', settingsTesting: 'بيتم الاختبار…', settingsTestSuccess: '✓ نجح الاتصال —', settingsTestError: '✗ فشل الاتصال —', settingsValidationError: 'الاسم والموديل مطلوبين',
    foot: 'الأسعار من مصادر مجانية بدون مفاتيح. أداة تحليل شخصية — مش نصيحة استثمارية.', footFramework: 'الإطار: {date}.' },
  en: {
    dir: 'ltr', langBtn: 'عربي', eyebrow: 'PRIVATE · LIVE', title: 'Gold Hedge Cockpit', homeTab: 'Operations Room', marketTab: 'Live Market', calcTab: 'Karat Purchase Calculator', targetTab: 'Probability-Weighted Target', scenTab: 'Scenario Weights', egyptTab: 'Egypt Market', aiTab: 'AI Analyst', dcaTab: 'DCA Plan', watchTab: 'Watchlist', walletTab: 'My Wallet', settingsTab: 'Settings',
    egyptHeading: 'LOCAL EGYPTIAN MARKET PRICES', egyptSell: 'Sell', egyptBuy: 'Buy', egyptLoading: 'Fetching prices from iSagha…', egyptErr: 'Could not reach iSagha — ', egyptSourceNote: 'Source: iSagha.com (last updated)', egyptStaleNote: 'Live pull failed — showing last known prices from',
    inSpot: 'XAU/USD', inEgp: 'USD/EGP', inPrem: 'PREMIUM %', ounce: 'Ounce', ounceU: 'direct conversion, no premium',
    g24: '24k gram', g21: '21k gram', g18: '18k gram', gp: 'Gold pound', inclU: 'EGP · incl. premium', gpU: 'EGP · 8g of 21k',
    pull: '⟳ PULL LIVE MARKET', stampInit: 'Auto-pulls on open', expGramT: 'How is the gram price computed?', expGram: 'Gold is priced globally in USD per troy ounce. Ounce ÷ 31.1 × USD/EGP = 24k gram in EGP. 21k = 24k × 0.875; a gold pound = 8g of 21k.',
    calcT: 'KARAT PURCHASE CALCULATOR', calcAmt: 'Amount', calcCur: 'EGP buys you:', thK: 'Karat', thP: 'Per gram', thQ: 'Quantity', k24: '24k (bullion)', k22: '22k', k21: '21k', k18: '18k (jewelry)', gpRow: 'Gold pounds', change: 'change', expKaratT: "What's the difference between karats?", expKarat: 'Karat = purity. 24 = 99.9% (bullion), 22 = 91.7%, 21 = 87.5% (Egypt\'s standard), 18 = 75% (jewelry).', calcSpreadNote: 'This is raw metal value at your set price + premium — dealers add their own buy/sell spread, and jewelry (18k) usually adds a manufacturing charge that can be a large share of the price. The price you actually pay or receive will differ from this figure.',
    targetLbl: 'PROBABILITY-WEIGHTED TARGET', deltaVs: 'vs. spot', bandNote: 'Spot sits outside all three bands. The market disagrees with your weights — drag below.', expWT: 'What does "probability-weighted" mean?', expW: 'Instead of betting on one scenario, we take a weighted average of the three scenario targets — the more likely you think a scenario is (the higher its weight), the more it counts. How it\'s calculated: multiply each scenario\'s price-band midpoint (low + high ÷ 2) by its weight, add the three together, then divide by 100. Raise a scenario\'s weight and the target shifts toward its band.', formulaLbl: 'Live calculation:', expWUse: 'How to use it: this isn\'t a price prediction — it\'s a reference point built from your own view. Compare it against the live spot price above to see where you stand.', targetBuyHint: 'Spot is trading below your target, which means gold looks relatively cheap against your own scenario weights — often a reasonable signal to buy or deploy your next DCA tranche.', targetHoldHint: 'Spot is trading at or above your target, which means gold looks relatively expensive against your own scenario weights — often a reasonable signal to hold off and wait for a better entry.', targetCaveat: 'This is a simple heuristic based on your own inputs, not financial advice — weigh other factors before deciding.', alertTargetOnLbl: "You'll be notified when spot drops below your target", alertTargetOffLbl: 'Notify me when spot drops below my target', alertDismissBtn: 'Dismiss', alertTargetNoteBelow: 'Spot is {pct}% below your target, which means gold is currently trading cheaper than what your own scenario weights say it should be worth — often a reasonable moment to buy, or to run your next DCA tranche instead of waiting. With this on, that would show as a notice above right now.', alertTargetNoteAbove: "Spot is {pct}% above your target, so gold looks a bit expensive against your own view — no strong reason to buy at this price. Turn this on and we'll flag it the moment it drops back below your target, instead of you having to check manually every day.", scen: { deesc: { name: 'Geopolitical Changes', sub: 'تغيرات جيوسياسية', thesis: 'Global geopolitical tensions ease broadly (not just Iran), Fed pivots, ETF inflows return' }, base: { name: 'Base Case', sub: 'الأساسي', thesis: 'CB buying ~720t/yr vs. elevated rates — grind higher' }, stag: { name: 'Stagflation Trap', sub: 'فخ الركود', thesis: 'Fed hikes into weakness, dollar squeeze, forced selling' } }, expScT: 'What are these scenarios and weights?', expSc: 'Each panel is a scenario: a possible price range for gold (the band) with a weight (%) showing how confident you are it plays out — the higher the weight, the more confident. The three weights always add up to 100%, so raising one scenario\'s weight automatically lowers the other two. These weights directly drive the probability-weighted target above — the AI Analyst can also suggest new weights based on live research, which you can apply with one tap.', watchImpliedLbl: 'Watchlist-implied weights', watchApplyBtn: 'Apply watchlist weights', aiT: 'AI ANALYST', aiGo: '⚡ Analyze the market against my framework', aiLvl: 'Explanation level', aiLvlBeg: 'Beginner', aiLvlExp: 'Expert', aiGoing: 'Searching & analyzing…', aiErr: 'Analysis failed — ', aiTrendsH: 'WHAT MOVED THE MARKET', aiWeightsH: 'SUGGESTED WEIGHTS', aiApply: 'Apply these weights to the scenarios', aiApplied: '✓ Applied', aiTrancheH: 'TRANCHE 2 CALL', aiEgpH: 'EGP READ', aiWalletH: 'WALLET RE-EVALUATION', aiWatchH: 'WATCHLIST READ', aiDisc: 'Machine analysis on live search — apply your own judgment before acting.', expAiT: 'How does this analyst work?', expAi: 'The button sends your full cockpit state — live prices, your weights, the weighted target, tranche status, watchlist colors — to Claude with web-search access.', dcaT: 'DCA PLAN', startDateLbl: 'Start date', budgetLbl: 'Total investment', budgetMonthlyLbl: 'Monthly investment', spacingLbl: 'Spacing between tranches', spacingUnitLbl: 'month(s)', cur: 'EGP', nowMark: '← now', dcaModeFixed: 'Fixed tranches', dcaModeRecurring: 'Recurring monthly', dcaSplitLbl: 'Tranche split', dcaSplitSumLbl: 'Total:', dcaSplitSumError: 'Percentages must sum to 100% (currently {sum}%)', dcaAddTrancheBtn: 'Add tranche', dcaSaveSplitBtn: 'Save split', trancheLbl: 'Tranche', deploymentLbl: 'Monthly deployment', expDcaT: 'Why staged entry instead of one buy?', expDca: 'This is DCA: staged entry instead of timing the market or buying it all at once. Choose "Fixed tranches" to split a total amount across a set number of tranches at your own ratio, or "Recurring monthly" to invest a fixed amount on a repeating schedule with no fixed end date.', alertDcaOnLbl: "You'll be notified when a tranche window opens", alertDcaOffLbl: 'Notify me when a tranche window opens', alertDcaOpenMsg: "A DCA tranche window is open. The point of dollar-cost averaging is to buy on a fixed schedule instead of trying to guess the best moment — go ahead and execute this tranche even if the price doesn't feel perfect, to keep the plan disciplined.", alertDcaNoteOpen: "A tranche window is open and ready to execute. Turn this on so you don't miss staying on schedule with your staged entry plan.", alertDcaNoteNext: 'Your next tranche opens {date}. No action needed before then — DCA works by spreading purchases out rather than trying to time the "perfect" entry.', alertDcaNoteDone: 'All tranches are complete. Review whether you want to add more to your gold position, or start a new plan to keep dollar-cost averaging.', watchT: 'WATCHLIST — TAP TO CYCLE · × TO DELETE', addMonPh: 'New variable (e.g. oil prices)…', addMonBtn: 'Add', delMon: 'Delete variable', siglbl: ['OK', 'Watch', 'Risk'] as const, expMonT: 'What are these variables?', expMon: 'Green = supportive, amber = watch, red = thesis risk.',
    walletT: 'My Wallet Value', walletKaratCol: 'Karat / unit', walletAmountCol: 'Amount you own', walletTotalLbl: 'Total', walletOzLbl: 'Ounces (24k)', walletG24Lbl: '24k gold (bullion)', walletG21Lbl: '21k gold (loose grams)', walletG18Lbl: '18k gold (jewelry)', walletPoundsLbl: 'Gold pounds (each = 8g of 21k)', walletIntlLbl: 'Value at international price', walletEgyptLbl: 'Value at Egyptian market (live)', walletDeltaLbl: 'vs. international value', walletNoEgyptData: 'Hit "Pull Egypt prices" on the Egypt Market tab first', walletEmptyHint: 'Enter how much gold you own in any karat to see your wallet\'s value.', walletSaveBtn: 'Save amounts', walletSaving: 'Saving…', walletLockNote: "Once saved, these amounts lock and can only change through buy/sell transactions, or by requesting a correction.", walletFirstSaveNote: "We'll record this as a buy at today's local market price, so you have a base cost to track profit/loss from. If you know your real purchase price and date, you can edit or delete that transaction after saving and log the real one instead, from the transaction list below.", walletModifyBtn: 'Request a correction / edit amounts', walletCorrectingLbl: 'Correction mode on', walletLockedNote: 'These amounts are locked so they stay in sync with your buy/sell transaction history. If something is wrong, request a correction.', walletChangeLbl: 'Profit/loss since last evaluation', walletSinceLbl: 'vs.', walletTrendLbl: 'Wallet value trend', walletTrendEmpty: 'Not enough data yet to plot a trend — check back tomorrow to see it build up.', walletHedgeLbl: 'Hedge effectiveness vs. the pound', walletHedgeAheadMsg: 'Your wallet is up {gold}% while the dollar is up {egp}% against the pound — gold protected you from the pound\'s slide and added real value on top.', walletHedgeBehindMsg: "Your wallet is up {gold}% while the dollar is up {egp}% against the pound — gold hasn't kept pace with the pound's decline over this period.", walletTxT: 'Record a buy or sell', walletTxUnitLbl: 'Unit', walletTxBuy: 'Buy', walletTxSell: 'Sell', walletTxAmountLbl: 'Amount', walletTxPriceLbl: 'Total paid/received', walletTxPerUnitNote: '≈ per unit:', walletTxPerUnitSuffix: '/ unit', walletTxSubmit: 'Record transaction', walletTxSubmitting: 'Recording…', walletTxAmountError: 'Enter an amount greater than zero', walletTxEditingT: 'Edit transaction', walletTxUpdate: 'Save changes', walletTxDateLbl: 'Transaction date', walletTxLookupLbl: 'Current reference price:', walletTxUseLookup: 'Use this price', walletTxDeleteConfirm: 'Delete this transaction? Your wallet balance will be adjusted accordingly.', walletExportBtn: 'Download transaction history (CSV)', walletCostBasisLbl: 'Profit/loss vs. what you paid', walletAvgCostLbl: 'Average buy price', walletUnrealizedLbl: 'Unrealized P&L', walletRealizedLbl: 'Total realized profit from sales', walletCostBasisNote: "This compares against what you actually paid at purchase (from your transaction history), not the last evaluation snapshot — so you know if you're really ahead or behind since you bought.", walletUntrackedNote: '{qty} has no purchase price on record', walletUntrackedGeneralNote: "Amounts added directly (without a recorded buy transaction) have no known purchase price, so profit/loss can't be calculated for them. Log a backdated buy transaction if you want to track them.", expWalletT: 'How is this value calculated?', expWallet: 'Enter what you own per karat (including ounces), and we compute two values in Egyptian Pounds: one at the international price (the same rate as the Calculator tab — global ounce price + USD/EGP rate + your set premium), and one at the actual live Egyptian market price (the dealer buy-back price for today, from the same data as the Egypt Market tab). The difference between the two shows whether the local market is paying more or less than the theoretical international value.',
    aiUsingProvider: 'Using provider', aiNoProvider: 'No active provider — go to Settings', aiQuotaLabel: 'Free analyses left today', settingsHeading: 'AI Model Settings', settingsAddHeading: 'Add / Edit Provider', settingsEmpty: 'No providers configured yet.', settingsTypeLabel: 'Type', settingsLabelLabel: 'Label', settingsBaseUrlLabel: 'Base URL', settingsApiKeyLabel: 'API key', settingsApiKeyUnchangedPh: 'Leave blank to keep unchanged', settingsModelLabel: 'Model', settingsSaveBtn: 'Save', settingsCancelBtn: 'Cancel', settingsActivateBtn: 'Set active', settingsActiveBadge: 'Active', settingsEditBtn: 'Edit', settingsDeleteBtn: 'Delete', settingsTypeOllama: 'Ollama (local)', settingsTypeShared: 'Shared (Claude Haiku, 2 free/day)', settingsSharedNote: 'Server-managed tier — model and connection are pre-configured, no setup needed.', settingsTypeOpenAI: 'OpenAI', settingsTypeClaude: 'Claude', settingsTypeCustom: 'Custom', settingsTestBtn: 'Test connection', settingsTesting: 'Testing…', settingsTestSuccess: '✓ Connection worked —', settingsTestError: '✗ Connection failed —', settingsValidationError: 'Label and Model are required',
    foot: 'Live prices from free keyless feeds. Personal analysis tool — not financial advice.', footFramework: 'Framework: {date}.' },
};

export default App;
