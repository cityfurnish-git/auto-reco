"use client";

// The admin board's overview band — greeting, the three ways in, the week, and
// the boxes that say what needs a person today.
//
// Owner, 23 Oct 2026, from a reference board: soft rounded cards, a greeting
// that leads with the day's one number, round progress per city, a week strip
// for the date, a notifications box and per-team progress bars. Mapped onto
// what Auto-Reco already knows; nothing here is a new figure. Every number is
// read from /api/stats/summary and goes through statFigure, so an unread value
// prints an em dash, never a confident zero.

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import { BarList, Ring, Sparkline, type SparkPoint } from "@/components/kit/charts";
import { BoxCard } from "@/components/kit/layout";
import { CITIES, type City } from "@/lib/sample-data";
import { addDays } from "@/lib/engine/dates";
import { floorRowsOf, isCityClosed } from "@/lib/engine/schedule";
import { accuracyOf } from "@/lib/stats/accuracy";
import { MIN_MOVEMENTS, statFigure } from "@/lib/ui/stat-captions";
import { responsibleLabel } from "@/lib/ui/variance-format";
import { shortNotice } from "@/lib/ui/short-notice";
import type { CityAgg, StatsResponse } from "@/lib/hooks/use-dashboard-data";

/* ── greeting + the three ways in ─────────────────────────────────────────── */

export function OverviewHero({ name, agg, businessDate, loading, error, onOpenChase, scope = "admin", dates }: {
  name: string;
  /** The week strip, under the greeting so the column's foot lines up with
   *  the cards' foot (owner, 23 Oct 2026). */
  dates?: ReactNode;
  /** Admin sees all five cities and the stock check; a manager sees their own
   *  warehouse, and the pending list in its place (stock check is admin-only). */
  scope?: "admin" | { city: string };
  agg: CityAgg | null;
  businessDate: string | undefined;
  loading: boolean;
  error: string | null;
  onOpenChase: () => void;
}) {
  const first = name.split(/[\s@.]/)[0] || name;
  const fig = (v: number | undefined) => statFigure(loading, error, v);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_2fr] gap-5 items-stretch">
      <div className="flex flex-col justify-between gap-5 min-w-0">
        <div>
          <h1 className="font-headline text-3xl md:text-4xl text-text-primary leading-tight">
            Hi, {first}!
            <br />
            <span className="text-text-secondary">Here is {businessDate ? dayName(businessDate) : "the latest day"}.</span>
          </h1>
          <p className="text-sm text-text-muted mt-3 max-w-md">
            {fig(agg?.movements)} units moved · <b className="text-text-primary">{fig(agg?.openReal)}</b> still to
            chase {scope === "admin" ? "across all five cities" : `in ${titleCase(scope.city)}`}.
          </p>
        </div>
        {dates}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <WayIn
          onClick={onOpenChase}
          icon="pending_actions"
          title="Chase list"
          figure={fig(agg?.openReal)}
          caption="Units the books disagree about, still open"
        />
        {scope === "admin" ? (
          <WayIn
            href="/stock-analyser"
            icon="fact_check"
            title="Stock check"
            figure={fig(agg?.movements)}
            caption="Every unit that moved, book by book"
          />
        ) : (
          <WayIn
            href="/pending-list"
            icon="history"
            title="Pending list"
            figure={fig(agg?.pendingListReal)}
            caption="Parked items waiting on someone else"
          />
        )}
        <WayIn
          href="/gate"
          icon="scan"
          title="Gate"
          figure={agg?.anchored.gateReported ? fig(agg.anchored.gateSaw) : "—"}
          caption={agg && !agg.anchored.gateReported && !loading ? "No gate book for this day" : "Units the guards saw cross"}
        />
      </div>
    </div>
  );
}

function WayIn({ href, onClick, icon, title, figure, caption }: {
  href?: string;
  onClick?: () => void;
  icon: IconName;
  title: string;
  figure: string;
  caption: string;
}) {
  const body = (
    <>
      <span className="w-11 h-11 rounded-2xl bg-accent-soft text-accent grid place-items-center">
        <Icon name={icon} size={22} />
      </span>
      <span className="font-headline text-3xl text-text-primary mt-4">{figure}</span>
      <span className="font-semibold text-sm text-text-primary mt-1">{title}</span>
      <span className="text-xs text-text-muted">{caption}</span>
    </>
  );
  const cls = "soft-card soft-card-hover p-5 flex flex-col items-start text-left w-full h-full";
  return href ? (
    <Link href={href} className={cls}>{body}</Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>{body}</button>
  );
}

/* ── the week ─────────────────────────────────────────────────────────────── */

/**
 * Seven days ending on the day in view. A day is marked shut only when every
 * city's calendar says so — the board covers all five, and one city's holiday
 * is not the board's. Per-city closures stay on the city rings below.
 */
export function WeekStrip({ anchor, selected, latest, calendar, onPick }: {
  anchor: string;
  selected: string;
  latest: string | undefined;
  calendar: StatsResponse["calendar"];
  onPick: (date: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i - 6));
  const canForward = !!latest && anchor < latest;
  // Any other date: the browser's own picker, opened from a calendar button
  // at the strip's end, so the strip needs no separate date box beside it.
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="soft-card px-2 py-1.5 inline-flex items-center gap-0.5 w-fit max-w-full">
      <StripArrow dir="left" onClick={() => onPick(addDays(anchor, -7))} />
      {days.map((d) => {
        const shut = CITIES.every((c) => isCityClosed(c as City, d, calendar));
        const future = !!latest && d > latest;
        const active = d === selected;
        return (
          <button
            key={d}
            type="button"
            disabled={future}
            onClick={() => onPick(d === latest ? "" : d)}
            title={shut ? `${d} — every warehouse shut` : d}
            className={`w-10 py-1.5 rounded-xl flex flex-col items-center text-[11px] leading-tight transition-colors ${
              active
                ? "bg-accent text-on-accent font-semibold"
                : future
                  ? "text-text-disabled cursor-not-allowed"
                  : "text-text-secondary hover:bg-accent-soft"
            }`}
          >
            <span className="opacity-70">{weekday(d)}</span>
            <span className="text-sm font-semibold">{Number(d.slice(8, 10))}</span>
            <span className={`h-1 w-1 rounded-full mt-0.5 ${shut ? (active ? "bg-on-accent" : "bg-text-disabled") : "bg-transparent"}`} />
          </button>
        );
      })}
      <StripArrow dir="right" disabled={!canForward} onClick={() => onPick(addDays(anchor, 7) >= (latest ?? "") ? "" : addDays(anchor, 7))} />
      <span className="w-px h-8 bg-border mx-1" aria-hidden />
      <span className="relative">
        <button
          type="button"
          onClick={() => picker.current?.showPicker?.()}
          aria-label="Pick any date"
          title="Pick any date"
          className="w-9 h-9 rounded-full grid place-items-center text-accent hover:bg-accent-soft"
        >
          <Icon name="calendar_today" size={17} />
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          max={latest}
          value={selected}
          onChange={(e) => e.target.value && onPick(e.target.value === latest ? "" : e.target.value)}
          className="absolute inset-0 opacity-0 pointer-events-none"
        />
      </span>
    </div>
  );
}

function StripArrow({ dir, onClick, disabled }: { dir: "left" | "right"; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Previous week" : "Next week"}
      className="w-7 h-7 rounded-full grid place-items-center text-text-muted hover:bg-accent-soft disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={dir === "left" ? "chevron_left" : "chevron_right"} size={16} />
    </button>
  );
}

/* ── city rings ───────────────────────────────────────────────────────────── */

export function CityRings({ cities, businessDate, calendar, trend, onOpen }: {
  cities: CityAgg[];
  businessDate: string;
  calendar: StatsResponse["calendar"];
  /** Last 14 days' traced rate per city, from /api/leaderboard. */
  trend: Record<string, SparkPoint[]> | null;
  onOpen: (city: City) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {cities.map((c) => {
        // Read the day the way the engine does: a closure the floor worked
        // through is a working day (rule 32), so no OFF state for it.
        const off = businessDate !== "" && isCityClosed(c.city as City, businessDate, calendar, floorRowsOf(c.sources));
        const holiday = off && !!calendar?.holidays?.[c.city]?.includes(businessDate);
        const pct = off || c.movements < MIN_MOVEMENTS ? null : accuracyOf(c.movements, c.real);
        return (
          <button
            key={c.city}
            type="button"
            onClick={() => onOpen(c.city as City)}
            className="soft-card soft-card-hover p-4 flex flex-col gap-3 text-left"
          >
            <div className="flex items-center gap-4 w-full">
            <Ring
              pct={pct}
              label={off ? "OFF" : pct === null ? (c.movements ? "few" : "—") : `${Math.floor(pct)}%`}
              title={off ? "Warehouse shut" : pct === null ? "Too few movements to score" : `${pct}% of units traced`}
            />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-text-muted">
                {off ? (holiday ? "Holiday" : "Weekly off") : `${c.openReal} to chase`}
              </div>
              <div className="font-headline text-base text-text-primary">{titleCase(c.city)}</div>
              <div className="text-xs text-text-muted truncate">
                {off
                  ? "Warehouse shut — nothing expected"
                  : c.movements
                    ? `${c.real} of ${c.movements.toLocaleString("en-IN")} not traced`
                    : "No movements recorded"}
              </div>
            </div>
            </div>
            <div className="flex items-center justify-between w-full pt-2 border-t border-border/60">
              <span className="text-[11px] text-text-muted">Last 14 days</span>
              {trend?.[c.city] ? (
                <Sparkline
                  points={trend[c.city]}
                  width={110}
                  height={26}
                  format={(v) => `${v}% traced`}
                  ariaLabel={`${titleCase(c.city)}, traced rate over the last 14 days`}
                />
              ) : (
                <span className="text-[11px] text-text-disabled">—</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── notifications + team progress ────────────────────────────────────────── */

/**
 * The run's notes that need a person. The run writes many lines for the audit
 * trail ("7 units went out and came back…") which are explanations, not
 * problems; only a broken feed, a failed lookup or a book that never arrived
 * deserves the box.
 */
// "failed" alone is too broad: "17 failed dispatches … raised for tracing" is
// the run explaining a finding, already on the chase list. Only a LOOKUP or a
// feed that failed is the run itself in trouble.
const NEEDS_A_PERSON = /header|rows skipped|(lookup|lookahead|fetch|query|connector|pull) failed|timeout|timed out|no gate scans|did not report|unassigned/i;

export function NotificationsCard({ warnings }: { warnings: string[] | undefined }) {
  const items = [...new Set((warnings ?? []).filter((w) => NEEDS_A_PERSON.test(w)))].slice(0, 6);
  return (
    <BoxCard title="Notifications" icon="notifications" right={items.length ? `${items.length}` : undefined}>
      {warnings === undefined ? (
        <p className="text-sm text-text-muted">—</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing needs attention from this run.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((w) => {
            const s = shortNotice(w);
            return (
              <li key={w} className="flex gap-2.5 text-sm" title={w}>
                <span className="mt-1.5 h-2 w-2 rounded-full bg-status-warning shrink-0" />
                <span className="min-w-0">
                  {s.who && <b className="text-text-primary">{s.who}</b>}
                  {s.who && <span className="text-text-muted"> — </span>}
                  <span className="text-text-secondary">{s.what}</span>
                  {s.extra && <span className="block text-xs text-text-muted">{s.extra}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </BoxCard>
  );
}

export function ChaseByTypeCard({ byName, onPick }: {
  byName: Record<string, number> | undefined;
  onPick: (name: string) => void;
}) {
  const rows = Object.entries(byName ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 7);
  return (
    <BoxCard title="Open, by kind" icon="analytics">
      {byName === undefined ? (
        <p className="text-sm text-text-muted">—</p>
      ) : (
        <BarList
          empty="Nothing open on this day."
          items={rows.map(([name, n]) => ({ key: name, label: name, value: n, onClick: () => onPick(name) }))}
        />
      )}
    </BoxCard>
  );
}

export function TeamProgressCard({ teams }: { teams: CityAgg["teams"] }) {
  const rows = Object.entries(teams ?? {}).sort((a, b) => b[1].total - a[1].total);
  return (
    <BoxCard title="By team" icon="group" right="done / raised">
      {teams === undefined ? (
        <p className="text-sm text-text-muted">—</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing was raised on this day.</p>
      ) : (
        <ul className="space-y-3.5">
          {rows.map(([slug, t]) => {
            const pct = t.total ? Math.round((t.closed / t.total) * 100) : 0;
            return (
              <li key={slug} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 items-center">
                <span className="text-sm font-semibold text-text-primary">{responsibleLabel(slug)}</span>
                <span className="text-xs text-text-muted tabular-nums">{t.closed} / {t.total}</span>
                <span className="col-span-2 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </BoxCard>
  );
}

/* ── small helpers ────────────────────────────────────────────────────────── */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Dates here are IST calendar strings (YYYY-MM-DD); read them at noon UTC so
// no timezone can push them onto the neighbouring day.
const at = (d: string) => new Date(`${d}T12:00:00Z`);
const weekday = (d: string) => WEEKDAY[at(d).getUTCDay()];
const dayName = (d: string) => `${weekday(d)}, ${Number(d.slice(8, 10))} ${MONTH[at(d).getUTCMonth()]}`;
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
