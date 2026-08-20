import type { ComponentChildren, JSX } from 'preact';

// ─── SVG Icons (1.5px stroke) ─────────────────────────────────────────────────
const ICON_PATHS: Record<string, ComponentChildren> = {
  home: <><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" /><path d="M9 21V12h6v9" /></>,
  calculator: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h2M12 10h2M16 10h0M8 14h2M12 14h2M16 14h0M8 18h2M12 18h4" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2" /></>,
  scenarios: <><path d="M4 6h16M4 12h10M4 18h6" /><path d="M18 9l3 3-3 3" /></>,
  egypt: <><path d="M12 3L22 20H2L12 3z" /><path d="M12 9v5M12 16v.5" /></>,
  analyst: <><path d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" /><path d="M9 10c0-1.1.9-2 2-2M9 14h4" /></>,
  dca: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /><path d="M9 14l2 2 4-4" /></>,
  watchlist: <><path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>,
  wallet: <><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" /><path d="M16 3.13a4 4 0 010 7.75" /><circle cx="17" cy="13" r="1" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></>,
  sun: <><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></>,
  moon: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
  'arrow-up': <path d="M18 15l-6-6-6 6" />,
  'arrow-dn': <path d="M6 9l6 6 6-6" />,
  refresh: <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 18l6-6-6-6" />,
  bell: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  trending: <path d="M23 6l-9.5 9.5-5-5L1 18" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></>,
  x: <path d="M18 6L6 18M6 6l12 12" />,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

// ─── Sparkline ─────────────────────────────────────────────────────────────────
export function Spark({ data, w = 72, h = 28, up = true }: { data: number[]; w?: number; h?: number; up?: boolean }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`).join(' ');
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────────────
export function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtK(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : fmt(n);
}

export function ChangeTag({ chg, pct }: { chg: number; pct: number }) {
  const up = chg >= 0;
  return (
    <span className={up ? 'tag-up' : 'tag-down'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon name={up ? 'arrow-up' : 'arrow-dn'} size={10} />
      {up ? '+' : ''}
      {fmt(Math.abs(pct), 2)}%
    </span>
  );
}

export function Card({
  children,
  style,
  className = '',
}: {
  children: ComponentChildren;
  style?: JSX.CSSProperties;
  className?: string;
}) {
  return (
    <div className={`instrument-card ${className}`} style={{ padding: '18px', ...style }}>
      {children}
    </div>
  );
}

export function SectionLabel({ text }: { text: string }) {
  return (
    <div className="section-label" style={{ marginBottom: 10 }}>
      {text}
    </div>
  );
}

export function Hairline() {
  return <div className="hairline" style={{ margin: '14px 0' }} />;
}

export function MetricRow({
  label,
  value,
  mono = true,
  gold = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  gold?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
      <span className="soft-text" style={{ fontSize: 18 }}>
        {label}
      </span>
      <span className={mono ? 'font-mono' : ''} style={{ fontSize: 19, fontWeight: 600, color: gold ? 'var(--gold)' : 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

export function GlowBar({ pct, color, label }: { pct: number; color: string; label?: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ height: 6, background: 'var(--border-solid)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            borderRadius: 3,
            boxShadow: `0 0 8px ${color}66`,
            transition: 'width 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          }}
        />
      </div>
      {label && (
        <span className="font-mono" style={{ fontSize: 14, color: 'var(--text-muted)', position: 'absolute', right: 0, top: -16 }}>
          {label}
        </span>
      )}
    </div>
  );
}
