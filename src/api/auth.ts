export type CurrentUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  daily_ai_limit: number;
  ai_used_today: number;
};

export class AuthError extends Error {
  code?: 'pending' | 'disabled';
  constructor(message: string, code?: 'pending' | 'disabled') {
    super(message);
    this.code = code;
  }
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export async function fetchMe(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function post(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new AuthError(data.error || `HTTP ${response.status}`, data.code);
  return data;
}

export const login = (email: string, password: string): Promise<CurrentUser> =>
  post('/api/auth/login', { email, password });

export async function register(email: string, password: string, displayName: string): Promise<void> {
  await post('/api/auth/register', { email, password, display_name: displayName });
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout');
}

export function installUnauthorizedHandler(onUnauthorized: () => void): () => void {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (response.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/login')) {
      onUnauthorized();
    }
    return response;
  };
  return () => {
    window.fetch = original;
  };
}
