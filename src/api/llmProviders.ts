export type ProviderType = 'ollama' | 'openai' | 'claude' | 'custom';

export type LlmProvider = {
  id: number;
  provider_type: ProviderType;
  label: string;
  base_url: string | null;
  api_key: string | null;
  model: string;
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function activateProvider(id: number): Promise<LlmProvider> {
  const response = await fetch(`/api/llm-providers/${id}/activate`, { method: 'POST' });
  return parseJsonOrThrow(response);
}

export async function analyzeViaBackend(prompt: string): Promise<{ text: string; usedWebSearch: boolean }> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return parseJsonOrThrow(response);
}
