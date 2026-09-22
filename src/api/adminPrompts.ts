export type PromptKind = 'standard' | 'personalized';

export type PromptDraft = { text: string; format: string };

export type PromptEntry = {
  text: string;
  format: string;
  default: string;
  defaultFormat: string;
  customized: boolean;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type PromptSettings = Record<PromptKind, PromptEntry> & {
  requiredKeys: string[];
  lockedRules: string;
  maxLength: number;
};

export type PromptTestResult = {
  passed: boolean;
  reason: string | null;
  status: string | null;
  action: string | null;
  confidence: string | null;
  headline: string | null;
  errors: string[];
  sample: boolean;
  hint: string | null;
  answerPreview: string | null;
  totalMs: number | null;
};

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export const fetchPromptSettings = () => call<PromptSettings>('/api/admin/prompts', 'GET');
export const testPrompt = (kind: PromptKind, draft: PromptDraft) => call<PromptTestResult>(`/api/admin/prompts/${kind}/test`, 'POST', draft);
export const savePrompt = (kind: PromptKind, draft: PromptDraft, password: string) => call<PromptSettings>(`/api/admin/prompts/${kind}`, 'PUT', { ...draft, password });
export const resetPrompt = (kind: PromptKind, password: string) => call<PromptSettings>(`/api/admin/prompts/${kind}/reset`, 'POST', { password });
