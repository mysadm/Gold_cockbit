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
  vault,
  toggleTheme,
  toggleLang,
  liveLabel,
}: {
  screen: ScreenKey;
  setScreen: (s: ScreenKey) => void;
  ar: boolean;
  vault: boolean;
  toggleTheme: () => void;
  toggleLang: () => void;
  liveLabel: string;
}) {
  return (
    <nav
      style={{
        width: 'var(--sidebar-w)',
        minWidth: 'var(--sidebar-w)',
        background: 'var(--surface)',
        borderRight: ar ? 'none' : '1px solid var(--border)',
        borderLeft: ar ? '1px solid var(--border)' : 'none',
        display: 'flex',
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
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'var(--gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#0e1210', fontWeight: 700, fontSize: 18 }}>✦</span>
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
        {SCREEN_ORDER.map((s) => (
          <div key={s} className={`nav-item ${screen === s ? 'active' : ''}`} onClick={() => setScreen(s)}>
            <Icon name={SCREEN_ICONS[s]} size={16} />
            <span>{NAV_LABELS[s][ar ? 'ar' : 'en']}</span>
          </div>
        ))}
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-outline" style={{ flex: 1, padding: '6px 0', fontSize: 15 }} onClick={toggleLang}>
            {ar ? 'EN' : 'عربي'}
          </button>
          <button className="btn-outline" style={{ flex: 1, padding: '6px 0', fontSize: 15, display: 'flex', justifyContent: 'center' }} onClick={toggleTheme}>
            <Icon name={vault ? 'sun' : 'moon'} size={12} />
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
