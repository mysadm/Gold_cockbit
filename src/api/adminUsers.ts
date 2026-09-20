export type AdminUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'disabled';
  daily_ai_limit: number;
  created_at: string;
  ai_used_today: number;
};

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

export const listUsers = () => call<AdminUser[]>('/api/admin/users', 'GET');
export const approveUser = (id: string) => call<AdminUser>(`/api/admin/users/${id}/approve`, 'POST');
export const disableUser = (id: string) => call<AdminUser>(`/api/admin/users/${id}/disable`, 'POST');
export const enableUser = (id: string) => call<AdminUser>(`/api/admin/users/${id}/enable`, 'POST');
export const setDailyLimit = (id: string, limit: number) =>
  call<AdminUser>(`/api/admin/users/${id}`, 'PATCH', { daily_ai_limit: limit });
export const resetPassword = (id: string, password: string) =>
  call<{ ok: true }>(`/api/admin/users/${id}/reset-password`, 'POST', { password });
