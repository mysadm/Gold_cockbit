import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import App from '../App';
import { fetchMe, logout, installUnauthorizedHandler, type CurrentUser } from '../api/auth';
import { migrateLegacyStorage } from '../lib/userStorage';
import { LoginScreen, loadLoginPrefs } from './LoginScreen';

type Phase = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; user: CurrentUser };

function enter(user: CurrentUser): Phase {
  try { migrateLegacyStorage(window.localStorage, user); } catch { /* storage may be blocked */ }
  return { kind: 'authed', user };
}

export function AuthGate() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  // Apply the stored login theme before first paint so light-mode users don't flash dark while loading.
  useLayoutEffect(() => { document.body.classList.toggle('theme-light', loadLoginPrefs().theme === 'light'); }, []);

  useEffect(() => {
    fetchMe()
      .then((user) => setPhase(user ? enter(user) : { kind: 'anon' }))
      .catch(() => setPhase({ kind: 'anon' }));
  }, []);

  useEffect(() => installUnauthorizedHandler(() => setPhase({ kind: 'anon' })), []);

  if (phase.kind === 'loading') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} aria-busy="true" />;
  }
  if (phase.kind === 'anon') {
    return <LoginScreen onSignedIn={(user) => setPhase(enter(user))} />;
  }
  return (
    <App
      key={phase.user.id}
      user={phase.user}
      onLogout={async () => {
        try {
          await logout();
        } catch (err) {
          // The UI still returns to the login screen; the session cookie expires server-side.
          console.warn('Logout request failed', err instanceof Error ? err.message : err);
        } finally {
          setPhase({ kind: 'anon' });
        }
      }}
    />
  );
}
