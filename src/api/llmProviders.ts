import type { AnalysisSnapshot } from '../lib/analysisSnapshot';

export type ProviderType = 'ollama' | 'openai' | 'claude' | 'custom' | 'shared' | 'openrouter';

export type LlmProviderSettings = {
  temperature?: number;
  maxTokens?: number;
  language?: string;
  webSearch?: boolean;
  extra?: Record<string, unknown>;
};

export type LlmProvider = {
  id: number;
  provider_type: ProviderType;
  label: string;
  base_url: string | null;
  model: string;
  settings: LlmProviderSettings;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LlmProviderInput = {
  provider_type: ProviderType;
  label: string;
  base_url?: string | null;
  api_key?: string | null;
  model: string;
  settings?: LlmProviderSettings;
};

async function parseJsonOrThrow(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function listProviders(): Promise<LlmProvider[]> {
  const response = await fetch('/api/llm-providers');
  return parseJsonOrThrow(response);
}

export async function createProvider(input: LlmProviderInput): Promise<LlmProvider> {
  const response = await fetch('/api/llm-providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateProvider(id: number, input: LlmProviderInput): Promise<LlmProvider> {
  const response = await fetch(`/api/llm-providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function deleteProvider(id: number): Promise<void> {
  const response = await fetch(`/api/llm-providers/${id}`, { method: 'DELETE' });
  await parseJsonOrThrow(response);
}

export async function activateProvider(id: number): Promise<LlmProvider> {
  const response = await fetch(`/api/llm-providers/${id}/activate`, { method: 'POST' });
  return parseJsonOrThrow(response);
}

export type TestProviderInput = {
  provider_type: ProviderType;
  base_url?: string | null;
  api_key?: string | null;
  model: string;
  settings?: LlmProviderSettings;
};

export async function testProvider(input: TestProviderInput): Promise<{ text: string }> {
  const response = await fetch('/api/llm-providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function testProviderById(id: number): Promise<{ text: string }> {
  const response = await fetch(`/api/llm-providers/${id}/test`, { method: 'POST' });
  return parseJsonOrThrow(response);
}

export type ListModelsInput = {
  provider_type: ProviderType;
  base_url?: string | null;
  api_key?: string | null;
};

export async function listModelsForDraft(input: ListModelsInput): Promise<string[]> {
  const response = await fetch('/api/llm-providers/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseJsonOrThrow(response);
  return data.models;
}

export async function listModelsById(id: number): Promise<string[]> {
  const response = await fetch(`/api/llm-providers/${id}/models`);
  const data = await parseJsonOrThrow(response);
  return data.models;
}

export async function analyzeViaBackend(
  prompt: string,
  snapshot: AnalysisSnapshot,
  signal?: AbortSignal
): Promise<{ text: string; usedWebSearch: boolean; searchStatus: SearchStatus; evidenceSources: EvidenceSource[]; validation: { ok: boolean; errors: string[] } }> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, snapshot }),
    signal,
  });
  return parseJsonOrThrow(response);
}

export type AnalyzeQuota = { shared: false } | { shared: true; used: number; limit: number };
export type SearchStatus = 'ok' | 'partial' | 'disabled' | 'no_api_key' | 'no_results' | 'failed';
export type EvidenceSource = { id: string; title: string; link: string; date: string };

export async function fetchAnalyzeQuota(): Promise<AnalyzeQuota> {
  const response = await fetch('/api/analyze/quota');
  return parseJsonOrThrow(response);
}
