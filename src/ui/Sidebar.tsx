import { Icon } from './primitives';

export type ScreenKey =
  | 'home'
  | 'calc'
  | 'target'
  | 'scenarios'
  | 'egypt'
  | 'ai'
  | 'dca'
  | 'watch'
  | 'wallet'
  | 'settings';

const SCREEN_ORDER: ScreenKey[] = ['home', 'calc', 'target', 'scenarios', 'egypt', 'ai', 'dca', 'watch', 'wallet', 'settings'];

const SCREEN_ICONS: Record<ScreenKey, string> = {
  home: 'home',
  calc: 'calculator',
  target: 'target',
  scenarios: 'scenarios',
  egypt: 'egypt',
  ai: 'analyst',
  dca: 'dca',
  watch: 'watchlist',
  wallet: 'wallet',
  settings: 'settings',
};

export const NAV_LABELS: Record<ScreenKey, { en: string; ar: string }> = {
  home: { en: 'Market', ar: 'السوق' },
  calc: { en: 'Calculator', ar: 'الحاسبة' },
  target: { en: 'Target', ar: 'الهدف' },
  scenarios: { en: 'Scenarios', ar: 'السيناريوهات' },
  egypt: { en: 'Egypt', ar: 'مصر' },
  ai: { en: 'Analyst', ar: 'المحلل' },
  dca: { en: 'DCA Plan', ar: 'خطة DCA' },
  watch: { en: 'Watchlist', ar: 'المراقبة' },
  wallet: { en: 'Wallet', ar: 'المحفظة' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
};

export function Sidebar({
  screen,
  setScreen,
  ar,
  isLight,
  toggleTheme,
  toggleLang,
  liveLabel,
  isAdmin,
  userName,
  onLogout,
  settingsBadge,
}: {
  screen: ScreenKey;
  setScreen: (s: ScreenKey) => void;
  ar: boolean;
  isLight: boolean;
  toggleTheme: () => void;
  toggleLang: () => void;
  liveLabel: string;
  isAdmin: boolean;
  userName: string;
  onLogout: () => void;
  settingsBadge?: number;
}) {
  const screens = isAdmin ? SCREEN_ORDER : SCREEN_ORDER.filter((s) => s !== 'settings');
  return (
    <nav
      className="app-sidebar"
      style={{
        width: 'var(--sidebar-w)',
        minWidth: 'var(--sidebar-w)',
        background: 'var(--surface)',
        borderRight: ar ? 'none' : '1px solid var(--border)',
        borderLeft: ar ? '1px solid var(--border)' : 'none',
        flexDirection: 'column',
        padding: '20px 12px',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <div style={{ marginBottom: 24, paddingInlineStart: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: 'var(--gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: 'var(--bg)', fontWeight: 800, fontSize: 15 }}>✦</span>
          </div>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '0.02em', color: 'var(--text)' }}>
            {ar ? 'كوكبيت' : 'Cockpit'}
          </span>
        </div>
        <div className="muted-text" style={{ fontSize: 14, paddingInlineStart: 36 }}>
          {ar ? 'إدارة الذهب' : 'Gold Intelligence'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto' }}>
        {screens.map((s) => (
          <button
            key={s}
            type="button"
            className={`nav-item ${screen === s ? 'active' : ''}`}
            aria-current={screen === s ? 'page' : undefined}
            onClick={() => setScreen(s)}
          >
            <Icon name={SCREEN_ICONS[s]} size={16} />
            <span>{NAV_LABELS[s][ar ? 'ar' : 'en']}</span>
            {s === 'settings' && settingsBadge ? (
              <span style={{ marginInlineStart: 'auto', background: 'var(--gold)', color: 'var(--bg)', borderRadius: 999, padding: '0 7px', fontSize: 12, fontWeight: 700 }}>{settingsBadge}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-outline" style={{ flex: 1, padding: '6px 0', fontSize: 15 }} onClick={toggleLang}>
            {ar ? 'EN' : 'عربي'}
          </button>
          <button
            type="button"
            className="btn-outline"
            style={{ flex: 1, padding: '6px 0', fontSize: 15, display: 'flex', justifyContent: 'center' }}
            onClick={toggleTheme}
            aria-label={isLight ? (ar ? 'التحويل للوضع الداكن' : 'Switch to dark mode') : (ar ? 'التحويل للوضع الفاتح' : 'Switch to light mode')}
          >
            <Icon name={isLight ? 'moon' : 'sun'} size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingInlineStart: 4 }}>
          <span className="muted-text" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={userName}>
            {userName}
          </span>
          <button type="button" className="btn-outline" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => void onLogout()}>
            {ar ? 'خروج' : 'Log out'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingInlineStart: 4 }}>
          <div className="live-dot" />
          <span className="muted-text font-mono" style={{ fontSize: 14 }}>
            {liveLabel}
          </span>
        </div>
      </div>
    </nav>
  );
}
