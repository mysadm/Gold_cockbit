import { useState } from 'preact/hooks';
import { Icon } from './primitives';
import { NAV_LABELS, pendingSignupsLabel, type ScreenKey } from './Sidebar';

const PRIMARY_TABS: { key: ScreenKey; icon: string }[] = [
  { key: 'home', icon: 'home' },
  { key: 'calc', icon: 'calculator' },
  { key: 'wallet', icon: 'wallet' },
  { key: 'ai', icon: 'analyst' },
];

// The six screens that don't fit in the five-tab bar — reached through the
// "More" sheet instead. Order matches Sidebar's own SCREEN_ORDER for the
// same reasoning (most-used-first), minus the four already in PRIMARY_TABS.
const MORE_SCREENS: { key: ScreenKey; icon: string }[] = [
  { key: 'target', icon: 'target' },
  { key: 'scenarios', icon: 'scenarios' },
  { key: 'egypt', icon: 'egypt' },
  { key: 'dca', icon: 'dca' },
  { key: 'watch', icon: 'watchlist' },
  { key: 'settings', icon: 'settings' },
];

const MORE_LABEL = { en: 'More', ar: 'المزيد' };

export function BottomNav({
  screen,
  setScreen,
  ar,
  isLight,
  toggleTheme,
  toggleLang,
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
  isAdmin: boolean;
  userName: string;
  onLogout: () => void;
  settingsBadge?: number;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreScreens = isAdmin ? MORE_SCREENS : MORE_SCREENS.filter((s) => s.key !== 'settings');
  const isMoreActive = moreScreens.some((s) => s.key === screen);

  return (
    <>
      <nav className="app-bottom-nav bottom-nav" aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
        {PRIMARY_TABS.map(({ key, icon }) => (
          <button
            key={key}
            type="button"
            className="tab-btn"
            aria-current={screen === key ? 'page' : undefined}
            onClick={() => setScreen(key)}
          >
            <Icon name={icon} size={21} />
            <span>{NAV_LABELS[key][ar ? 'ar' : 'en']}</span>
          </button>
        ))}
        <button
          type="button"
          className="tab-btn"
          aria-current={isMoreActive ? 'page' : undefined}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Icon name="more" size={21} />
            {isAdmin && settingsBadge ? (
              <span
                role="img"
                aria-label={pendingSignupsLabel(settingsBadge, ar)}
                style={{ position: 'absolute', top: -5, insetInlineEnd: -9, minWidth: 16, height: 16, boxSizing: 'border-box', padding: '0 4px', borderRadius: 999, background: 'var(--gold)', color: 'var(--bg)', fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center' }}
              >
                {settingsBadge}
              </span>
            ) : null}
          </span>
          <span>{MORE_LABEL[ar ? 'ar' : 'en']}</span>
        </button>
      </nav>

      {sheetOpen && (
        <div
          className="more-sheet-backdrop"
          role="presentation"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="more-sheet instrument-card"
            role="dialog"
            aria-label={MORE_LABEL[ar ? 'ar' : 'en']}
            onClick={(e) => e.stopPropagation()}
          >
            {moreScreens.map(({ key, icon }) => (
              <button
                key={key}
                type="button"
                className={`nav-item ${screen === key ? 'active' : ''}`}
                aria-current={screen === key ? 'page' : undefined}
                onClick={() => {
                  setScreen(key);
                  setSheetOpen(false);
                }}
              >
                <Icon name={icon} size={16} />
                <span>{NAV_LABELS[key][ar ? 'ar' : 'en']}</span>
                {key === 'settings' && settingsBadge ? (
                  <span role="img" aria-label={pendingSignupsLabel(settingsBadge, ar)} style={{ marginInlineStart: 'auto', background: 'var(--gold)', color: 'var(--bg)', borderRadius: 999, padding: '0 7px', fontSize: 12, fontWeight: 700 }}>{settingsBadge}</span>
                ) : null}
              </button>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 4px 0' }}>
              <span className="muted-text" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</span>
              <button type="button" className="btn-outline" style={{ padding: '6px 12px', fontSize: 14 }} onClick={() => { setSheetOpen(false); void onLogout(); }}>
                {ar ? 'خروج' : 'Log out'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn-outline" style={{ flex: 1, padding: '10px 0', fontSize: 15 }} onClick={toggleLang}>
                {ar ? 'EN' : 'عربي'}
              </button>
              <button
                type="button"
                className="btn-outline"
                style={{ flex: 1, padding: '10px 0', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                onClick={toggleTheme}
                aria-label={isLight ? (ar ? 'التحويل للوضع الداكن' : 'Switch to dark mode') : (ar ? 'التحويل للوضع الفاتح' : 'Switch to light mode')}
              >
                <Icon name={isLight ? 'moon' : 'sun'} size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
