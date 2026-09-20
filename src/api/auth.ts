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

function shouldSignOutOn401(input: RequestInfo | URL, pageOrigin: string): boolean {
  try {
    // Request.url and URL.href are always absolute, so resolve every input form
    // against the page origin instead of matching on the raw string.
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const resolved = new URL(raw, pageOrigin);
    // A 401 from another host must never log the user out of this app.
    return (
      resolved.origin === pageOrigin &&
      resolved.pathname.startsWith('/api/') &&
      resolved.pathname !== '/api/auth/login'
    );
  } catch {
    return false;
  }
}

export function installUnauthorizedHandler(onUnauthorized: () => void): () => void {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status === 401) {
      const pageOrigin = window.location?.origin ?? 'http://localhost';
      if (shouldSignOutOn401(input, pageOrigin)) onUnauthorized();
    }
    return response;
  };
  return () => {
    window.fetch = original;
  };
}
