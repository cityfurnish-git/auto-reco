// A unit's history as a story, not a list of records (owner, 23 Oct 2026:
// "understand the conclusion from this, not just a beautified raw data").
//
// THE RAW LEDGER REPEATS ITSELF. movement_events holds one row per unit per
// direction per RUN DAY, and one movement lands on two or three run days:
// Odoo is read a day either side of every run, and the books are typed on
// different days (0TJ4ED23020023: DT logged the 24 Jul dispatch on the 24th,
// MS and Odoo on the 25th, and Odoo's entry echoed into the 26th). Measured
// over all 113,736 consecutive ledger pairs on 23 Oct 2026: 85,022 repeat the
// direction, and 82,928 of those (97.5%) are within 3 days — echoes.
//
// So, three steps:
//   1. MERGE   same direction within MERGE_DAYS of the previous row = one
//              movement; its books are the union of every row's.
//   2. GAPS    two movements left in the same direction are a real hole: a
//              unit cannot go out twice without coming back. 745 OUT→OUT and
//              1,349 IN→IN on the same day's measurement.
//   3. SUMMARY where it is now, the chain, and what is still open.
//
// Pure — no React, no fetch — so it is tested on real units' rows.

export const MERGE_DAYS = 3;
/** movement_events starts here; nothing before it is knowable. */
export const HISTORY_START = "2026-07-22";

export type Dir = "IN" | "OUT";
type Book = "p" | "s" | "d" | "o";
export const BOOK_KEYS: Book[] = ["p", "s", "d", "o"];

export interface LedgerRow {
  business_date: string;
  city: string;
  direction: Dir;
  present_p: boolean; present_s: boolean; present_d: boolean; present_o: boolean;
  reported_p: boolean; reported_s: boolean; reported_d: boolean; reported_o: boolean;
  outcome: "CLEAN" | "INFO" | "REAL" | "SUPPRESSED";
  product: string | null;
  customer: string | null;
  so_number: string | null;
  job_type: string | null;
}
export interface FlagRow {
  business_date: string;
  city: string;
  direction: string;
  variance_name: string;
  bucket: string | null;
  status: string;
  closure_reason: string | null;
}
export interface ScanRow {
  business_date: string;
  direction: string;
  scanned_at: string;
}

export interface Movement {
  dir: Dir;
  from: string;
  to: string;
  city: string;
  /** Saw it on at least one of the merged days. */
  saw: Record<Book, boolean>;
  /** Filed a book on at least one of the merged days. */
  filed: Record<Book, boolean>;
  customer: string | null;
  orders: string[];
  flags: FlagRow[];
  scans: ScanRow[];
  /** A REAL item raised for it and not closed. */
  open: boolean;
  /** How many raw ledger rows were folded into this one. */
  rows: number;
}

export interface Gap {
  kind: "missing-return" | "missing-dispatch";
  after: string;
  before: string;
}

export type StoryItem = { type: "move"; move: Movement } | { type: "gap"; gap: Gap };

export interface Story {
  /** Oldest first. */
  items: StoryItem[];
  moves: Movement[];
  gaps: Gap[];
  now: { where: "in" | "out"; city: string; since: string; customer: string | null } | null;
  openCount: number;
  /** Days each OUT spent with the customer before the next IN, by OUT index. */
  daysOut: Map<number, number>;
}

const days = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The customer a person would name: from a floor book's day if there is one
 *  (Odoo's partner can be the billing name), first spelling otherwise. */
function pickCustomer(rows: LedgerRow[]): string | null {
  const floor = rows.find((r) => (r.present_s || r.present_d) && r.customer);
  const name = (floor ?? rows.find((r) => r.customer))?.customer ?? null;
  // "SAMTA RAWAL, Samta Rawal" — two books' spellings joined upstream.
  return name ? name.split(",")[0].trim() : null;
}

export function buildStory(ledger: LedgerRow[], flags: FlagRow[], scans: ScanRow[]): Story {
  const rows = [...ledger].sort((a, b) =>
    a.business_date === b.business_date
      ? a.direction === b.direction ? 0 : a.direction === "IN" ? -1 : 1
      : a.business_date.localeCompare(b.business_date)
  );

  // 1. MERGE. Grouped against the group's LAST day, so a chain of daily
  // echoes folds in as long as no step is longer than MERGE_DAYS.
  //
  // An ODOO-ONLY row (no floor book, nothing real raised) is an echo of a
  // posting, and it can land AFTER the next movement: in on the 23rd, out on
  // the 24th, the in's Odoo entry echoing into the 25th. Folded into the
  // nearest same-direction movement within MERGE_DAYS even across another,
  // or the story would invent an in → out → in loop.
  const odooOnly = (r: LedgerRow) =>
    r.present_o && !r.present_p && !r.present_s && !r.present_d && r.outcome !== "REAL";
  const groups: LedgerRow[][] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (last && last.direction === r.direction && days(last.business_date, r.business_date) <= MERGE_DAYS) {
      g.push(r);
      continue;
    }
    if (odooOnly(r)) {
      const host = [...groups].reverse().find(
        (x) => x[0].direction === r.direction && days(x[x.length - 1].business_date, r.business_date) <= MERGE_DAYS
      );
      if (host) {
        host.push(r);
        continue;
      }
    }
    groups.push([r]);
  }

  const moves: Movement[] = groups.map((g) => {
    const saw = { p: false, s: false, d: false, o: false };
    const filed = { p: false, s: false, d: false, o: false };
    for (const r of g) for (const k of BOOK_KEYS) {
      saw[k] ||= r[`present_${k}`];
      filed[k] ||= r[`reported_${k}`];
    }
    return {
      dir: g[0].direction,
      from: g[0].business_date,
      to: g[g.length - 1].business_date,
      city: g[0].city,
      saw,
      filed,
      customer: pickCustomer(g),
      orders: [...new Set(g.map((r) => r.so_number).filter((x): x is string => !!x))],
      flags: [],
      scans: [],
      open: false,
      rows: g.length,
    };
  });

  // Flags and gate scans attach to the movement whose span holds their date
  // (same direction), else the nearest same-direction one within MERGE_DAYS.
  const home = (date: string, dir: string): Movement | undefined => {
    const d = dir === "CROSS" ? null : dir.toUpperCase();
    const same = moves.filter((m) => d === null || m.dir === d);
    return (
      same.find((m) => date >= m.from && date <= m.to) ??
      same
        .map((m) => ({ m, gap: Math.min(Math.abs(days(m.from, date)), Math.abs(days(m.to, date))) }))
        .filter((x) => x.gap <= MERGE_DAYS)
        .sort((a, b) => a.gap - b.gap)[0]?.m
    );
  };
  for (const f of flags) home(f.business_date, f.direction)?.flags.push(f);
  for (const s of scans) home(s.business_date, s.direction)?.scans.push(s);
  for (const m of moves) m.open = m.flags.some((f) => f.bucket === "REAL" && f.status !== "closed");

  // 2. GAPS.
  const items: StoryItem[] = [];
  const gaps: Gap[] = [];
  moves.forEach((m, i) => {
    const prev = moves[i - 1];
    if (prev && prev.dir === m.dir) {
      const gap: Gap = { kind: m.dir === "OUT" ? "missing-return" : "missing-dispatch", after: prev.to, before: m.from };
      gaps.push(gap);
      items.push({ type: "gap", gap });
    }
    items.push({ type: "move", move: m });
  });

  const daysOut = new Map<number, number>();
  moves.forEach((m, i) => {
    const next = moves[i + 1];
    if (m.dir === "OUT" && next?.dir === "IN") daysOut.set(i, days(m.from, next.from));
  });

  const last = moves[moves.length - 1];
  return {
    items,
    moves,
    gaps,
    now: last ? { where: last.dir === "IN" ? "in" : "out", city: last.city, since: last.from, customer: last.customer } : null,
    openCount: moves.filter((m) => m.open).length,
    daysOut,
  };
}
