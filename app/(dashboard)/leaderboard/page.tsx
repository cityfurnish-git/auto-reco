"use client";

import { useMemo, useState } from "react";
import { statFigure } from "@/lib/ui/stat-captions";
import { ErrorState } from "@/components/error-state";
import { useLeaderboard, type WindowKey } from "@/lib/hooks/use-leaderboard";
import { Icon, type IconName } from "@/components/icon";
import { clampPct } from "@/lib/stats/accuracy";
import { MIN_MOVEMENTS } from "@/lib/ui/stat-captions";
import { Ring, Sparkline } from "@/components/kit/charts";
import { PageHeader, Pills } from "@/components/kit/layout";

const TREND_ICON: Record<string, { icon: IconName; cls: string }> = {
  up: { icon: "trending_up", cls: "text-success" },
  down: { icon: "trending_down", cls: "text-danger" },
  flat: { icon: "trending_flat", cls: "text-text-muted" },
};

// Below MIN_MOVEMENTS a percentage says more about the sample than the
// warehouse: 3 movements and 0 variances is 100%, and it was taking the trophy
// off cities running thousands of movements at 96%. The API's ranking is left
// alone — re-ordering it here would put a rank number next to a row that isn't
// in that position — but the medal goes to the best city that actually cleared
// the bar, and thin rows say so.
//
// IMPORTED, not retyped. It was declared here AND in lib/ui/stat-captions.ts,
// which is where the dashboard's "too few to compare" line reads it from — two
// copies of one threshold, so a change to either would have silently given the
// two pages different ideas of a thin sample.

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "latest", label: "Latest" },
  { key: "last7", label: "7 Days" },
  { key: "last30", label: "30 Days" },
  { key: "overall", label: "Overall" },
];

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export default function LeaderboardPage() {
  const { data, loading, error, refetch } = useLeaderboard();
  const [windowKey, setWindowKey] = useState<WindowKey>("latest");

  const win = data?.windows?.[windowKey] ?? null;
  const rows = useMemo(() => win?.cities ?? [], [win]);

  const totalMovements = rows.reduce((s, r) => s + r.movements, 0);
  const totalReal = rows.reduce((s, r) => s + r.real, 0);
  const avgAccuracy =
    totalMovements > 0
      ? Math.round(Math.max(0, (1 - totalReal / totalMovements) * 100) * 10) / 10
      : null;
  const topWithData = rows.find((r) => r.accuracy !== null) ?? null;

  function exportCsv() {
    const header = "Rank,City,Traced %,Units moved,Not accounted for,Urgent,vs last period\n";
    const body = rows
      .map((r) =>
        [r.rank, r.city, r.accuracy ?? "", r.movements, r.real, r.high, r.trend].join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `city_leaderboard_${windowKey}_${data?.latestDate ?? "latest"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isEmpty = !loading && (data?.empty || rows.length === 0);

  // The city the trophy actually belongs to: best-ranked with a real sample.
  const medalCity = useMemo(
    () => rows.find((r) => r.accuracy !== null && r.movements >= MIN_MOVEMENTS)?.city ?? null,
    [rows]
  );
  const thinRows = rows.filter(
    (r) => r.accuracy !== null && r.movements < MIN_MOVEMENTS
  ).length;

  return (
    <div className="p-container-margin space-y-6">
      <PageHeader
        icon="leaderboard"
        title="City Leaderboard"
        subtitle={
          <>
            Which city traces the most of what it moves. Score = units traced end to end ÷ units moved. Days a warehouse was shut are left out.
            {win?.to ? ` ${win.label} (through ${win.to}).` : ""}
          </>
        }
        right={
          <>
            <Pills options={WINDOWS} value={windowKey} onChange={setWindowKey} />
            <button onClick={exportCsv} disabled={rows.length === 0} className="btn btn-primary disabled:opacity-50">
              <Icon name="download" size={18} />
              Export CSV
            </button>
          </>
        }
      />

      {error && <ErrorState what="the scoreboard" detail={error} onRetry={refetch} />}

      {/* KPI Row */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-gutter">
        <div className="soft-card p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="kpi-label">Cleanest city</span>
            <Icon name="workspace_premium" size={22} className="text-[#b9aa83]" />
          </div>
          <div className="mt-4">
            <h3 className="text-xl font-bold text-text-primary">
              {topWithData?.city ?? "—"}
            </h3>
            <div className="flex items-center gap-2 text-xs font-semibold text-success">
              <Icon name="verified" size={14} />
              {pct(topWithData?.accuracy ?? null)} Accuracy
            </div>
          </div>
        </div>

        <div className="soft-card p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="kpi-label">Units moved</span>
            <Icon name="inventory_2" size={22} className="text-accent" />
          </div>
          <div className="mt-4">
            <h3 className="kpi-value">{statFigure(loading, error, totalMovements)}</h3>
            <p className="text-xs text-text-muted">In and out, all cities, working days only</p>
          </div>
        </div>

        <div className="soft-card p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="kpi-label">Not accounted for</span>
            <Icon name="report" size={22} className="text-danger" />
          </div>
          <div className="mt-4">
            <h3 className="kpi-value text-danger">{statFigure(loading, error, totalReal)}</h3>
            {/* clampPct, like every other percentage in the app. This one was
                printing the raw quotient — 1.7218543046357615% — beside a tile
                that rounds the same ratio to one decimal. */}
            <p className="text-xs text-text-muted">
              {error
                ? "Figures unavailable"
                : `${pct(totalMovements ? clampPct((totalReal / totalMovements) * 100) : null)} of the ${totalMovements.toLocaleString()} units moved`}
            </p>
          </div>
        </div>

        <div className="soft-card p-5 flex items-center gap-4">
          <Ring pct={avgAccuracy} label={pct(avgAccuracy)} size={76} stroke={7} title="Traced end to end, all cities" />
          <div>
            <span className="kpi-label">Traced end to end</span>
            <p className="text-xs text-text-muted mt-1">Weighted by units moved — not an average of the city scores</p>
          </div>
        </div>
      </section>

      {/* The ranking at a glance — one card per city, in rank order, with the
          last 14 days underneath (23 Oct 2026). The table below keeps every
          exact figure; this is the picture of it. */}
      {!isEmpty && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {rows.map((r) => {
            const thin = r.accuracy !== null && r.movements < MIN_MOVEMENTS;
            const trend = TREND_ICON[r.trend];
            const daily = data?.daily?.[r.city];
            return (
              <div key={r.city} className={`soft-card p-5 flex flex-col items-center text-center gap-3 ${r.city === medalCity ? "ring-2 ring-[#d9c98f]" : ""}`}>
                <div className="flex items-center justify-between w-full">
                  {r.city === medalCity ? (
                    <Icon name="workspace_premium" size={22} className="text-[#b9aa83]" />
                  ) : (
                    <span className="text-sm font-semibold text-text-muted">#{r.rank}</span>
                  )}
                  <Icon name={trend.icon} size={18} className={trend.cls} />
                </div>
                <Ring
                  pct={thin ? null : r.accuracy}
                  label={r.accuracy === null ? "—" : `${Math.floor(r.accuracy)}%`}
                  size={92}
                  stroke={8}
                  title={thin ? "Low sample — not scored" : r.accuracy === null ? "No movements" : `${r.accuracy}% traced`}
                />
                <div>
                  <div className="font-headline text-lg text-text-primary">{r.city.charAt(0) + r.city.slice(1).toLowerCase()}</div>
                  <div className="text-xs text-text-muted">
                    {r.movements.toLocaleString("en-IN")} moved · <span className={r.real > 0 ? "text-danger font-semibold" : ""}>{r.real} not traced</span>
                  </div>
                  {thin && <span className="badge badge-suppressed mt-1">Low sample</span>}
                </div>
                <div className="w-full pt-3 border-t border-border/60 flex flex-col items-center gap-1">
                  {daily ? (
                    <Sparkline
                      points={daily.map((p) => ({ label: p.date, value: p.accuracy }))}
                      width={150}
                      height={30}
                      format={(v) => `${v}% traced`}
                      ariaLabel={`${r.city}, traced rate over the last 14 days`}
                    />
                  ) : (
                    <span className="text-[11px] text-text-disabled">—</span>
                  )}
                  <span className="text-[11px] text-text-muted">last 14 days</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Ranking Table */}
      <section className="card overflow-hidden flex flex-col">
        {isEmpty ? (
          <div className="p-12 text-center text-text-muted">
            <Icon name="leaderboard" size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {loading
                ? "Loading…"
                : error
                  ? "The scoreboard could not be read — see above."
                  : "No stock checks have run yet — run one to fill the scoreboard."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: card list (below md) */}
            <div className="md:hidden divide-y divide-border">
              {rows.map((r) => {
                const trend = TREND_ICON[r.trend];
                return (
                  <div key={r.city} className={`p-4 ${r.city === medalCity ? "row-gold" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.city === medalCity ? (
                          <Icon name="workspace_premium" size={20} className="text-[#b9aa83] shrink-0" />
                        ) : (
                          <span className="font-headline text-base text-text-muted shrink-0">#{r.rank}</span>
                        )}
                        <span className="font-headline text-base text-text-primary truncate">{r.city}</span>
                        <Icon name={trend.icon} size={18} className={`shrink-0 ${trend.cls}`} />
                      </div>
                      <span className="font-bold text-text-primary shrink-0 tabular-nums">
                        {pct(r.accuracy)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted mt-2">
                      <span className="tabular-nums">{r.movements.toLocaleString()} moves</span>
                      <span className={r.real > 0 ? "text-danger font-semibold" : ""}>{r.real} not traced</span>
                      <span>{r.high} urgent</span>
                      {r.accuracy !== null && r.movements < MIN_MOVEMENTS && (
                        <span className="badge badge-suppressed">Low sample</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tablet/desktop: full table (md+) */}
            <div className="overflow-x-auto hidden md:block">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th className="w-20 text-center">Rank</th>
                    <th>City</th>
                    <th className="text-right">Traced %</th>
                    <th className="text-right">Units moved</th>
                    <th className="text-right">Not accounted for</th>
                    <th className="text-center">Urgent</th>
                    <th className="text-center">vs last period</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const trend = TREND_ICON[r.trend];
                    const noData = r.accuracy === null;
                    const thin = !noData && r.movements < MIN_MOVEMENTS;
                    return (
                      <tr key={r.city} className={r.city === medalCity ? "row-gold" : ""}>
                        <td className="text-center">
                          {r.city === medalCity ? (
                            <Icon name="workspace_premium" size={22} className="text-[#b9aa83] inline-block" />
                          ) : (
                            <span className="font-headline text-base text-text-muted">{r.rank}</span>
                          )}
                        </td>
                        <td>
                          <span className="font-headline text-base text-text-primary">{r.city}</span>
                          {noData && (
                            <span className="ml-2 text-xs text-text-muted">(no movements)</span>
                          )}
                          {thin && (
                            <span
                              className="badge badge-suppressed ml-2"
                              title={`Under ${MIN_MOVEMENTS} movements — this percentage is not comparable with a full warehouse`}
                            >
                              Low sample
                            </span>
                          )}
                        </td>
                        <td
                          className={`text-right font-bold tabular-nums ${
                            thin ? "text-text-muted" : "text-text-primary"
                          }`}
                        >
                          {pct(r.accuracy)}
                        </td>
                        <td className="text-right tabular-nums">{r.movements.toLocaleString()}</td>
                        <td className="text-right tabular-nums">{r.real}</td>
                        <td className="text-center">
                          <span className={r.high > 0 ? "badge badge-high" : "badge badge-done"}>{r.high}</span>
                        </td>
                        <td className="text-center">
                          <Icon name={trend.icon} size={20} className={`inline-block ${trend.cls}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="px-6 py-3 bg-surface-elevated border-t border-border flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-text-muted">
            {win ? `${win.label} • ranked by the share of units traced end to end` : "—"}
          </span>
          {thinRows > 0 && (
            <span className="text-xs text-text-muted">
              · {thinRows} cit{thinRows === 1 ? "y" : "ies"} under {MIN_MOVEMENTS} movements are
              marked low sample and can&rsquo;t take the medal — a near-perfect score on a
              handful of moves says more about the sample than the warehouse.
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
