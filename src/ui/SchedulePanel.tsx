import { useEffect, useRef, useState } from 'preact/hooks';
import {
  fetchLatest, fetchSchedule, runNow, saveSchedule,
  type AnalysisSchedule, type StandardRun,
} from '../api/sharedAnalysis';
import {
  formToSchedule, isScheduleChanged, isScheduleSubmittable, scheduleToForm, type ScheduleForm,
} from '../lib/scheduleForm';
import { keepKnown } from '../lib/scheduleStatus';
import { Card, SectionLabel } from './primitives';

const TEXT = {
  en: {
    title: 'Analysis schedule', hint: 'Runs the shared standard analysis in the background at these times.',
    enabled: 'Scheduled analysis enabled', time1: 'First run time', time2: 'Second run time',
    tz: 'Timezone', lang: 'Analysis language', arabic: 'Arabic', english: 'English',
    save: 'Save', saving: 'Saving…', saved: 'Schedule saved.', runNow: 'Run now', running: 'Running…',
    ran: 'Analysis finished.', last: 'Last successful run', noRun: 'No run yet', statusUnavailable: 'Status unavailable', loading: 'Loading…',
    failed: 'Latest background failure', retry: 'Reload',
  },
  ar: {
    title: 'جدولة التحليل', hint: 'يشغّل التحليل القياسي المشترك في الخلفية في هذه الأوقات.',
    enabled: 'تفعيل التحليل المجدول', time1: 'وقت التشغيل الأول', time2: 'وقت التشغيل الثاني',
    tz: 'المنطقة الزمنية', lang: 'لغة التحليل', arabic: 'العربية', english: 'الإنجليزية',
    save: 'حفظ', saving: 'جارٍ الحفظ…', saved: 'تم حفظ الجدولة.', runNow: 'شغّل الآن', running: 'جارٍ التشغيل…',
    ran: 'انتهى التحليل.', last: 'آخر تشغيل ناجح', noRun: 'لا يوجد تشغيل بعد', statusUnavailable: 'الحالة غير متاحة', loading: 'جارٍ التحميل…',
    failed: 'آخر فشل في الخلفية', retry: 'إعادة التحميل',
  },
} as const;

const TIMEZONES = ['Africa/Cairo', 'UTC', 'Europe/London', 'Asia/Riyadh', 'Asia/Dubai'];

function formatRunTime(iso: string, tz: string, ar: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale = ar ? 'ar-EG' : 'en-GB';
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return date.toLocaleString(locale, { ...options, timeZone: tz });
  } catch {
    // An unknown timezone name makes Intl throw; fall back to the viewer's own zone.
    return date.toLocaleString(locale, options);
  }
}

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } as const;
const inputStyle = {
  background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
  fontFamily: 'var(--font-mono)', fontSize: 16, padding: '8px 10px', maxWidth: '100%', boxSizing: 'border-box',
} as const;

// failureMessage: the open background-failure message from the app-level notification list (null if none).
export function SchedulePanel({ ar, failureMessage }: { ar: boolean; failureMessage: string | null }) {
  const t = TEXT[ar ? 'ar' : 'en'];
  const [loaded, setLoaded] = useState<AnalysisSchedule | null>(null);
  const [form, setForm] = useState<ScheduleForm | null>(null);
  // undefined = unknown (status not read yet, or the read failed); null = the server says no run yet.
  const [latest, setLatest] = useState<StandardRun | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  // One action at a time: the ref guards two clicks in the same tick, before the disabled state renders.
  const inFlight = useRef(false);
  // Only the newest load may write state; an older response can resolve later.
  const loadSeq = useRef(0);
  const statusSeq = useRef(0);

  // The last-run line is informational: a failed read yields undefined (unknown) and must not hide the form
  // or overwrite a value we already know.
  const readStatus = () => fetchLatest().then((r) => r.latest, () => undefined);

  async function load() {
    const seq = ++loadSeq.current;
    statusSeq.current += 1;
    setLoadError(null);
    try {
      const [schedule, run] = await Promise.all([fetchSchedule(), readStatus()]);
      if (seq !== loadSeq.current) return;
      setLoaded(schedule);
      setForm(scheduleToForm(schedule));
      setLatest((prev) => keepKnown(run, prev));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  // Refreshes only the last-run line, so unsaved edits in the form survive a Run now.
  async function refreshStatus() {
    const seq = ++statusSeq.current;
    const run = await readStatus();
    if (seq !== statusSeq.current) return;
    setLatest((prev) => keepKnown(run, prev));
  }

  useEffect(() => { void load(); }, []);

  async function onSave() {
    if (inFlight.current || !form) return;
    inFlight.current = true;
    setBusy('save');
    setSaveError(null);
    setNotice(null);
    setRunError(null);
    try {
      const saved = await saveSchedule(formToSchedule(form));
      setLoaded(saved);
      setForm(scheduleToForm(saved));
      setNotice(t.saved);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function onRunNow() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('run');
    setSaveError(null);
    setNotice(null);
    setRunError(null);
    try {
      await runNow();
      setNotice(t.ran);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      try { await refreshStatus(); } catch { /* the status line just keeps its previous value */ }
      inFlight.current = false;
      setBusy(null);
    }
  }

  const patch = (change: Partial<ScheduleForm>) => {
    setNotice(null);
    setForm((prev) => (prev ? { ...prev, ...change } : prev));
  };
  const changed = form !== null && loaded !== null && isScheduleChanged(form, loaded);
  const submittable = form !== null && isScheduleSubmittable(form);
  const tz = loaded?.tz ?? 'UTC';

  return (
    <div style={{ marginTop: 24 }}>
      <SectionLabel text={t.title.toUpperCase()} />
      <Card style={{ padding: 14 }}>
        <div className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>{t.hint}</div>

        {loadError && (
          <div role="alert" style={{ color: 'var(--down)', marginBottom: 8, fontSize: 14, overflowWrap: 'anywhere' }}>
            {loadError}{' '}
            <button type="button" className="btn-outline" style={{ padding: '4px 10px' }} onClick={() => void load()}>{t.retry}</button>
          </div>
        )}

        {form === null ? (
          !loadError && <div className="soft-text">{t.loading}</div>
        ) : (
          <div role="group" aria-label={t.title}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input
                id="schedule-enabled" type="checkbox" role="switch" aria-checked={form.enabled}
                checked={form.enabled} style={{ width: 20, height: 20, accentColor: 'var(--gold)' }}
                onChange={(e) => patch({ enabled: (e.target as HTMLInputElement).checked })}
              />
              <label htmlFor="schedule-enabled" style={{ color: 'var(--text)', fontWeight: 600 }}>{t.enabled}</label>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div style={fieldStyle}>
                <label className="muted-text" style={{ fontSize: 13 }} htmlFor="schedule-time-1">{t.time1}</label>
                <input id="schedule-time-1" type="time" style={inputStyle} value={form.time1}
                  onInput={(e) => patch({ time1: (e.target as HTMLInputElement).value })} />
              </div>
              <div style={fieldStyle}>
                <label className="muted-text" style={{ fontSize: 13 }} htmlFor="schedule-time-2">{t.time2}</label>
                <input id="schedule-time-2" type="time" style={inputStyle} value={form.time2}
                  onInput={(e) => patch({ time2: (e.target as HTMLInputElement).value })} />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div style={fieldStyle}>
                <label className="muted-text" style={{ fontSize: 13 }} htmlFor="schedule-tz">{t.tz}</label>
                <input id="schedule-tz" type="text" list="schedule-tz-list" dir="ltr" autoComplete="off" spellcheck={false}
                  style={{ ...inputStyle, width: 220 }} value={form.tz}
                  onInput={(e) => patch({ tz: (e.target as HTMLInputElement).value })} />
                <datalist id="schedule-tz-list">
                  {TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
                </datalist>
              </div>
              <div style={fieldStyle}>
                <label className="muted-text" style={{ fontSize: 13 }} htmlFor="schedule-lang">{t.lang}</label>
                <select id="schedule-lang" style={inputStyle} value={form.language}
                  onChange={(e) => patch({ language: (e.target as HTMLSelectElement).value === 'ar' ? 'ar' : 'en' })}>
                  <option value="ar">{t.arabic}</option>
                  <option value="en">{t.english}</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn-primary" style={{ padding: '8px 14px' }}
                disabled={busy !== null || !changed || !submittable} onClick={() => void onSave()}>
                {busy === 'save' ? t.saving : t.save}
              </button>
              <button type="button" className="btn-outline" style={{ padding: '8px 14px' }}
                disabled={busy !== null} onClick={() => void onRunNow()}>
                {busy === 'run' ? t.running : t.runNow}
              </button>
            </div>

            <div style={{ marginTop: 10, minHeight: 20 }}>
              {saveError && <div role="alert" style={{ color: 'var(--down)', fontSize: 14, overflowWrap: 'anywhere' }}>{saveError}</div>}
              {runError && <div role="alert" style={{ color: 'var(--down)', fontSize: 14, overflowWrap: 'anywhere' }}>{runError}</div>}
              {busy === 'run' && <div role="status" className="soft-text" style={{ fontSize: 14 }}>{t.running}</div>}
              {notice && busy === null && <div role="status" style={{ color: 'var(--up)', fontSize: 14 }}>{notice}</div>}
            </div>

            <div className="muted-text" style={{ fontSize: 13, marginTop: 6, overflowWrap: 'anywhere' }}>
              {latest === undefined
                ? t.statusUnavailable
                : latest
                  ? `${t.last} ${formatRunTime(latest.created_at, tz, ar)} · ${latest.provider_label}`
                  : t.noRun}
            </div>
            {failureMessage && (
              <div style={{ fontSize: 13, marginTop: 6, color: 'var(--down)', overflowWrap: 'anywhere' }}>
                {t.failed}: {failureMessage}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
