import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchMe, login, register, logout, AuthError, installUnauthorizedHandler } from '../../src/api/auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth api', () => {
  it('fetchMe returns the user, or null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { id: 'u1', email: 'a@x.com', role: 'user' })));
    expect((await fetchMe())?.id).toBe('u1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: 'Not signed in' })));
    expect(await fetchMe()).toBeNull();
  });

  it('login posts the credentials and returns the user', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(200, { id: 'u1', role: 'user' }));
    vi.stubGlobal('fetch', f);
    expect((await login('a@x.com', 'pw123456')).id).toBe('u1');
    expect(f).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('login surfaces the pending/disabled code on AuthError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(403, { error: 'waiting', code: 'pending' })));
    await expect(login('a@x.com', 'pw123456')).rejects.toMatchObject({ code: 'pending', message: 'waiting' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: 'Invalid email or password' })));
    const err = await login('a@x.com', 'bad').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBeUndefined();
  });

  it('register and logout call their endpoints', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(201, { status: 'pending' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', f);
    await register('a@x.com', 'pw123456', 'A');
    await logout();
    expect(f.mock.calls[0][0]).toBe('/api/auth/register');
    expect(f.mock.calls[1][0]).toBe('/api/auth/logout');
  });
});

describe('installUnauthorizedHandler', () => {
  it('calls the handler on a 401 from /api/*, but not for /api/auth/login', async () => {
    const original = vi.fn()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, {}));
    const fakeWindow = { fetch: original } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', fakeWindow);
    const onUnauthorized = vi.fn();
    const uninstall = installUnauthorizedHandler(onUnauthorized);

    await fakeWindow.fetch('/api/wallet');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await fakeWindow.fetch('/api/auth/login', { method: 'POST' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await fakeWindow.fetch('/api/wallet');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    uninstall();
    expect(fakeWindow.fetch).toBe(original);
  });
});
