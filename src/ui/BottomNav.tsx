import { useState } from 'preact/hooks';
import { Icon } from './primitives';
import { NAV_LABELS, type ScreenKey } from './Sidebar';

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
}: {
  screen: ScreenKey;
  setScreen: (s: ScreenKey) => void;
  ar: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isMoreActive = MORE_SCREENS.some((s) => s.key === screen);

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
          <Icon name="more" size={21} />
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
            {MORE_SCREENS.map(({ key, icon }) => (
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
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
