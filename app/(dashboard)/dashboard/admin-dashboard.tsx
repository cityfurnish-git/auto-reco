"use client";

// Admin dashboard — real reconciliation data from the RLS-scoped API routes
// (/api/stats/summary + /api/variances). Columns match the DB variances table:
// Date, City, Item Name, Barcode, Ticket ID, Source, Ops Type, SO Number,
// Variance, Priority, Status. Defaults to the REAL + open "chase list".

import SourceTruthCards from "./source-truth-cards";
import { DashSection, DayStatus } from "./dashboard-sections";
import { sourceLabel } from "@/lib/ui/source-names";
import { VarianceName } from "@/components/variance-name";
import { VarianceFlags } from "@/components/variance-flags";
import InTransitSection from "./in-transit-section";
import { ChaseByTypeCard, CityRings, NotificationsCard, OverviewHero, TeamProgressCard, WeekStrip } from "./admin-overview";
import { useCityTrend } from "@/lib/hooks/use-city-trend";
import SourceScoreboard from "./source-scoreboard";
import CountOnlyCard from "./count-only-card";
import { VARIANCE } from "@/lib/engine/variance-names";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SessionUser } from "@/lib/demo-auth";
import { CITIES, type City } from "@/lib/sample-data";
import type {
  Bucket,
  VarianceDB,
  VarianceSource,
  VarianceStatus,
} from "@/lib/db/schema";
import { SourceBadge } from "@/components/source-badge";
import { Icon } from "@/components/icon";
import { errText, useToast } from "@/components/toast";
import CloseVarianceModal from "./close-variance-modal";
import VarianceDetailModal from "./variance-detail-modal";
import VarianceListModal, { type ListModalRequest } from "./variance-list-modal";
import { floorRowsOf, isCityClosed } from "@/lib/engine/schedule";
import { addDays } from "@/lib/engine/dates";
import { utcToIstDate } from "@/lib/connectors/ist-window";
// closedCaption / queueCaption went with the KPI tiles — the one-line strip has
// no room for a sentence under each figure. Still used by the manager dashboard.
import { cityRateLine, rateCaption, statFigure } from "@/lib/ui/stat-captions";
import {
  PRIORITY_BADGE,
  STATUS_BADGE,
  STATUS_LABEL,
  ageLabel,
  formatTs,
  opsTypeLabel,
} from "@/lib/ui/variance-format";
import { downloadCsv, varianceRowsToCsv } from "@/lib/ui/variance-csv";
import { SortHeader, type SortState } from "@/components/sort-header";
import { RowCheckbox, SelectAllCheckbox } from "@/components/row-checkbox";
import { CardListSkeleton, TableBodySkeleton } from "@/components/skeleton";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { StaleRunBanner } from "./stale-run-banner";
import { useSelection } from "@/lib/hooks/use-selection";
import { useStickyState } from "@/lib/hooks/use-sticky-state";
import BulkActionBar from "./bulk-action-bar";
import {
  useStats,
  useVariances,
  useVarianceFacets,
  patchVariance,
  fetchAllVariances,
  emptyCityAgg,
  type VarianceFilters,
} from "@/lib/hooks/use-dashboard-data";
import { shownBarcode } from "@/lib/ui/barcode-display";

type CityTab = "ALL" | City;

const PAGE_SIZE = 25;

export default function AdminDashboard({ user }: { user: SessionUser }) {
  const toast = useToast();
  // Sticky alongside the date — remembering one but not the other leaves you
  // back on "ALL CITIES" for the day you picked, which reads as a bug.
  const [cityTab, setCityTab] = useStickyState<CityTab>("admin.cityTab", "ALL");
  const [bucket, setBucket] = useState<Bucket | "ALL">("REAL");
  const [source, setSource] = useState<VarianceSource | "ALL">("ALL");

  const [status, setStatus] = useState<VarianceStatus | "ALL" | "ACTIVE">("ACTIVE");
  const [varianceName, setVarianceName] = useState<string>("ALL");

  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  // Sticky: survives navigating to another page and back, so a date the
  // user deliberately picked is not silently reset to the latest run.
  const [dateF, setDateF] = useStickyState("admin.businessDate", ""); // "" = latest run
  // Span every date rather than the latest run. Set only by the approvals bell,
  // whose badge counts across all dates; cleared the moment a date is picked.
  const [allDates, setAllDates] = useState(false);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  // GROUP BY BARCODE. One unit's problems arrive as several rows — an inward,
  // an outward, sometimes a cross-check — and they are almost always closed by
  // the same explanation. Grouping sorts by barcode and lets one click select
  // the whole unit, which the existing bulk Resolve then closes together.
  const [groupBarcode, setGroupBarcode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rejecting, setRejecting] = useState<{ id: string; product: string; barcode: string } | null>(null);
  const [resolving, setResolving] = useState<{ id: string; product: string; barcode: string } | null>(null);

  // Debounce the search box; a search finds across all buckets/statuses.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // The notification bell links here with ?status=pending_approval — seed the
  // status filter from the URL so a click lands on the approval queue.
  //
  // AND CLEAR THE OTHER FILTERS, because the badge counts across all of them.
  // /api/variances/pending-count filters on status alone — every city, every
  // bucket, every date — while this page arrives holding a sticky city and date
  // from the last visit and a bucket defaulting to REAL. So the badge said 12,
  // the click landed on one city's REAL rows for one day, and the queue looked
  // like 3. The badge is the promise; this makes the page keep it.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time URL seed on mount */
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s !== "pending_approval") return;
    setStatus("pending_approval");
    setCityTab("ALL");
    setBucket("ALL");
    setDateF("");
    setAllDates(true); // the badge counts every date, so the list must show them
  }, [setCityTab, setDateF]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const {
    stats,
    loading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useStats(dateF || undefined);

  const filters: VarianceFilters = useMemo(
    () => ({
      city: cityTab,
      // While searching, span every bucket/source/priority/status/date so a
      // targeted barcode/ticket/SO lookup always surfaces the record.
      bucket: q ? "ALL" : bucket,
      source: q ? "ALL" : source,

      status: q ? "ALL" : status,
      variance: q ? "ALL" : varianceName,

      date: q || allDates ? undefined : dateF || undefined,
      // A search must find the barcode whatever night it landed on, and the
      // approvals queue must show every date the badge counted; everything else
      // stays scoped to a single run so the table agrees with the KPIs.
      allDates: !!q || allDates,
      q: q || undefined,
      sort: sort.key,
      dir: sort.dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [cityTab, bucket, source, status, varianceName, dateF, allDates, q, sort, page]
  );
  const { rows, total, totalPages, businessDate, sortDegraded, loading, error, refetch } =
    useVariances(filters);

  // Options describe THE ROWS IN VIEW, so an option that would return nothing
  // is never offered. See useVarianceFacets for the measurement behind it.
  const { varianceNames, sources } = useVarianceFacets({
    city: cityTab,
    date: dateF || undefined,
    bucket,
    status,
    source,
  });

  // Selection deliberately survives paging — picking 20 on page 1 and 15 on
  // page 2, then acting on all 35, is the workflow bulk actions exist for.
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const sel = useSelection(visibleIds);
  // barcode → the ids for it ON THIS PAGE. Paging is server-side, so a unit
  // whose rows straddle a page boundary groups within each page; sorting by
  // barcode (which the toggle does) keeps that rare.
  const barcodeGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(shownBarcode(r), [...(m.get(shownBarcode(r)) ?? []), r.id]);
    return m;
  }, [rows]);
  const lastClicked = useRef<string | null>(null);

  // Shift-click selects the run between the two clicked rows, as in a file
  // manager. Falls back to a plain toggle when the anchor has been paged away.
  function onRowCheck(id: string, shiftKey: boolean) {
    if (shiftKey && lastClicked.current && lastClicked.current !== id) {
      const a = visibleIds.indexOf(lastClicked.current);
      const b = visibleIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        sel.selectRange(visibleIds.slice(lo, hi + 1), !sel.has(id));
        lastClicked.current = id;
        return;
      }
    }
    sel.toggle(id);
    lastClicked.current = id;
  }

  // Bulk approve/reject only apply to rows actually awaiting approval — the bar
  // shows that count so "Approve 30" never means "…and silently skip 12".
  const selectedPendingApproval = useMemo(
    () => rows.filter((r) => sel.has(r.id) && r.status === "pending_approval").length,
    [rows, sel]
  );

  // A manual "Run Reconciliation" (sidebar) dispatches this event — reload the
  // KPIs and variance table in place, keeping the admin's current filters.
  useEffect(() => {
    const onDone = () => {
      refetch();
      refetchStats();
    };
    window.addEventListener("reconcile:complete", onDone);
    return () => window.removeEventListener("reconcile:complete", onDone);
  }, [refetch, refetchStats]);

  const agg = useMemo(() => {
    if (!stats) return null;
    return cityTab === "ALL"
      ? stats.overall
      : stats.byCity.find((c) => c.city === cityTab) ?? emptyCityAgg(cityTab);
  }, [stats, cityTab]);

  // The newest day a run can have judged: yesterday, IST. Bounds the week
  // strip; before the 17:00 run it may not exist yet, and the stale-run banner
  // already says so when it is picked.
  const cityTrend = useCityTrend();
  const latestDay = useMemo(() => addDays(utcToIstDate(new Date().toISOString()) ?? "", -1), []);

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
      // Touching any filter means the user is driving now, not the bell.
      setAllDates(false);
      // A filter change redefines what the user is looking at, so a selection
      // made under the old filters must not survive into a bulk action. Paging
      // deliberately does NOT clear it — see use-selection.ts.
      sel.clear();
    };
  }

  // Sorting is server-side (the table is paginated), so a new sort has to start
  // from page 1 — otherwise you land on page 4 of a completely different order.
  function applySort(next: SortState) {
    setSort(next);
    setPage(1);
  }

  // Any filter is on = the empty state is recoverable, so offer the way out.
  const filtersActive =
    cityTab !== "ALL" ||
    bucket !== "REAL" ||
    source !== "ALL" ||
    status !== "ACTIVE" ||
    varianceName !== "ALL" ||
    !!dateF ||
    !!q;

  function clearFilters() {
    setCityTab("ALL");
    setBucket("REAL");
    setSource("ALL");
    setStatus("ACTIVE");
    setVarianceName("ALL");
    setDateF("");
    setSearchInput("");
    setPage(1);
    sel.clear();
  }

  // Resolving the last row on page 8 drops the total to 7 pages and strands you
  // on a page that no longer exists — "No variances match" above "Page 8 of 7".
  /* eslint-disable react-hooks/set-state-in-effect -- clamp after a load */
  useEffect(() => {
    if (!loading && totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [loading, totalPages, page]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Drill-down from a KPI tile opens a dialog over the page — the table below
  // keeps whatever filters and search the admin already had.
  const [listRequest, setListRequest] = useState<ListModalRequest | null>(null);
  const [detail, setDetail] = useState<VarianceDB | null>(null);
  function refreshAll() {
    refetch();
    refetchStats();
  }

  // Shared by the desktop row and the mobile card. Don't hijack a click that
  // was really the end of a text selection.
  function openDetail(v: VarianceDB) {
    if (window.getSelection()?.isCollapsed === false) return;
    setDetail(v);
  }

  async function dispute(id: string) {
    setBusyId(id);
    try {
      await patchVariance(id, "dispute");
      toast.success("Flagged — escalated to the city manager.");
      refetch();
      refetchStats();
    } catch (e) {
      toast.error("Could not flag this variance.", { detail: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  // Approve a manager's submission → closes the variance (carries their reason).
  async function approve(id: string) {
    setBusyId(id);
    try {
      await patchVariance(id, "approve");
      toast.success("Approved and closed.");
      refetch();
      refetchStats();
    } catch (e) {
      toast.error("Could not approve this submission.", { detail: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  // Reject a submission → back to open with a note the manager will see.
  async function handleReject(_reason: string, note: string) {
    if (!rejecting) return;
    try {
      await patchVariance(rejecting.id, "reject", undefined, note);
      setRejecting(null);
      toast.success(`${rejecting.barcode} sent back to the manager.`);
      refetch();
      refetchStats();
    } catch (e) {
      toast.error("Could not reject this submission.", { detail: errText(e) });
    }
  }

  // Admin resolves a variance directly — closes it with a reason + comment,
  // no manager submission needed (the API's admin-only "close" action).
  async function handleResolve(reason: string, note: string) {
    if (!resolving) return;
    try {
      await patchVariance(resolving.id, "close", reason || undefined, note);
      setResolving(null);
      toast.success(`${resolving.barcode} resolved.`);
      refetch();
      refetchStats();
    } catch (e) {
      toast.error("Could not resolve this variance.", { detail: errText(e) });
    }
  }

  // Exports every row matching the current filters — not the page on screen.
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      // Pin the resolved date so every page of the export describes the same
      // run — otherwise the server re-resolves "latest" per request and a run
      // landing mid-export would splice two days together.
      const { rows: all, truncated } = await fetchAllVariances({
        ...filters,
        date: filters.date ?? businessDate ?? undefined,
      });
      downloadCsv(
        `variances_${cityTab.toLowerCase()}_${businessDate ?? "all-dates"}.csv`,
        varianceRowsToCsv(all)
      );
      if (truncated) {
        toast.info(`Exported the first ${all.length} rows.`, {
          detail: "That's the export cap — narrow by city, status or date to get the rest.",
        });
      } else {
        toast.success(`Exported ${all.length} row${all.length === 1 ? "" : "s"}.`);
      }
    } catch (e) {
      toast.error("Export failed.", { detail: errText(e) });
    } finally {
      setExporting(false);
    }
  }

  // The "(latest available)" parenthetical is gone — it is a banner now, since
  // it means every number on the page describes a different day.
  const runLabel = stats?.run
    ? `Run ${stats.run.business_date} · ${stats.run.status}`
    : "No reconciliation run yet";

  return (
    <section className="p-container-margin space-y-8">
      {stats?.usedFallbackRun && stats.run && (
        <StaleRunBanner
          showingDate={stats.run.business_date}
          requestedDate={dateF || undefined}
          onClear={dateF ? () => resetPage(setDateF)("") : undefined}
        />
      )}

      <OverviewHero
        name={user.name}
        agg={stats?.overall ?? null}
        businessDate={stats?.run?.business_date}
        loading={statsLoading}
        error={statsError}
        onOpenChase={() =>
          document.getElementById("dash-section-4")?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        dates={
          stats?.run ? (
            <WeekStrip
              anchor={dateF || stats.run.business_date}
              selected={stats.run.business_date}
              latest={latestDay}
              calendar={stats.calendar}
              onPick={(d) => resetPage(setDateF)(d)}
            />
          ) : null
        }
      />

      {/* City tabs. The date — week strip and calendar — sits under the
          greeting, not in the table toolbar below, because it does
          not only filter the table: the same `dateF` drives the KPI tiles, the
          count-only movements card, the city breakdown and the facet counts.
          Sitting inside the table's header understated its reach. */}
      <div className="border-b border-border flex items-end justify-between gap-4">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {(["ALL", ...CITIES] as CityTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => resetPage(setCityTab)(tab)}
              className={
                cityTab === tab
                  ? "px-4 py-2.5 text-sm font-semibold text-accent border-b-2 border-accent whitespace-nowrap transition-colors duration-150"
                  : "px-4 py-2.5 text-sm text-text-secondary hover:text-accent whitespace-nowrap transition-colors duration-150"
              }
            >
              {tab === "ALL" ? "ALL CITIES" : tab}
            </button>
          ))}
        </div>
      </div>

      {/* The figures could not be read. Every number below shows an em dash
          rather than a zero (see statFigure); this says why, and offers the
          retry. */}
      {statsError && (
        <ErrorState what="the figures" detail={statsError} onRetry={refetchStats} compact />
      )}

      {/* FOUR NUMBERED SECTIONS, in the order anybody reads a day (18 Sep 2026
          — the page had grown into an unsectioned pile). See
          dashboard-sections.tsx. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChaseByTypeCard
          byName={statsLoading || statsError ? undefined : agg?.openByName ?? {}}
          onPick={(name) => {
            resetPage(setVarianceName)(name);
            document.getElementById("dash-section-4")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <NotificationsCard warnings={statsLoading || statsError ? undefined : stats?.run?.warnings ?? []} />
        <TeamProgressCard teams={statsLoading || statsError ? undefined : agg?.teams ?? {}} />
      </div>

      <DashSection n={1} title="Day status" subtitle="Can this day be judged yet, and what is open">
        <DayStatus agg={agg} loading={statsLoading} error={statsError} onOpenList={setListRequest} />
        {/* Items in transit — not losses: out of the warehouse, Odoo Out not
            yet validated. */}
        <InTransitSection city={cityTab} date={dateF} onOpen={(v) => setDetail(v)} />
      </DashSection>

      <DashSection
        n={2}
        title="What moved"
        subtitle="Barcoded units each book recorded · click any figure to see its rows"
      >
        <SourceScoreboard
          agg={agg}
          city={cityTab}
          loading={statsLoading}
          businessDate={stats?.run?.business_date}
          dayDefinition={stats?.run?.day_definition}
        />
        {/* Not barcoded, so not in the table above: PP boxes, spares,
            consumables and the gate's hand-counted items. */}
        <CountOnlyCard
          agg={agg}
          city={cityTab}
          loading={statsLoading}
          businessDate={stats?.run?.business_date}
        />
      </DashSection>

      <DashSection
        n={3}
        title="Do the books agree"
        subtitle="Each book in turn as the source of truth · units, one per barcode per direction"
      >
        <SourceTruthCards
          agg={agg}
          city={cityTab}
          loading={statsLoading}
          businessDate={stats?.run?.business_date}
        />
      </DashSection>

      {/* City-wise breakdown — one ring per city (23 Oct 2026, the owner's
          reference board). Shut days, worked-through closures and the match
          rate are read exactly as before; the longer notes (waiting on Odoo,
          register after a day off) live on the city's own view, one click on. */}
      {cityTab === "ALL" && stats && stats.byCity.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-headline text-lg text-text-primary">City-wise Breakdown</h3>
          <CityRings
            cities={stats.byCity}
            businessDate={stats.run?.business_date ?? ""}
            calendar={stats.calendar}
            trend={cityTrend}
            onOpen={(c) => resetPage(setCityTab)(c)}
          />
        </div>
      )}

      {/* Section 4 — the units that do not line up. Rows open the detail
          dialog, which carries item, customer, SO, ticket and the evidence. */}
      <DashSection
        n={4}
        title="Variances"
        subtitle={
          <>
            {loading ? "Loading…" : `${total} record${total === 1 ? "" : "s"}`}
            {/* Always name the date in effect — see the note in the header. */}
            {!q && businessDate && (
              <span>
                {" "}· business date <b className="text-text-secondary">{businessDate}</b>
                {!dateF && " (latest run)"}
              </span>
            )}
            {q && <span className="text-accent"> · results for “{q}” across all dates (filters paused)</span>}
            {sortDegraded && (
              <span className="text-status-warning"> · sorted alphabetically (migration 0011 not applied)</span>
            )}
          </>
        }
      >
      <div className="card overflow-hidden">
        {/* ONE FILTER ROW. The four a person reaches for every day — search,
            status, team, problem — sit here; the rest are one click away
            under "More filters". The row used to be nine controls wrapping
            into two uneven lines (18 Sep 2026). */}
        <div className="p-3 border-b border-border bg-surface-elevated flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search barcode, ticket, SO"
              className="input-clean pl-9 w-full"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                title="Clear"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
          <select value={status} onChange={(e) => resetPage(setStatus)(e.target.value as VarianceStatus | "ALL" | "ACTIVE")} className="input-clean cursor-pointer" title="Status">
            {/* "Needs action" spans open + in_progress. Flagging moves a row
                to in_progress, and a plain "open" filter hid exactly the rows
                the flag was meant to escalate. */}
            {/* Three, not six: in 36,647 rows ever recorded only `open` and
                `closed` have really existed. "Pending approval" never matched
                once; "Flagged" matched three times, last on 3 August. */}
            <option value="ACTIVE">Still needs someone</option>
            <option value="closed">Closed</option>
            <option value="ALL">Any status</option>
          </select>
          {/* WHICH BOOK IS SHORT, which is who you go and ask. Replaced the
              team-name filter on 22 Oct 2026 at the owner's request. A movement
              two books missed is listed under both. */}
          <select
            value={source}
            onChange={(e) => resetPage(setSource)(e.target.value as never)}
            className="input-clean cursor-pointer"
            title="Which book has no entry for this movement"
          >
            <option value="ALL">Any source</option>
            {sources.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value} ({f.count})
              </option>
            ))}
          </select>
          {/* Problem type. The name itself is now plain English, so it is shown
              as it is rather than translated through a phrase — and the count
              is the rows IN VIEW, so no option can come back empty. */}
          <select
            value={varianceName}
            onChange={(e) => resetPage(setVarianceName)(e.target.value)}
            className="input-clean cursor-pointer max-w-[300px]"
            title="Work one kind of problem at a time"
          >
            <option value="ALL">All problems</option>
            {varianceNames.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value} ({f.count})
              </option>
            ))}
          </select>
          <select value={bucket} onChange={(e) => resetPage(setBucket)(e.target.value as Bucket | "ALL")} className="input-clean font-semibold cursor-pointer" title="Chase items, or notes for the record">
            <option value="REAL">Variances to fix</option>
            <option value="INFO">Needs nothing</option>
            <option value="ALL">All items</option>
          </select>
          <label className="flex items-center gap-2 text-sm ml-auto cursor-pointer select-none" title="Sort by barcode and keep one unit's rows together, so they can be resolved in one go">
            <input type="checkbox" checked={groupBarcode} onChange={(e) => {
              setGroupBarcode(e.target.checked);
              if (e.target.checked) applySort({ key: "barcode", dir: "asc" });
            }} />
            Group by barcode
          </label>
          <button
            onClick={exportCsv}
            disabled={total === 0 || exporting}
            title={`Download all ${total} matching row${total === 1 ? "" : "s"} as CSV`}
            className="btn btn-primary disabled:opacity-40"
          >
            <Icon
              name={exporting ? "progress_activity" : "download"}
              size={18}
              className={exporting ? "animate-spin" : ""}
            />
            {exporting ? "Exporting…" : `Export ${total || ""}`.trim()}
          </button>
        </div>
        {/* Mobile: card list (below md). The whole card opens the detail dialog,
            same as a desktop row — managers work from a phone, and without this
            the evidence panel was unreachable for them. Inner buttons stop
            propagation so an action never also opens the dialog. */}
        <div className="md:hidden divide-y divide-border">
          {rows.map((v) => (
            <div
              key={v.id}
              onClick={() => openDetail(v)}
              className={`p-4 space-y-2 cursor-pointer transition-colors ${
                sel.has(v.id) ? "bg-accent-soft" : "active:bg-surface-elevated"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="pt-0.5">
                    <RowCheckbox
                      checked={sel.has(v.id)}
                      onChange={() => onRowCheck(v.id, false)}
                      label={`Select ${shownBarcode(v)}`}
                    />
                  </span>
                  {/* A <div> can't take focus — this button is the keyboard route in. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDetail(v);
                    }}
                    className="font-mono font-semibold text-text-primary text-sm break-all text-left hover:text-accent"
                  >
                    {shownBarcode(v)}
                  </button>
                </div>
                <span className={`${PRIORITY_BADGE[v.priority]} shrink-0`}>{v.priority}</span>
              </div>
              {v.product && <p className="text-sm text-text-secondary">{v.product}</p>}
              <VarianceName name={v.variance_name} ctx={{ direction: v.direction, jobType: v.job_type, bucket: v.bucket, note: v.note }} className="block text-sm" />
              <VarianceFlags flags={v.flags} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                <span>{v.business_date}</span>
                <span>{v.city}</span>
                <SourceBadge source={v.variance_source} />
                {v.job_type && <span>{opsTypeLabel(v.job_type)}</span>}
                <span className={`${STATUS_BADGE[v.status]} uppercase`}>{STATUS_LABEL[v.status]}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                {v.so_number && <span>SO: {v.so_number}</span>}
                {v.ticket_id && <span>Ticket: {v.ticket_id}</span>}
              </div>
              {v.status === "pending_approval" && (v.submit_reason || v.submit_note) && (
                <p className="text-xs text-text-muted mt-1">
                  <b>Submitted:</b> {[v.submit_reason, v.submit_note].filter(Boolean).join(" — ")}
                </p>
              )}
              {v.status === "pending_approval" ? (
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      approve(v.id);
                    }}
                    disabled={busyId === v.id}
                    className="btn btn-compact btn-primary flex-1 disabled:opacity-40"
                  >
                    <Icon name="check_circle" size={16} /> Approve
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRejecting({ id: v.id, product: v.product ?? "", barcode: shownBarcode(v) });
                    }}
                    disabled={busyId === v.id}
                    className="btn btn-compact btn-secondary flex-1 disabled:opacity-40"
                  >
                    <Icon name="close" size={16} /> Reject
                  </button>
                </div>
              ) : v.status === "open" || v.status === "in_progress" ? (
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setResolving({ id: v.id, product: v.product ?? "", barcode: shownBarcode(v) });
                    }}
                    disabled={busyId === v.id}
                    className="btn btn-compact btn-primary flex-1 disabled:opacity-40"
                  >
                    <Icon name="task_alt" size={16} /> Resolve
                  </button>
                  {v.status === "open" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dispute(v.id);
                      }}
                      disabled={busyId === v.id}
                      className="btn btn-compact btn-secondary flex-1 disabled:opacity-40"
                    >
                      <Icon name="flag" size={16} /> Flag
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {loading && rows.length === 0 && <CardListSkeleton />}
          {!loading && rows.length === 0 && (
            <EmptyState
              error={error}
              what="these items"
              onRetry={refetch}
              compact
              icon={filtersActive ? "search_off" : "task_alt"}
              title={filtersActive ? "Nothing matches these filters" : "Everything is accounted for"}
              detail={
                filtersActive
                  ? "The rows may exist on another date, city or status."
                  : `No open losses for ${businessDate ?? "this run"}.`
              }
              actionLabel={filtersActive ? "Reset filters" : undefined}
              onAction={filtersActive ? clearFilters : undefined}
            />
          )}
        </div>

        {/* Tablet/desktop: full table (md+) */}
        {/* THIRTEEN COLUMNS IN A BOX THAT REFUSED TO SCROLL.
            `table-clean` is width:100% with no minimum, so the browser met the
            container's width by crushing every column instead of overflowing —
            the sideways scrollbar this div asks for could never appear, and
            Problem and Item were reduced to a word each on a laptop.
            `table-wide` gives the table a floor, which is what turns the squeeze
            back into a scroll.

            BARCODE MOVED to sit beside Date so the two pinned columns are
            adjacent — sticky only works on a contiguous block from the edge, and
            these are the two you need to keep your place while scrolling right:
            the day, and which unit the row is about. */}
        <div className="overflow-x-auto hidden md:block">
          <table className="table-clean table-wide">
            <thead>
              <tr>
                <th className="w-10 col-pin col-pin-1">
                  <SelectAllCheckbox
                    checked={sel.allVisibleSelected}
                    indeterminate={sel.someVisibleSelected}
                    onChange={sel.toggleAllVisible}
                    label={`Select all ${rows.length} rows on this page`}
                  />
                </th>
                <SortHeader label="Barcode" sortKey="barcode" state={sort} onSort={applySort} className="col-pin col-pin-2" />
                {/* One column per book: did it record this unit? The whole
                    story of a variance at a glance, before its name. */}
                <th className="text-center w-[76px]" title="Guard — the gate app">Guard</th>
                <th className="text-center w-[76px]" title="MS — the movement sheet">MS</th>
                <th className="text-center w-[76px]" title="Delivery Tracker">Tracker</th>
                <th className="text-center w-[76px]" title="Odoo">Odoo</th>
                <SortHeader label="Problem" sortKey="variance" state={sort} onSort={applySort} />
                {cityTab === "ALL" && <SortHeader label="City" sortKey="city" state={sort} onSort={applySort} />}
                <SortHeader label="Status" sortKey="status" state={sort} onSort={applySort} />
                <SortHeader
                  label="Open for"
                  sortKey="age"
                  state={sort}
                  onSort={applySort}
                  title="Sort by how long this has gone unfixed"
                />
                <th className="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => openDetail(v)}
                  className={`cursor-pointer ${sel.has(v.id) ? "bg-accent-soft" : ""} ${
                    groupBarcode && (barcodeGroups.get(shownBarcode(v))?.length ?? 0) > 1
                      ? "border-l-2 border-accent"
                      : ""
                  }`}
                >
                  {/* Severity at a glance: red is three books short, amber one
                      or two, grey a note for the record. Same stripe as the
                      manager board — it is what lets the chase-or-note question
                      be answered by looking instead of by filtering. */}
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className={`col-pin col-pin-1 border-l-[3px] ${
                      v.bucket !== "REAL"
                        ? "border-l-border"
                        : v.priority === "High"
                          ? "border-l-danger"
                          : "border-l-status-warning"
                    }`}
                  >
                    <RowCheckbox
                      checked={sel.has(v.id)}
                      onChange={(shift) => onRowCheck(v.id, shift)}
                      label={`Select ${shownBarcode(v)}`}
                    />
                  </td>
                  <td className="col-pin col-pin-2">
                    {/* A <tr> can't take focus — this is the keyboard route in. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(v);
                      }}
                      className="font-mono font-semibold text-text-primary hover:text-accent hover:underline whitespace-nowrap"
                    >
                      {shownBarcode(v)}
                    </button>
                    {/* The date is the section's own date, so it is shown per
                        row only when the list spans several — a search. */}
                    {(q || allDates) && (
                      <span className="block text-[11px] text-text-muted">{v.business_date}</span>
                    )}
                    {v.product && (
                      <span className="block text-[11px] text-text-muted truncate max-w-[180px]" title={v.product}>
                        {v.product}
                      </span>
                    )}
                    {/* One unit, several problems. The chip says how many and
                        selects them all, so the bulk bar can close the unit in
                        one action with one reason. */}
                    {(barcodeGroups.get(shownBarcode(v))?.length ?? 0) > 1 &&
                      barcodeGroups.get(shownBarcode(v))![0] === v.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const ids = barcodeGroups.get(shownBarcode(v)) ?? [];
                            sel.selectRange(ids, !ids.every((id) => sel.has(id)));
                          }}
                          className="mt-1 badge badge-info hover:underline cursor-pointer"
                          title="Select every row for this unit"
                        >
                          {barcodeGroups.get(shownBarcode(v))!.length} problems · select all
                        </button>
                      )}
                  </td>
                  <BookTick present={v.present_p} reported={v.reported_p} />
                  <BookTick present={v.present_s} reported={v.reported_s} />
                  <BookTick present={v.present_d} reported={v.reported_d} />
                  <BookTick present={v.present_o} reported={v.reported_o} />
                  <td className="min-w-[240px]" title={v.note ?? ""}>
                    <VarianceName name={v.variance_name} ctx={{ direction: v.direction, jobType: v.job_type, bucket: v.bucket, note: v.note }} />
                    <VarianceFlags flags={v.flags} />
                    <span className="block text-[11px] text-text-muted mt-0.5">
                      {v.direction === "IN" ? "Inward" : v.direction === "OUT" ? "Outward" : v.direction}
                      {v.priority === "High" && <span className="text-danger"> · urgent</span>}
                    </span>
                  </td>
                  {cityTab === "ALL" && <td className="whitespace-nowrap">{v.city}</td>}
                  <td>
                    <span
                      className={`${STATUS_BADGE[v.status]} uppercase`}
                      title={
                        v.status === "pending_approval"
                          ? [v.submit_reason, v.submit_note].filter(Boolean).join(" — ") || undefined
                          : v.closure_reason ?? undefined
                      }
                    >
                      {STATUS_LABEL[v.status]}
                    </span>
                  </td>
                  <td className="text-text-secondary whitespace-nowrap" title={formatTs(v.first_seen_at)}>
                    {ageLabel(v.first_seen_at)}
                  </td>
                  <td className="text-center">
                    {v.status === "pending_approval" ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            approve(v.id);
                          }}
                          disabled={busyId === v.id}
                          title="Approve — closes this variance"
                          className="btn-icon hover:text-success disabled:opacity-40"
                        >
                          <Icon name="check_circle" size={18} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRejecting({ id: v.id, product: v.product ?? "", barcode: shownBarcode(v) });
                          }}
                          disabled={busyId === v.id}
                          title="Reject — send back to the manager"
                          className="btn-icon hover:text-danger disabled:opacity-40"
                        >
                          <Icon name="close" size={18} />
                        </button>
                      </div>
                    ) : v.status === "open" || v.status === "in_progress" ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setResolving({ id: v.id, product: v.product ?? "", barcode: shownBarcode(v) });
                          }}
                          disabled={busyId === v.id}
                          title="Close with a reason and comment"
                          className="btn btn-compact btn-primary disabled:opacity-40"
                        >
                          Resolve
                        </button>
                        {v.status === "open" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dispute(v.id);
                            }}
                            disabled={busyId === v.id}
                            title="Flag as disputed — escalate to city manager"
                            className="btn btn-compact btn-secondary disabled:opacity-40"
                          >
                            Flag
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-text-disabled inline-flex p-1" title={v.status}>
                        <Icon name="task_alt" size={18} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {loading && rows.length === 0 && <TableBodySkeleton cols={14} />}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={14}>
                    <EmptyState
                      error={error}
                      what="these items"
                      onRetry={refetch}
                      icon={filtersActive ? "search_off" : "task_alt"}
                      title={
                        filtersActive ? "Nothing matches these filters" : "Everything is accounted for"
                      }
                      detail={
                        filtersActive
                          ? "The rows may exist on another date, city or status."
                          : `No open losses for ${businessDate ?? "this run"}.`
                      }
                      actionLabel={filtersActive ? "Reset filters" : undefined}
                      onAction={filtersActive ? clearFilters : undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-border bg-surface-elevated flex justify-between items-center px-4">
          <span className="text-xs text-text-muted">
            Page {page} of {Math.max(1, totalPages)} · {total} total
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-icon border border-border disabled:opacity-40">
              <Icon name="chevron_left" size={18} />
            </button>
            <span className="px-3 text-xs font-semibold text-text-secondary">{page} / {Math.max(1, totalPages)}</span>
            <button onClick={() => setPage((p) => (totalPages ? Math.min(totalPages, p + 1) : p))} disabled={page >= totalPages} className="btn-icon border border-border disabled:opacity-40">
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
        </div>
      </div>
      </DashSection>
      {rejecting && (
        <CloseVarianceModal
          itemName={rejecting.product}
          itemCode={rejecting.barcode}
          title="Reject Submission"
          confirmLabel="Reject & send back"
          showReason={false}
          notePlaceholder="Explain why this is being sent back to the manager…"
          onConfirm={handleReject}
          onCancel={() => setRejecting(null)}
        />
      )}

      {resolving && (
        <CloseVarianceModal
          itemName={resolving.product}
          itemCode={resolving.barcode}
          title="Resolve Variance"
          confirmLabel="Resolve & Close"
          notePlaceholder="Add a comment about how this was resolved…"
          onConfirm={handleResolve}
          onCancel={() => setResolving(null)}
        />
      )}

      <VarianceListModal
        request={listRequest}
        city={cityTab}
        date={dateF || undefined}
        role={user.role}
        onClose={() => setListRequest(null)}
        onDirty={refreshAll}
      />

      <VarianceDetailModal
        variance={detail}
        role={user.role}
        onClose={() => setDetail(null)}
        onChanged={refreshAll}
      />

      <BulkActionBar
        ids={sel.ids}
        role={user.role}
        pendingApprovalCount={selectedPendingApproval}
        onClear={sel.clear}
        onDone={refreshAll}
      />
    </section>
  );
}

/**
 * One book's verdict on one unit: ✓ recorded it, ✗ did not, — did not report
 * at all that day (never counted as missing — invariant 2).
 */
function BookTick({ present, reported }: { present?: boolean; reported?: boolean }) {
  if (reported === false) {
    return <td className="text-center text-text-disabled" title="This book did not report that day">—</td>;
  }
  return present ? (
    <td className="text-center text-success font-semibold" title="Recorded">✓</td>
  ) : (
    <td className="text-center text-danger font-semibold" title="Not recorded">✗</td>
  );
}
