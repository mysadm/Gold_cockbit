import { DEFAULT_CATALOG } from 'ai-settings-ui';
import type {
  AIProviderAdapter,
  ConnectionDraft,
  ProviderCatalogEntry,
  ProviderConnection,
  TestResult,
} from 'ai-settings-ui';
import {
  activateProvider,
  createProvider,
  deleteProvider,
  listModelsById,
  listModelsForDraft,
  listProviders,
  testProvider,
  testProviderById,
  updateProvider,
  type LlmProvider,
  type ProviderType,
} from '../api/llmProviders';

// Bridges Gold Cockpit's llm_providers REST API to the ai-settings-ui
// component library's AIProviderAdapter contract. The library's catalog is
// wider than what the backend natively knows how to dial (only
// ollama/openai/claude/openrouter/shared have a dedicated provider_type +
// default base URL) — the rest (gemini/deepseek/mistral/groq, and any
// provider the user adds via "+ Add provider") are dialed through the
// generic OpenAI-compatible 'custom' provider_type with a preset base URL,
// and re-identified on load by matching that base URL back to a catalog id.

const CUSTOM_PROVIDERS_KEY = 'gc_custom_ai_catalog';

const BASE_URL_LABEL = { id: 'base_url', type: 'string' as const, label: 'Base URL' };

const PRESET_BASE_URLS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1',
};

// Last-known-good fallback, used only when the live models call (below) fails
// or returns nothing — not the primary source of truth. gemini-2.0-flash and
// gemini-1.5-pro were retired by Google — confirmed via the API's own
// deprecation error, which named gemini-3.6-flash as the replacement.
const FALLBACK_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini'],
  anthropic: ['claude-sonnet-4-6'],
  gemini: ['gemini-3.6-flash'],
  openrouter: ['openai/gpt-4o-mini'],
  deepseek: ['deepseek-chat'],
  mistral: ['mistral-large-latest'],
  groq: ['llama-3.3-70b-versatile'],
  ollama: ['llama3.1'],
  shared: ['shared'],
};

type CustomProviderMeta = { id: string; displayName: string; models: string[] };

function loadCustomProviders(): CustomProviderMeta[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROVIDERS_KEY);
    return raw ? (JSON.parse(raw) as CustomProviderMeta[]) : [];
  } catch {
    return [];
  }
}

function saveCustomProviders(entries: CustomProviderMeta[]) {
  try {
    localStorage.setItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(entries));
  } catch {
    // best-effort only — a lost custom-provider label list just means the
    // row falls back to the generic "Custom" catalog entry on next load
  }
}

function catalogToProviderType(catalogId: string): ProviderType {
  if (catalogId === 'anthropic') return 'claude';
  if (catalogId === 'openai' || catalogId === 'openrouter' || catalogId === 'ollama' || catalogId === 'shared') {
    return catalogId;
  }
  return 'custom';
}

function providerIdFromRow(row: LlmProvider, customProviders: CustomProviderMeta[]): string {
  if (row.provider_type === 'claude') return 'anthropic';
  if (row.provider_type !== 'custom') return row.provider_type;
  const url = row.base_url || '';
  for (const [id, presetUrl] of Object.entries(PRESET_BASE_URLS)) {
    if (id !== 'ollama' && url === presetUrl) return id;
  }
  const known = customProviders.find((p) => url === row.base_url && FALLBACK_MODELS[p.id]?.includes(row.model));
  if (known) return known.id;
  const byUrl = customProviders.find((p) => p.id === url);
  return byUrl?.id ?? 'custom';
}

function connectionFromRow(row: LlmProvider, customProviders: CustomProviderMeta[]): ProviderConnection {
  return {
    id: String(row.id),
    providerId: providerIdFromRow(row, customProviders),
    label: row.label,
    model: row.model,
    temperature: typeof row.settings?.temperature === 'number' ? row.settings.temperature : 0.3,
    maxTokens: row.settings?.maxTokens,
    language: row.settings?.language,
    extra: row.base_url ? { base_url: row.base_url } : {},
    apiKeyRef: row.provider_type === 'ollama' || row.provider_type === 'shared' ? null : '••••••••',
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

function draftToInput(draft: ConnectionDraft) {
  const provider_type = catalogToProviderType(draft.providerId);
  const extraBaseUrl = typeof draft.extra?.base_url === 'string' ? draft.extra.base_url.trim() : '';
  const presetBaseUrl = PRESET_BASE_URLS[draft.providerId];
  const base_url =
    provider_type === 'custom' || provider_type === 'ollama'
      ? extraBaseUrl || presetBaseUrl || null
      : null;
  return {
    provider_type,
    label: draft.label,
    base_url,
    api_key: draft.apiKey || undefined,
    model: provider_type === 'shared' ? 'shared' : draft.model,
    settings: {
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      language: draft.language,
      extra: draft.extra,
    },
  };
}

export function createGoldCockpitAiAdapter(onChange?: () => void): AIProviderAdapter {
  const notify = () => onChange?.();

  return {
    async listCatalog(): Promise<ProviderCatalogEntry[]> {
      const withExtraFields = DEFAULT_CATALOG.map((entry) =>
        entry.id in PRESET_BASE_URLS || entry.kind === 'local'
          ? { ...entry, extraFields: [BASE_URL_LABEL] }
          : entry
      );
      const shared: ProviderCatalogEntry = { id: 'shared', displayName: 'Shared (Claude Haiku, free daily quota)', kind: 'cloud' };
      const custom = loadCustomProviders().map((p) => ({ id: p.id, displayName: p.displayName, kind: 'cloud' as const, extraFields: [BASE_URL_LABEL] }));
      return [...withExtraFields, shared, ...custom];
    },

    async addCustomProvider(def) {
      const id = `custom-${def.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || Date.now()}`;
      const entry: CustomProviderMeta = { id, displayName: def.displayName, models: def.models ?? [] };
      const current = loadCustomProviders();
      saveCustomProviders([...current, entry]);
      if (entry.models.length > 0) FALLBACK_MODELS[id] = entry.models;
      return { id, displayName: def.displayName, kind: 'cloud', extraFields: [BASE_URL_LABEL] };
    },

    async listConnections(): Promise<ProviderConnection[]> {
      const rows = await listProviders();
      const customProviders = loadCustomProviders();
      return rows.map((row) => connectionFromRow(row, customProviders));
    },

    async saveConnection(draft: ConnectionDraft): Promise<ProviderConnection> {
      const input = draftToInput(draft);
      const row = draft.id ? await updateProvider(Number(draft.id), input) : await createProvider(input);
      notify();
      return connectionFromRow(row, loadCustomProviders());
    },

    async deleteConnection(id: string): Promise<void> {
      await deleteProvider(Number(id));
      notify();
    },

    async setActiveConnection(id: string): Promise<void> {
      await activateProvider(Number(id));
      notify();
    },

    async testConnection(target): Promise<TestResult> {
      try {
        if ('id' in target) {
          const result = await testProviderById(Number(target.id));
          return { ok: true, message: result.text.slice(0, 200) };
        }
        const input = draftToInput(target.draft);
        const result = await testProvider(input);
        return { ok: true, message: result.text.slice(0, 200) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Connection failed.' };
      }
    },

    async listModels(providerId: string, context: { connectionId?: string; apiKey?: string }): Promise<string[]> {
      const fallback = FALLBACK_MODELS[providerId] ?? [];
      try {
        const models = context.connectionId
          ? await listModelsById(Number(context.connectionId))
          : await listModelsForDraft({
              provider_type: catalogToProviderType(providerId),
              base_url: PRESET_BASE_URLS[providerId] ?? null,
              api_key: context.apiKey || null,
            });
        return models.length > 0 ? models : fallback;
      } catch {
        return fallback;
      }
    },
  };
}
