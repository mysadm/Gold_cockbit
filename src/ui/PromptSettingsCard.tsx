import { useEffect, useRef, useState } from 'preact/hooks';
import {
  fetchPromptSettings, resetPrompt, savePrompt, testPrompt,
  type PromptDraft, type PromptKind, type PromptSettings, type PromptTestResult,
} from '../api/adminPrompts';
import { draftState, type TestedDraft } from '../lib/promptDraft';
import { Card, SectionLabel } from './primitives';

const TEXT = {
  en: {
    titles: { standard: 'Standard analysis prompt', personalized: 'Personalized analysis prompt' },
    hints: {
      standard: 'The instructions for the shared market analysis that runs in the background for everyone. Locked by default: every change must pass a test and be signed with your password.',
      personalized: 'The instructions for the analysis each user runs on request, with their own wallet and DCA plan. Locked by default: every change must pass a test and be signed with your password.',
    },
    testHints: {
      standard: 'Runs a real standard analysis with this prompt. Nothing is saved or shown to users.',
      personalized: 'Runs a real analysis with this prompt on the live market data and a sample portfolio (beginner level). Nothing is saved or shown to users.',
    },
    prompt: 'Instructions',
    rulesTitle: 'Always added after your instructions (locked)',
    format: 'Output format and style',
    formatHint: 'How the answer must look, including the JSON example. Use {LANG} where the answer language goes. These keys must stay: ',
    formatReset: 'Restore default format',
    customized: 'Customized', builtIn: 'Built-in default', revision: 'revision', by: 'by',
    unlock: 'Unlock editing', lock: 'Lock and discard edits', locked: 'Locked. Unlock to edit.',
    chars: 'characters', test: 'Test changes', testing: 'Testing… (up to about 90 seconds)',
    passed: 'Test passed', failed: 'Test failed', mustTest: 'Test these exact texts before saving.',
    password: 'Your password (signs this change)', save: 'Sign and save', saving: 'Saving…', saved: 'Prompts saved.',
    reset: 'Reset to default', resetting: 'Resetting…', resetDone: 'Prompts reset to the built-in default.',
    decision: 'Decision', modelAnswer: 'What the model answered (first part)', loading: 'Loading…', retry: 'Reload', needPassword: 'Enter your password.',
  },
  ar: {
    titles: { standard: 'تعليمات التحليل القياسي', personalized: 'تعليمات التحليل الشخصي' },
    hints: {
      standard: 'تعليمات تحليل السوق المشترك الذي يعمل في الخلفية للجميع. مقفلة افتراضيًا: كل تعديل يجب أن يجتاز اختبارًا ويُوقَّع بكلمة مرورك.',
      personalized: 'تعليمات التحليل الذي يشغّله كل مستخدم عند الطلب بمحفظته وخطة الشراء الخاصة به. مقفلة افتراضيًا: كل تعديل يجب أن يجتاز اختبارًا ويُوقَّع بكلمة مرورك.',
    },
    testHints: {
      standard: 'يشغّل تحليلًا قياسيًا حقيقيًا بهذه التعليمات. لا يُحفظ شيء ولا يظهر للمستخدمين.',
      personalized: 'يشغّل تحليلًا حقيقيًا بهذه التعليمات على بيانات السوق الحية ومحفظة تجريبية (مستوى مبتدئ). لا يُحفظ شيء ولا يظهر للمستخدمين.',
    },
    prompt: 'التعليمات',
    rulesTitle: 'تُضاف دائمًا بعد تعليماتك (مقفلة)',
    format: 'شكل المخرجات وأسلوبها',
    formatHint: 'شكل الإجابة المطلوب بما فيه مثال JSON. استخدم {LANG} مكان لغة الإجابة. يجب أن تبقى هذه المفاتيح: ',
    formatReset: 'استعادة الشكل الافتراضي',
    customized: 'مُعدَّلة', builtIn: 'الافتراضية المدمجة', revision: 'النسخة', by: 'بواسطة',
    unlock: 'فتح التعديل', lock: 'قفل وتجاهل التعديلات', locked: 'مقفلة. افتح التعديل لتغييرها.',
    chars: 'حرف', test: 'اختبر التعديلات', testing: 'جارٍ الاختبار… (حتى 90 ثانية تقريبًا)',
    passed: 'نجح الاختبار', failed: 'فشل الاختبار', mustTest: 'اختبر هذه النصوص نفسها قبل الحفظ.',
    password: 'كلمة مرورك (توقّع هذا التغيير)', save: 'وقّع واحفظ', saving: 'جارٍ الحفظ…', saved: 'تم حفظ التعليمات.',
    reset: 'إعادة للافتراضي', resetting: 'جارٍ الإعادة…', resetDone: 'تمت إعادة التعليمات إلى الافتراضي المدمج.',
    decision: 'القرار', modelAnswer: 'ما أجاب به النموذج (الجزء الأول)', loading: 'جارٍ التحميل…', retry: 'إعادة التحميل', needPassword: 'أدخل كلمة مرورك.',
  },
} as const;

const areaStyle = {
  width: '100%', minHeight: 160, boxSizing: 'border-box', resize: 'vertical', background: 'var(--elevated)',
  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--font-mono)',
  fontSize: 16, lineHeight: 1.5, padding: '8px 10px',
} as const;
const inputStyle = {
  background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
  fontSize: 16, padding: '8px 10px', maxWidth: '100%', boxSizing: 'border-box',
} as const;

// One card per prompt ("standard" or "personalized"): each has its own lock, test and signed save.
export function PromptSettingsCard({ ar, kind }: { ar: boolean; kind: PromptKind }) {
  const t = TEXT[ar ? 'ar' : 'en'];
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [draft, setDraft] = useState<PromptDraft>({ text: '', format: '' });
  const [unlocked, setUnlocked] = useState(false);
  const [lastTest, setLastTest] = useState<TestedDraft | null>(null);
  const [testResult, setTestResult] = useState<PromptTestResult | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlight = useRef(false);

  function apply(next: PromptSettings) {
    setSettings(next);
    setDraft({ text: next[kind].text, format: next[kind].format });
    setLastTest(null);
    setTestResult(null);
    setPassword('');
    setUnlocked(false);
  }

  async function load() {
    setLoadError(null);
    try {
      apply(await fetchPromptSettings());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<void>, which: 'test' | 'save' | 'reset') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(which);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const onTest = () => run(async () => {
    const tested = { ...draft };
    setTestResult(null);
    const result = await testPrompt(kind, tested);
    setTestResult(result);
    setLastTest({ draft: tested, passed: result.passed });
  }, 'test');
  const onSave = () => run(async () => {
    if (!password) throw new Error(t.needPassword);
    try {
      apply(await savePrompt(kind, draft, password));
      setNotice(t.saved);
    } finally {
      setPassword('');
    }
  }, 'save');
  const onReset = () => run(async () => {
    if (!password) throw new Error(t.needPassword);
    try {
      apply(await resetPrompt(kind, password));
      setNotice(t.resetDone);
    } finally {
      setPassword('');
    }
  }, 'reset');

  const entry = settings?.[kind] ?? null;
  const state = settings && entry ? draftState(draft, { text: entry.text, format: entry.format }, lastTest, unlocked, settings.maxLength) : null;
  const title = t.titles[kind];
  const idBase = `prompt-${kind}`;

  return (
    <div style={{ marginTop: 24 }}>
      <SectionLabel text={title.toUpperCase()} />
      <Card style={{ padding: 14 }}>
        <div className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>{t.hints[kind]}</div>

        {loadError && (
          <div role="alert" style={{ color: 'var(--down)', marginBottom: 8, fontSize: 14, overflowWrap: 'anywhere' }}>
            {loadError}{' '}
            <button type="button" className="btn-outline" style={{ padding: '4px 10px' }} onClick={() => void load()}>{t.retry}</button>
          </div>
        )}

        {settings === null || entry === null ? (
          !loadError && <div className="soft-text">{t.loading}</div>
        ) : (
          <div role="group" aria-label={title}>
            <div className="muted-text" style={{ fontSize: 13, marginBottom: 12, overflowWrap: 'anywhere' }}>
              {entry.customized
                ? `${t.customized} · ${t.revision} ${entry.revision}${entry.updatedBy ? ` · ${t.by} ${entry.updatedBy}` : ''}`
                : t.builtIn}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor={`${idBase}-text`} style={{ color: 'var(--text)', fontWeight: 600 }}>{t.prompt}</label>
              <textarea id={`${idBase}-text`} dir="auto" readOnly={!unlocked || busy !== null}
                style={{ ...areaStyle, minHeight: 240, marginTop: 4, opacity: unlocked ? 1 : 0.7 }}
                value={draft.text} onInput={(e) => { setNotice(null); setDraft((prev) => ({ ...prev, text: (e.target as HTMLTextAreaElement).value })); }} />
              <div className="muted-text" style={{ fontSize: 12 }}>{draft.text.length} / {settings.maxLength} {t.chars}</div>
            </div>

            <details style={{ marginBottom: 14 }}>
              <summary className="muted-text" style={{ cursor: 'pointer', fontSize: 13 }}>{t.rulesTitle}</summary>
              <pre dir="ltr" style={{ ...areaStyle, minHeight: 0, overflow: 'auto', whiteSpace: 'pre-wrap', opacity: 0.8, fontSize: 13 }}>{settings.lockedRules}</pre>
            </details>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor={`${idBase}-format`} style={{ color: 'var(--text)', fontWeight: 600 }}>{t.format}</label>
              <div className="muted-text" dir="auto" style={{ fontSize: 13, marginBottom: 4, overflowWrap: 'anywhere' }}>
                {t.formatHint}<span dir="ltr">{settings.requiredKeys.join(', ')}</span>
              </div>
              <textarea id={`${idBase}-format`} dir="ltr" readOnly={!unlocked || busy !== null}
                style={{ ...areaStyle, minHeight: 240, opacity: unlocked ? 1 : 0.7 }}
                value={draft.format} onInput={(e) => { setNotice(null); setDraft((prev) => ({ ...prev, format: (e.target as HTMLTextAreaElement).value })); }} />
              <div className="muted-text" style={{ fontSize: 12 }}>
                {draft.format.length} / {settings.maxLength} {t.chars}
                {unlocked && (
                  <button type="button" className="btn-outline" style={{ padding: '2px 8px', marginInlineStart: 8, fontSize: 12 }}
                    disabled={busy !== null || draft.format === entry.defaultFormat}
                    onClick={() => { setNotice(null); setDraft((prev) => ({ ...prev, format: entry.defaultFormat })); }}>{t.formatReset}</button>
                )}
              </div>
            </div>

            {!unlocked ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button type="button" className="btn-outline" style={{ padding: '8px 14px' }} disabled={busy !== null}
                  onClick={() => { setUnlocked(true); setNotice(null); setError(null); }}>{t.unlock}</button>
                <span className="muted-text" style={{ fontSize: 13 }}>{t.locked}</span>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <button type="button" className="btn-outline" style={{ padding: '8px 14px' }}
                    disabled={busy !== null || !state?.canTest} onClick={() => void onTest()}>
                    {busy === 'test' ? t.testing : t.test}
                  </button>
                  <button type="button" className="btn-outline" style={{ padding: '8px 14px' }} disabled={busy !== null}
                    onClick={() => { setDraft({ text: entry.text, format: entry.format }); setLastTest(null); setTestResult(null); setPassword(''); setError(null); setUnlocked(false); }}>
                    {t.lock}
                  </button>
                </div>
                <div className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>{t.testHints[kind]}</div>

                {testResult && (
                  <div role="status" dir="auto" style={{ fontSize: 14, marginBottom: 10, overflowWrap: 'anywhere', color: testResult.passed ? 'var(--up)' : 'var(--down)' }}>
                    <strong>{testResult.passed ? t.passed : t.failed}</strong>
                    {testResult.reason ? `: ${testResult.reason}` : ''}
                    {testResult.headline ? <div className="muted-text">{t.decision}: {testResult.action} — {testResult.headline}</div> : null}
                    {testResult.hint ? <div style={{ marginTop: 6 }}>{testResult.hint}</div> : null}
                    {testResult.answerPreview ? (
                      <details style={{ marginTop: 6 }}>
                        <summary className="muted-text" style={{ cursor: 'pointer', fontSize: 13 }}>{t.modelAnswer}</summary>
                        <pre dir="ltr" style={{ ...areaStyle, minHeight: 0, overflow: 'auto', whiteSpace: 'pre-wrap', opacity: 0.85, fontSize: 13 }}>{testResult.answerPreview}</pre>
                      </details>
                    ) : null}
                  </div>
                )}
                {state?.dirty && !state.tested && !testResult && <div className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>{t.mustTest}</div>}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 6 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <label className="muted-text" style={{ fontSize: 13 }} htmlFor={`${idBase}-password`}>{t.password}</label>
                    <input id={`${idBase}-password`} type="password" autoComplete="current-password" style={{ ...inputStyle, width: 240 }}
                      value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
                  </div>
                  <button type="button" className="btn-primary" style={{ padding: '8px 14px' }}
                    disabled={busy !== null || !state?.canSave || !password} onClick={() => void onSave()}>
                    {busy === 'save' ? t.saving : t.save}
                  </button>
                  <button type="button" className="btn-outline" style={{ padding: '8px 14px' }}
                    disabled={busy !== null || !entry.customized || !password} onClick={() => void onReset()}>
                    {busy === 'reset' ? t.resetting : t.reset}
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 10, minHeight: 20 }}>
              {error && <div role="alert" style={{ color: 'var(--down)', fontSize: 14, overflowWrap: 'anywhere' }}>{error}</div>}
              {notice && busy === null && <div role="status" style={{ color: 'var(--up)', fontSize: 14 }}>{notice}</div>}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
