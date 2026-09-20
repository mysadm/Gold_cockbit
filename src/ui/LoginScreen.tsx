import { useEffect, useState } from 'preact/hooks';
import { AuthError, login, register, type CurrentUser } from '../api/auth';
import { Icon } from './primitives';

type Lang = 'ar' | 'en';
type Prefs = { lang: Lang; theme: 'dark' | 'light' };
const PREFS_KEY = 'gold-cockpit-login-prefs';

const TEXT = {
  en: {
    title: 'Gold Cockpit', signIn: 'Sign in', createAccount: 'Create account', email: 'Email', password: 'Password',
    name: 'Your name', signInBtn: 'Sign in', registerBtn: 'Request access', toRegister: 'New here? Request an account',
    toLogin: 'Already approved? Sign in', pendingTitle: 'Waiting for approval',
    pendingBody: 'Your account was created. The admin has to approve it before you can sign in.',
    backToLogin: 'Back to sign in', minPw: 'At least 8 characters', busy: 'Please wait…',
    langBtn: 'عربي', toDark: 'Switch to dark mode', toLight: 'Switch to light mode',
    disabled: 'This account is disabled. Contact the admin.',
  },
  ar: {
    title: 'كوكبيت الذهب', signIn: 'تسجيل الدخول', createAccount: 'إنشاء حساب', email: 'البريد الإلكتروني', password: 'كلمة المرور',
    name: 'اسمك', signInBtn: 'دخول', registerBtn: 'طلب حساب', toRegister: 'جديد؟ اطلب حساباً',
    toLogin: 'تمت الموافقة؟ سجّل الدخول', pendingTitle: 'بانتظار الموافقة',
    pendingBody: 'تم إنشاء حسابك. يجب أن يوافق المدير عليه قبل أن تتمكن من الدخول.',
    backToLogin: 'العودة لتسجيل الدخول', minPw: '٨ أحرف على الأقل', busy: 'لحظة…',
    langBtn: 'EN', toDark: 'التحويل للوضع الداكن', toLight: 'التحويل للوضع الفاتح',
    disabled: 'هذا الحساب معطّل. تواصل مع المدير.',
  },
} as const;

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && (parsed.lang === 'ar' || parsed.lang === 'en') && (parsed.theme === 'dark' || parsed.theme === 'light')) return parsed;
  } catch { /* fall through to defaults */ }
  return { lang: 'ar', theme: 'dark' };
}

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [mode, setMode] = useState<'login' | 'register' | 'pending'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = TEXT[prefs.lang];
  const ar = prefs.lang === 'ar';

  useEffect(() => {
    document.body.classList.toggle('theme-light', prefs.theme === 'light');
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage may be blocked */ }
  }, [prefs]);

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await register(email, password, name);
        setMode('pending');
      } else {
        onSignedIn(await login(email, password));
      }
    } catch (err) {
      if (err instanceof AuthError && err.code === 'pending') setMode('pending');
      else if (err instanceof AuthError && err.code === 'disabled') setError(t.disabled);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir={ar ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--bg)' }}>
      <div className="instrument-card" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{t.title}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn-outline" style={{ padding: '6px 10px' }} onClick={() => setPrefs({ ...prefs, lang: ar ? 'en' : 'ar' })}>{t.langBtn}</button>
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '6px 10px', display: 'flex', alignItems: 'center' }}
              aria-label={prefs.theme === 'light' ? t.toDark : t.toLight}
              onClick={() => setPrefs({ ...prefs, theme: prefs.theme === 'light' ? 'dark' : 'light' })}
            >
              <Icon name={prefs.theme === 'light' ? 'moon' : 'sun'} size={14} />
            </button>
          </div>
        </div>

        {mode === 'pending' ? (
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{t.pendingTitle}</div>
            <p className="soft-text" style={{ lineHeight: 1.7, marginBottom: 16 }}>{t.pendingBody}</p>
            <button type="button" className="btn-outline" style={{ width: '100%', padding: 10 }} onClick={() => setMode('login')}>{t.backToLogin}</button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="section-label">{mode === 'login' ? t.signIn : t.createAccount}</div>
            {mode === 'register' && (
              <input type="text" placeholder={t.name} value={name} autoComplete="name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            )}
            <input type="email" placeholder={t.email} value={email} autoComplete="email" required onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <input
              type="password"
              placeholder={mode === 'register' ? `${t.password} — ${t.minPw}` : t.password}
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
            {error && <div role="alert" className="down-text" style={{ fontSize: 14 }}>{error}</div>}
            <button type="submit" className="btn-primary" style={{ padding: 12 }} disabled={busy}>
              {busy ? t.busy : mode === 'login' ? t.signInBtn : t.registerBtn}
            </button>
            <button type="button" className="btn-outline" style={{ padding: 10 }} onClick={() => { setError(null); setMode(mode === 'login' ? 'register' : 'login'); }}>
              {mode === 'login' ? t.toRegister : t.toLogin}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
