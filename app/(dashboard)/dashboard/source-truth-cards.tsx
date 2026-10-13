// Section 3 — do the books agree? Each book in turn as the source of truth.
//
// Owner's design, 18 Sep 2026, after deciding that no single book is the
// anchor and all four are cross-verified. Four cards, one per book: of the
// units THAT book has, how many all four agree on.
//
// Units, not rows, from the movement ledger — one per barcode per direction.
// Odoo is counted on its own 3pm window, the same rule as the source table in
// section 2, so each card's "has" figure ties to that table.
//
// SHORTENED 13 OCT 2026 (owner). Each card used to carry eight split bars — all
// four agree, then one pairing against each of the other three books, inward and
// outward apart — plus a legend. Four of those side by side was the densest
// thing on the page, and the detail was being read before the headline it was
// meant to support. The card now answers one question, "how many of this book's
// units does everything else agree on", and the eight numbers move inside the
// modal, where there is room for them and where the units themselves are.
//
// The direction split moves with them: it is the modal's one filter, so the
// card is a single figure for the whole day rather than two half-figures a
// reader has to add up.

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icon";
import { ErrorState } from "@/components/error-state";
import { SOURCE_NAME } from "@/lib/ui/source-names";
import { downloadTable, type CsvColumn } from "@/lib/ui/csv-download";
import type { CityAgg, TruthSource } from "@/lib/hooks/use-dashboard-data";

const BOOKS: TruthSource[] = ["gate", "sheet", "dt", "odoo"];
const NAME: Record<TruthSource, string> = {
  gate: SOURCE_NAME.gate, sheet: SOURCE_NAME.sheet, dt: SOURCE_NAME.dt, odoo: SOURCE_NAME.odoo,
};
type Dir = "IN" | "OUT";
/** The modal's one filter. BOTH is the default so it opens on the card's own figure. */
type DirFilter = "BOTH" | Dir;
const DIRS: Dir[] = ["IN", "OUT"];
const dirsOf = (f: DirFilter): Dir[] => (f === "BOTH" ? DIRS : [f]);

/** Which slice of a book's units the modal's table is showing. */
interface Slice {
  kind: "all" | "allMatched" | "notAll" | "notMatched";
  vs?: TruthSource;
  label: string;
}

export default function SourceTruthCards({ agg, city, loading, businessDate }: {
  agg: CityAgg | null;
  city: string;
  loading: boolean;
  businessDate?: string;
}) {
  const [open, setOpen] = useState<TruthSource | null>(null);
  const t = agg?.truth;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {BOOKS.map((book) => {
          const c = t?.[book];
          const saw = (c?.IN.saw ?? 0) + (c?.OUT.saw ?? 0);
          const ok = (c?.IN.allMatched ?? 0) + (c?.OUT.allMatched ?? 0);
          const pct = saw ? Math.round((ok / saw) * 100) : null;
          return (
            <button
              key={book}
              type="button"
              disabled={loading || !saw || !businessDate}
              onClick={() => setOpen(book)}
              title={saw ? `Open every ${NAME[book]} unit for the day` : "This book recorded nothing for the day"}
              className="card p-4 text-left flex flex-col gap-2 hover:bg-surface-elevated transition-colors duration-150 disabled:hover:bg-surface-card cursor-pointer disabled:cursor-default"
            >
              <p className="text-[11px] uppercase tracking-wider text-text-muted">{NAME[book]}</p>
              {/* THE ONE FIGURE: of what this book has, how much everything
                  else agrees on. An em dash, never a zero, when the book did
                  not report — those mean opposite things. */}
              <p className="text-2xl font-bold tabular-nums text-text-primary leading-none">
                {loading ? "…" : saw ? ok : "—"}
                {!loading && !!saw && (
                  <span className="text-base font-normal text-text-muted"> of {saw}</span>
                )}
              </p>
              <p className="text-xs text-text-secondary">
                {loading ? " " : saw ? "all four agree" : "nothing recorded"}
              </p>
              {!loading && !!saw && (
                <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-elevated" aria-hidden="true">
                  <i className="bg-success" style={{ width: `${pct}%` }} />
                  <i className="bg-danger grow" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {open && businessDate && (
        <TruthModal book={open} date={businessDate} city={city}
          counts={t?.[open]} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

interface Row {
  barcodeDisplay: string;
  direction: string;
  jobType: string | null;
  soNumber: string | null;
  ticketId: string | null;
  customer: string | null;
  product: string | null;
  seenBy: string;
}

const COLUMNS: CsvColumn<Row>[] = [
  { label: "Barcode", of: (r) => r.barcodeDisplay },
  { label: "Direction", of: (r) => (r.direction === "IN" ? "Inward" : "Outward") },
  { label: "Product", of: (r) => r.product },
  { label: "Customer", of: (r) => r.customer },
  { label: "SO", of: (r) => r.soNumber },
  { label: "Ticket", of: (r) => r.ticketId },
  { label: "Job type", of: (r) => r.jobType },
  { label: "Seen by", of: (r) => r.seenBy },
];

function TruthModal({ book, date, city, counts, onClose }: {
  book: TruthSource;
  date: string;
  city: string;
  counts?: CityAgg["truth"][TruthSource];
  onClose: () => void;
}) {
  const [dir, setDir] = useState<DirFilter>("BOTH");
  const [slice, setSlice] = useState<Slice>({ kind: "all", label: "Everything this book has" });
  // KEYED TO THE REQUEST, not reset on the way in. Clearing the table at the
  // top of the effect is a synchronous setState during render's commit; holding
  // the answer with the question it answers gets the same empty-while-loading
  // behaviour from what is already on screen, and a late reply for a filter the
  // reader has moved on from can never paint.
  const [answer, setAnswer] = useState<{ key: string; rows: Row[]; capped: boolean } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  const others = BOOKS.filter((o) => o !== book);
  /** Sum a figure across whichever directions the filter admits. */
  const sum = (pick: (c: NonNullable<typeof counts>[Dir]) => number) =>
    dirsOf(dir).reduce((n, d) => n + (counts ? pick(counts[d]) : 0), 0);

  const saw = sum((c) => c.saw);
  const allOk = sum((c) => c.allMatched);

  const slices: (Slice & { count: number })[] = useMemo(() => [
    { kind: "all", label: "Everything this book has", count: saw },
    { kind: "allMatched", label: "All four agree", count: allOk },
    { kind: "notAll", label: "At least one book is missing it", count: Math.max(0, saw - allOk) },
    ...others.map((o) => ({
      kind: "notMatched" as const,
      vs: o,
      label: `${NAME[o]} does not have it`,
      count: sum((c) => c.vs[o]?.notMatched ?? 0),
    })),
  ], [saw, allOk, dir, book]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = [book, slice.kind, slice.vs ?? "", dir, date, city].join("|");

  // One request per direction the filter admits, so BOTH shows the same units
  // the card counted. Two small reads beat a second API shape for one toggle.
  useEffect(() => {
    let alive = true;
    Promise.all(dirsOf(dir).map((d) => {
      const q = new URLSearchParams({ truth: book, kind: slice.kind, direction: d, date });
      if (slice.vs) q.set("vs", slice.vs);
      if (city !== "ALL") q.set("city", city);
      return fetch(`/api/anchored?${q}`, { credentials: "same-origin" }).then((r) => r.json());
    }))
      .then((results) => {
        if (!alive) return;
        const bad = results.find((j) => j.error);
        if (bad) { setFailed({ key, message: String(bad.error) }); return; }
        setAnswer({
          key,
          rows: results.flatMap((j) => (j.rows ?? []) as Row[]),
          capped: results.some((j) => j.capped),
        });
      })
      .catch(() => { if (alive) setFailed({ key, message: "Could not reach the server." }); });
    return () => { alive = false; };
  }, [key, book, slice, dir, date, city]);

  const rows = answer?.key === key ? answer.rows : null;
  const capped = answer?.key === key ? answer.capped : false;
  const error = failed?.key === key ? failed.message : null;

  const sideLabel = dir === "BOTH" ? "inward and outward" : dir === "IN" ? "inward" : "outward";

  return (
    <Modal open onClose={onClose} size="xl" icon="fact_check"
      title={`${NAME[book]} as the source of truth · ${date}`}
      subtitle="One row per unit. 'Seen by' names every book that has it — the others do not.">

      {/* THE ONE FILTER (owner, 13 Oct 2026). Inward and outward are different
          movements with different books behind them, so the split is worth a
          control; everything else that used to be a control is a row below. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">Direction</span>
        <div className="flex rounded-control border border-border overflow-hidden">
          {([["BOTH", "Both"], ["IN", "Inward"], ["OUT", "Outward"]] as [DirFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setDir(v)}
              className={`px-3 h-8 text-sm cursor-pointer ${dir === v ? "bg-accent text-white" : "hover:bg-surface-elevated"}`}>
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-compact btn-secondary ml-auto"
          disabled={!rows || rows.length === 0}
          onClick={() => rows && exportSlice(rows, book, slice, dir, date, city)}>
          <Icon name="download" size={15} /> Export
        </button>
      </div>

      {/* The eight figures the card used to carry. Each one picks the table. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {slices.map((s) => {
          const on = s.kind === slice.kind && s.vs === slice.vs;
          return (
            <button key={`${s.kind}:${s.vs ?? ""}`} type="button"
              onClick={() => setSlice({ kind: s.kind, vs: s.vs, label: s.label })}
              className={`rounded-pill border px-3 h-8 text-sm whitespace-nowrap cursor-pointer ${
                on ? "border-accent bg-accent-soft text-accent font-semibold" : "border-border hover:bg-surface-elevated"
              }`}>
              {s.label}
              <span className="tabular-nums text-text-muted font-normal"> · {s.count}</span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-text-muted mb-3">
        {slice.label} · {sideLabel}
        {rows && <> · <span className="tabular-nums">{rows.length}</span> unit{rows.length === 1 ? "" : "s"}</>}
        {capped && <span className="text-status-warning"> · showing the first 1,000 of each direction only</span>}
      </p>

      {error && <ErrorState what="these units" detail={error} onRetry={() => location.reload()} compact />}
      {!rows && !error && <p className="text-sm text-text-muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-text-muted">Nothing in this group for the day.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-control">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-surface-elevated">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.label} className="text-left px-3 py-2 border border-border text-xs uppercase tracking-wide text-text-muted whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.barcodeDisplay}-${r.direction}-${i}`} className="hover:bg-surface-elevated">
                  <td className="px-3 py-1.5 border border-border font-mono whitespace-nowrap">{r.barcodeDisplay}</td>
                  <td className="px-3 py-1.5 border border-border whitespace-nowrap">{r.direction === "IN" ? "Inward" : "Outward"}</td>
                  <td className="px-3 py-1.5 border border-border">{r.product ?? "—"}</td>
                  <td className="px-3 py-1.5 border border-border">{r.customer ?? "—"}</td>
                  <td className="px-3 py-1.5 border border-border font-mono whitespace-nowrap">{r.soNumber ?? "—"}</td>
                  <td className="px-3 py-1.5 border border-border font-mono whitespace-nowrap">{r.ticketId ?? "—"}</td>
                  <td className="px-3 py-1.5 border border-border whitespace-nowrap">{r.jobType ?? "—"}</td>
                  <td className="px-3 py-1.5 border border-border text-xs text-text-muted">{r.seenBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** The slice on screen, as a spreadsheet. */
function exportSlice(rows: Row[], book: TruthSource, slice: Slice, dir: DirFilter, date: string, city: string) {
  downloadTable(rows, COLUMNS, [
    NAME[book],
    slice.vs ? `${slice.kind}-${NAME[slice.vs]}` : slice.kind,
    dir.toLowerCase(),
    city !== "ALL" ? city : null,
    date,
  ]);
}
