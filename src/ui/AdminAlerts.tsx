import { useEffect, useRef, useState } from 'preact/hooks';
import { dismissNotification, fetchNotifications, type AdminNotification } from '../api/sharedAnalysis';

const TEXT = {
  en: { heading: 'Standard analysis failed', dismiss: 'Dismiss', settings: 'Open Settings', dismissFailed: 'Could not dismiss — try again' },
  ar: { heading: 'فشل التحليل القياسي', dismiss: 'إغلاق', settings: 'فتح الإعدادات', dismissFailed: 'تعذّر الإغلاق — حاول مرة أخرى' },
} as const;

const REFRESH_MS = 2 * 60 * 1000;

export function AdminAlerts({ ar, onOpenSettings, onChange }: { ar: boolean; onOpenSettings: () => void; onChange: (list: AdminNotification[]) => void }) {
  const t = TEXT[ar ? 'ar' : 'en'];
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const inFlight = useRef(false);
  // Only the newest load may write state; an older response can resolve later.
  const loadSeq = useRef(0);
  const [dismissError, setDismissError] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  async function load() {
    const seq = ++loadSeq.current;
    try {
      const list = await fetchNotifications();
      if (seq !== loadSeq.current) return;
      setItems(list);
      onChangeRef.current(list);
    } catch {
      // Keep whatever is showing; the next poll retries.
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  async function dismiss(id: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(id);
    setDismissError(false);
    try {
      await dismissNotification(id);
    } catch {
      // The reload below re-shows the item, so say why nothing happened.
      setDismissError(true);
    } finally {
      await load();
      inFlight.current = false;
      setBusyId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        margin: '12px 16px 0', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--down)',
        background: 'color-mix(in srgb, var(--down) 12%, var(--surface))', color: 'var(--text)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {items.map((n) => (
        <div key={n.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: '1 1 220px' }}>
            <div style={{ fontWeight: 700, color: 'var(--down)' }}>{t.heading}</div>
            <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{n.message}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn-outline" style={{ padding: '6px 12px' }} onClick={onOpenSettings}>{t.settings}</button>
            <button type="button" className="btn-outline" style={{ padding: '6px 12px' }} disabled={busyId !== null} aria-label={`${t.dismiss}: ${n.message}`}
              onClick={() => void dismiss(n.id)}>{t.dismiss}</button>
          </div>
        </div>
      ))}
      {/* Its own alert region, apart from the polled list, so the failure is announced once. */}
      {dismissError && <div role="alert" style={{ fontSize: 14, color: 'var(--down)' }}>{t.dismissFailed}</div>}
    </div>
  );
}
