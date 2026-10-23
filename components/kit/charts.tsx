// Small charts shared by every page (23 Oct 2026, the owner's "more graphical"
// pass). Three forms, each for one job, all single-series so no categorical
// palette is needed:
//
//   Ring       one headline percentage against a status band
//   Sparkline  one measure over the last days — the shape, not the values
//   BarList    magnitudes of a handful of named things, sorted
//
// Status colours (good / warning / critical) only ever appear with the number
// beside them, never alone. Every mark carries a native tooltip; the numbers a
// person needs are also printed, so nothing is hover-only.
//
// No "use client": pure SVG/markup, safe in server components too.

import type { ReactNode } from "react";

/**
 * The traced-rate bands: green from 95%, amber from 90%, red below. The ONE
 * definition — analytics' bars read it too. A first cut of the rings used
 * 98/95 while the analytics bars used 95/90, so Pune at 97.7% was green on
 * one page and amber on the next (23 Oct 2026).
 */
export function statusTone(pct: number | null, none = "var(--border-color)"): string {
  if (pct === null) return none;
  if (pct >= 95) return "var(--color-success-fg)";
  if (pct >= 90) return "var(--color-warning-fg)";
  return "var(--color-error-fg)";
}

export function Ring({ pct, label, size = 56, stroke = 5, title }: {
  /** 0–100, or null when not judged (shut day, too few movements). */
  pct: number | null;
  /** What sits in the middle — usually the rounded percentage. */
  label: string;
  size?: number;
  stroke?: number;
  title?: string;
}) {
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const len = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={title ?? label}>
      {title && <title>{title}</title>}
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-elevated)" strokeWidth={stroke} />
      {pct !== null && (
        <circle
          cx={c} cy={c} r={r} fill="none" stroke={statusTone(pct)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(len * Math.max(0, Math.min(100, pct))) / 100} ${len}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      )}
      <text x={c} y={c + size * 0.07} textAnchor="middle" fontSize={size * 0.2} fontWeight="700" fill="var(--text-primary)">
        {label}
      </text>
    </svg>
  );
}

export interface SparkPoint {
  label: string;
  /** null = no reading that day; drawn as a gap, never as zero. */
  value: number | null;
}

/**
 * The last N days as a 2px line in the accent, the newest point marked. The
 * y-range is fitted to the data (with a floor of 4 points of spread) because
 * the story is the movement between days, and a 0–100 axis would flatten
 * 96%→99% into a straight line.
 */
export function Sparkline({ points, width = 120, height = 32, format = (v) => `${v}`, ariaLabel }: {
  points: SparkPoint[];
  width?: number;
  height?: number;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) {
    return <span className="text-[11px] text-text-disabled" style={{ width, display: "inline-block" }}>not enough days</span>;
  }
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 4) {
    const mid = (hi + lo) / 2;
    lo = mid - 2;
    hi = mid + 2;
  }
  const pad = 4;
  const step = (width - pad * 2) / Math.max(1, points.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - lo) / (hi - lo));
  // Break the path at missing days rather than bridging them.
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${(pad + i * step).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  const lastIdx = points.map((p) => p.value !== null).lastIndexOf(true);
  const last = points[lastIdx];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="overflow-visible">
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) =>
        p.value === null ? null : (
          // Hit target wider than the mark, so the tooltip is easy to find.
          <g key={i}>
            <rect x={pad + i * step - step / 2} y={0} width={step} height={height} fill="transparent">
              <title>{`${p.label}: ${format(p.value)}`}</title>
            </rect>
          </g>
        )
      )}
      {last?.value != null && (
        <circle
          cx={pad + lastIdx * step} cy={y(last.value)} r="3.5"
          fill="var(--color-accent)" stroke="var(--surface-card)" strokeWidth="2"
        />
      )}
    </svg>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Shown at the row's end instead of the raw value, e.g. "12 / 40". */
  display?: string;
  onClick?: () => void;
}

/**
 * Horizontal bars, longest first, one hue. Labels sit above each bar rather
 * than on a y-axis so long plain-language names never truncate.
 */
export function BarList({ items, max, empty = "Nothing to show." }: {
  items: BarItem[];
  max?: number;
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-text-muted">{empty}</p>;
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const pct = Math.max(2, (it.value / top) * 100);
        const row = (
          <>
            <span className="flex items-start justify-between gap-3 text-sm">
              {/* Two lines before cutting: plain-language names run long, and
                  "No Guard scan — the other three agr…" hid the half that
                  says what it means. */}
              <span className="text-text-primary min-w-0 line-clamp-2 leading-snug">{it.label}</span>
              <span className="text-xs text-text-muted tabular-nums shrink-0">{it.display ?? it.value.toLocaleString("en-IN")}</span>
            </span>
            <span className="block h-2 mt-1.5 rounded-full bg-surface-elevated overflow-hidden">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
          </>
        );
        return (
          <li key={it.key}>
            {it.onClick ? (
              <button type="button" onClick={it.onClick} className="w-full text-left rounded-lg hover:bg-accent-soft/60 -mx-1 px-1 py-0.5">
                {row}
              </button>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
