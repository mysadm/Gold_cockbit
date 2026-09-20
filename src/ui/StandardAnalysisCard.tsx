import { useMemo, useState } from 'preact/hooks';
import { Card, SectionLabel } from './primitives';
import { parseCompactAnalysis, type AIResultV2 } from '../lib/analyst';
import type { AnalysisSnapshot } from '../lib/analysisSnapshot';
import type { AnalysisSchedule, StandardRun } from '../api/sharedAnalysis';

type Weights = { deesc: number; base: number; stag: number };
const SCEN_KEYS = ['deesc', 'base', 'stag'] as const;

const S = {
  ar: {
    title: 'التحليل القياسي للسوق',
    updated: 'آخر تحديث',
    next: 'التحديث القادم',
    loading: 'بيحمّل التحليل القياسي…',
    failed: 'تعذر تحميل التحليل القياسي دلوقتي.',
    updating: 'بيتحدّث…',
    noneYet: 'لسه مفيش تحليل قياسي — أول واحد هيشتغل',
    noneYetPlain: 'لسه مفيش تحليل قياسي.',
    off: 'التحليل المجدول متوقف',
    notPersonal: 'مش مخصص ليك — من غير محفظة أو خطة شراء تدريجي.',
    evidenceH: 'الأدلة',
    assumptionsH: 'الافتراضات',
    weightsH: 'الأوزان المقترحة',
    apply: 'طبّق هذه الأوزان',
    applied: '✓ تم التطبيق',
    applyDisabled: 'غير متاح: هذا التحليل لم يجتز الفحص أو أدلته غير كافية',
    confidence: 'الثقة',
    action: { buy: 'شراء', hold: 'احتفاظ', wait: 'انتظار', reduce: 'تخفيض', review: 'مراجعة', insufficient_evidence: 'أدلة غير كافية' },
    level: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' },
    scen: { deesc: 'تغيرات جيوسياسية', base: 'الأساسي', stag: 'فخ الركود' },
  },
  en: {
    title: 'Standard market analysis',
    updated: 'Updated',
    next: 'next update',
    loading: 'Loading the standard analysis…',
    failed: 'Could not load the standard analysis right now.',
    updating: 'Updating…',
    noneYet: 'No standard analysis yet — the first one runs at',
    noneYetPlain: 'No standard analysis yet.',
    off: 'Scheduled analysis is off',
    notPersonal: 'Not personalized — no wallet or DCA data.',
    evidenceH: 'EVIDENCE',
    assumptionsH: 'ASSUMPTIONS',
    weightsH: 'SUGGESTED WEIGHTS',
    apply: 'Apply these weights',
    applied: '✓ Applied',
    applyDisabled: 'Unavailable: this analysis failed validation or has insufficient evidence',
    confidence: 'Confidence',
    action: { buy: 'Buy', hold: 'Hold', wait: 'Wait', reduce: 'Reduce', review: 'Review', insufficient_evidence: 'Insufficient evidence' },
    level: { low: 'Low', medium: 'Medium', high: 'High' },
    scen: { deesc: 'Geopolitical Changes', base: 'Base Case', stag: 'Stagflation Trap' },
  },
} as const;

/** Parse a stored server run with the same parser the personalized analysis uses. Null when it does not parse. */
export function parseStandardRun(run: StandardRun | null | undefined): AIResultV2 | null {
  if (!run) return null;
  try {
    return parseCompactAnalysis(run.text, run.snapshot as AnalysisSnapshot, run.evidence_sources.map((s) => s.id));
  } catch {
    return null;
  }
}

/** Same guard as the personalized Apply button: validation ok, not insufficient evidence, weights valid and totalling 100. */
export function canApplyWeights(run: StandardRun | null | undefined, view: AIResultV2 | null): boolean {
  const sw = view?.suggested_weights;
  if (!run || !view || !sw) return false;
  if (run.validation?.ok !== true || view.primary_decision.action === 'insufficient_evidence') return false;
  const values = [sw.deesc, sw.base, sw.stag];
  return values.every((n) => Number.isFinite(n) && n >= 0 && n <= 100) && Math.abs(values[0] + values[1] + values[2] - 100) <= 0.01;
}

const actionColor = (action: string) => (action === 'buy' ? 'var(--up)' : action === 'hold' || action === 'wait' ? 'var(--text)' : 'var(--down)');
const levelColor = (level: string) => (level === 'high' ? 'var(--up)' : level === 'medium' ? 'var(--text)' : 'var(--down)');
const pill = { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)' } as const;

function formatTime(iso: string | null | undefined, ar: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Subtitle line: "Updated {t} · next update {t} · {provider}". The next-update part is dropped when the schedule is off. */
export function standardSubtitle({ ar, updated, next, provider, enabled }: { ar: boolean; updated: string | null; next: string | null; provider: string | null; enabled: boolean | undefined }): string {
  const s = ar ? S.ar : S.en;
  return [
    updated ? `${s.updated} ${updated}` : null,
    next && enabled !== false ? `${s.next} ${next}` : null,
    provider || null,
  ].filter(Boolean).join(' · ');
}

export function StandardAnalysisCard({
  ar,
  run,
  schedule,
  nextAt,
  running,
  onApplyWeights,
  currentWeights,
  loading = false,
  failed = false,
}: {
  ar: boolean;
  run: StandardRun | null;
  schedule: AnalysisSchedule | null;
  nextAt: string | null;
  running: boolean;
  onApplyWeights: (weights: Weights) => void;
  currentWeights?: Weights;
  loading?: boolean;
  failed?: boolean;
}) {
  const s = ar ? S.ar : S.en;
  const view = useMemo(() => parseStandardRun(run), [run?.id, run?.text]);
  const [appliedRunId, setAppliedRunId] = useState<number | null>(null);

  const nextLabel = formatTime(nextAt, ar);
  const updatedLabel = view && run ? formatTime(run.created_at, ar) : null;
  const evidence = view?.compact_result?.evidence ?? [];
  const sourceFor = (id: string) => run?.evidence_sources.find((x) => x.id === id);
  const canApply = canApplyWeights(run, view);
  const applied = !!run && appliedRunId === run.id;

  const subtitle = view && run
    ? standardSubtitle({ ar, updated: updatedLabel, next: nextLabel, provider: run.provider_label, enabled: schedule?.enabled })
    : '';
  const offAboveRun = !!view && schedule?.enabled === false;

  const runningLine = running ? (
    <div role="status" aria-live="polite" className="soft-text" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 8 }}>
      <span className="live-dot" aria-hidden="true" />
      {s.updating}
    </div>
  ) : null;

  let body;
  if (view && run) {
    const pd = view.primary_decision;
    const sw = view.suggested_weights;
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="font-mono" style={{ ...pill, color: actionColor(pd.action) }}>{s.action[pd.action]}</span>
            <span className="font-mono" style={{ ...pill, color: levelColor(pd.confidence) }}>{s.confidence}: {s.level[pd.confidence]}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.6, overflowWrap: 'anywhere' }} dir="auto">{pd.headline}</div>
        </div>
        {evidence.length ? (
          <div>
            <div className="section-label gold-text" style={{ marginBottom: 6 }}>{s.evidenceH}</div>
            {evidence.map((e) => {
              const src = sourceFor(e.evidence_id);
              const safeLink = src && /^https?:\/\//.test(src.link) ? src.link : null;
              return (
                <div key={e.evidence_id} className="soft-text" style={{ fontSize: 14, lineHeight: 1.8, overflowWrap: 'anywhere' }} dir="auto">
                  • {e.implication}{' '}
                  {safeLink ? (
                    <a className="font-mono" style={{ fontSize: 12 }} href={safeLink} target="_blank" rel="noopener noreferrer" title={src?.title} aria-label={src?.title ? `${e.evidence_id}: ${src.title}` : e.evidence_id}>[{e.evidence_id}]</a>
                  ) : (
                    <span className="muted-text font-mono" style={{ fontSize: 12 }} title={src?.title}>[{e.evidence_id}]</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
        {view.assumptions.length ? (
          <div>
            <div className="section-label gold-text" style={{ marginBottom: 6 }}>{s.assumptionsH}</div>
            {view.assumptions.map((item) => <div key={item} className="soft-text" style={{ fontSize: 14, lineHeight: 1.8, overflowWrap: 'anywhere' }} dir="auto">• {item}</div>)}
          </div>
        ) : null}
        <div>
          <div className="section-label gold-text" style={{ marginBottom: 6 }}>{s.weightsH}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {SCEN_KEYS.map((key) => (
              <div key={key} style={{ flex: 1, minWidth: 0, background: 'var(--elevated)', border: '1px solid var(--border)', padding: 10, textAlign: 'center', borderRadius: 8 }}>
                <div className="muted-text" style={{ fontSize: 12 }}>{s.scen[key]}</div>
                <div className="font-mono" style={{ fontSize: 16, marginTop: 4 }}>
                  {currentWeights ? <>{currentWeights[key]}% → </> : null}
                  <span className="gold-text" style={{ fontWeight: 700 }}>{sw[key]}%</span>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-outline"
            style={{ padding: '6px 14px', fontSize: 14 }}
            disabled={!canApply}
            onClick={() => {
              if (!canApply) return;
              onApplyWeights({ deesc: sw.deesc, base: sw.base, stag: sw.stag });
              setAppliedRunId(run.id);
            }}
          >
            {applied ? s.applied : s.apply}
          </button>
          {!canApply ? <div className="down-text" style={{ fontSize: 12, marginTop: 4 }}>{s.applyDisabled}</div> : null}
        </div>
        <div className="muted-text" style={{ fontSize: 13, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>{s.notPersonal}</div>
      </div>
    );
  } else if (loading) {
    body = <div className="muted-text" style={{ fontSize: 15 }}>{s.loading}</div>;
  } else if (running) {
    body = null;
  } else if (failed) {
    body = <div className="down-text" style={{ fontSize: 14 }}>{s.failed}</div>;
  } else if (schedule?.enabled) {
    body = <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.7 }}>{nextLabel ? `${s.noneYet} ${nextLabel}${ar ? '.' : ''}` : s.noneYetPlain}</div>;
  } else {
    body = <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.7 }}>{s.off}</div>;
  }

  return (
    <section aria-label={s.title}>
      <SectionLabel text={ar ? s.title : s.title.toUpperCase()} />
      <Card>
        {subtitle ? <div className="muted-text font-mono" style={{ fontSize: 12, marginBottom: 10, overflowWrap: 'anywhere' }}>{subtitle}</div> : null}
        {offAboveRun ? <div className="soft-text" style={{ fontSize: 14, marginBottom: 10 }}>{s.off}</div> : null}
        {runningLine}
        {body}
      </Card>
    </section>
  );
}
