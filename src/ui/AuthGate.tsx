import { useEffect, useState } from 'preact/hooks';
import App from '../App';
import { fetchMe, logout, installUnauthorizedHandler, type CurrentUser } from '../api/auth';
import { migrateLegacyStorage } from '../lib/userStorage';
import { LoginScreen } from './LoginScreen';

type Phase = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; user: CurrentUser };

function enter(user: CurrentUser): Phase {
  try { migrateLegacyStorage(window.localStorage, user); } catch { /* storage may be blocked */ }
  return { kind: 'authed', user };
}

export function AuthGate() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

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
        try { await logout(); } finally { setPhase({ kind: 'anon' }); }
      }}
    />
  );
}
