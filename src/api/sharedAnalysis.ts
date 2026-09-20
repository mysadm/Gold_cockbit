export type AnalysisSchedule = {
  enabled: boolean;
  times: string[];
  tz: string;
  language: 'ar' | 'en';
};

export type StandardRun = {
  id: number;
  slot_key: string;
  created_at: string;
  text: string;
  snapshot: unknown;
  validation: { ok: boolean; errors: string[] };
  evidence_sources: { id: string; title: string; link: string; date: string }[];
  used_web_search: boolean;
  search_status: string | null;
  provider_label: string;
};

export type LatestResponse = {
  schedule: AnalysisSchedule;
  slot: { key: string; next_at: string };
  latest: StandardRun | null;
  running: boolean;
};

export type AdminNotification = {
  id: number;
  kind: string;
  message: string;
  created_at: string;
  updated_at: string;
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

export const fetchLatest = () => call<LatestResponse>('/api/analysis/latest', 'GET');
export const fetchSchedule = () => call<AnalysisSchedule>('/api/analysis/schedule', 'GET');
export const saveSchedule = (schedule: AnalysisSchedule) => call<AnalysisSchedule>('/api/analysis/schedule', 'PUT', schedule);
export const runNow = () => call<{ status: 'done'; id: number }>('/api/analysis/run-now', 'POST', {});
export const fetchNotifications = () => call<AdminNotification[]>('/api/admin/notifications', 'GET');
export const dismissNotification = (id: number) => call<{ ok: true }>(`/api/admin/notifications/${id}/dismiss`, 'POST');
