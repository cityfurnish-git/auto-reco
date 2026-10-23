// The rules every stored chase row must obey, checked against the live data.
//
// Owner, 23 Oct 2026, after a row read "– MS – DT" beside a detail panel
// showing all four books holding the unit: "identify cases like these … and
// fix them altogether. An important aspect of enabling a feature is to create
// guardrails." The audit that day found five families nobody had noticed —
// each one written by a step that was correct on its own and wrong in
// combination with another:
//
//   grading     107 cleared rows put back on the chase list by migration
//               0051's regrade, which read grading from the name alone
//   ticks       162 cleared rows still showing the ticks of the morning run
//               that raised them
//   stale       148 rows the latest ledger calls clean, never retired because
//               the clean-up demanded a gate book four cities do not have
//   two names   81 unit-days where "Delivery failed" sat beside "Not in Odoo"
//   (and 1,424 rows ranked High on a book that never reported — fixed in the
//   grading itself, so it is covered by the first rule here)
//
// So the rules live here, ONE copy, read by two callers:
//   - the nightly pipeline, for the date it just ran — findings land in the
//     run's warnings, so the dashboard's notifications box shows them;
//   - scripts/integrity-check.mts, over every open row — run before a push,
//     exits non-zero on any finding.
//
// Pure: rows in, findings out. The readers below fetch.

import type { SupabaseClient } from "@supabase/supabase-js";
import { chasePriority, VARIANCE_META } from "../engine/buckets";
import { absenceClaim } from "../engine/absence-claim";
import { RESOLVED_LATE_NOTE } from "../engine/resolution";
import { VARIANCE } from "../engine/variance-names";

type Flags = { P: boolean; S: boolean; D: boolean; O: boolean };

export interface IntegrityRow {
  id: string;
  business_date: string;
  city: string;
  direction: string;
  barcode: string;
  variance_name: string;
  bucket: string;
  priority: string;
  status: string;
  note: string | null;
  present_p: boolean | null; present_s: boolean | null; present_d: boolean | null; present_o: boolean | null;
  reported_p: boolean | null; reported_s: boolean | null; reported_d: boolean | null; reported_o: boolean | null;
}

export interface LedgerFlags {
  present: Flags;
  outcome: "CLEAN" | "INFO" | "REAL" | "SUPPRESSED";
}

export interface Finding {
  rule: string;
  /** What a person reads — plain words. */
  label: string;
  ids: string[];
}

/** Raised after the ladder, from gate_trips / gate_scans / the OT pairing —
 *  the ledger never carries them, so "ledger clean" says nothing about them. */
const OUTSIDE_LADDER = new Set<string>([VARIANCE.ODD_HOUR_TRIP, VARIANCE.BARCODE_OVERDUE, VARIANCE.OT_CASE]);
/** A second name a unit-day may legitimately carry: these describe a fact
 *  about the RECORDS (two lines in one book), not about where the unit is. */
const MAY_SHARE = new Set<string>([VARIANCE.DUPLICATE]);

export const ledgerKey = (r: { business_date: string; city: string; direction: string; barcode: string }) =>
  `${r.business_date}|${r.city}|${r.direction}|${r.barcode}`;

const flagsOf = (r: IntegrityRow, kind: "present" | "reported"): Flags => ({
  P: !!r[`${kind}_p`], S: !!r[`${kind}_s`], D: !!r[`${kind}_d`], O: !!r[`${kind}_o`],
});

export function checkRows(rows: IntegrityRow[], ledger: Map<string, LedgerFlags>): Finding[] {
  const open = rows.filter((r) => r.status === "open" || r.status === "in_progress");
  const out: Record<string, Finding> = {};
  const add = (rule: string, label: string, id: string) => {
    (out[rule] ??= { rule, label, ids: [] }).ids.push(id);
  };

  for (const r of open) {
    const cleared = r.note === RESOLVED_LATE_NOTE;
    const known = r.variance_name in VARIANCE_META;
    const L = ledger.get(ledgerKey(r));

    if (!known) add("unknown-name", "Problem name the engine does not know", r.id);

    // Grading: a cleared row is a note; every other row carries exactly the
    // grade the engine would give it today, given who reported.
    if (cleared) {
      if (r.bucket !== "INFO" || r.priority !== "Info") add("cleared-on-chase-list", "Cleared on re-check but still on the chase list", r.id);
    } else if (known) {
      const want = chasePriority(r.variance_name, flagsOf(r, "reported"), r.priority as "High" | "Medium" | "Info");
      if (r.bucket !== want.bucket || r.priority !== want.priority) add("grading", "Graded differently from the rule for its name", r.id);
    }

    // Its own ticks must not contradict its own name.
    const claim = absenceClaim(r.variance_name);
    const present = flagsOf(r, "present");
    if (!cleared && claim.some((k) => present[k])) add("self-contradiction", "Says a book is missing while its own tick says present", r.id);

    if (L) {
      if (cleared && (L.present.P !== present.P || L.present.S !== present.S || L.present.D !== present.D || L.present.O !== present.O)) {
        add("stale-ticks", "Cleared row's ticks disagree with the latest records", r.id);
      }
      if (!cleared && r.bucket === "REAL" && !OUTSIDE_LADDER.has(r.variance_name) && (L.outcome === "CLEAN" || L.outcome === "SUPPRESSED")) {
        add("stale-chase", "On the chase list though the latest records say it is clean", r.id);
      }
    }
  }

  // One gap, one name (rule 18).
  const byUnit = new Map<string, IntegrityRow[]>();
  for (const r of open) {
    if (r.direction === "CROSS" || MAY_SHARE.has(r.variance_name)) continue;
    const k = ledgerKey(r);
    byUnit.set(k, [...(byUnit.get(k) ?? []), r]);
  }
  for (const group of byUnit.values()) {
    if (group.length > 1) for (const r of group) add("two-names", "One unit, one day, carrying two problem names", r.id);
  }

  return Object.values(out).sort((a, b) => b.ids.length - a.ids.length);
}

/** One line per finding, for run warnings and the script's output. */
export function describeFindings(date: string | null, findings: Finding[]): string[] {
  return findings.map((f) => `Integrity${date ? ` (${date})` : ""}: ${f.ids.length} row${f.ids.length === 1 ? "" : "s"} — ${f.label}`);
}

const ROW_COLUMNS =
  "id, business_date, city, direction, barcode, variance_name, bucket, priority, status, note, present_p, present_s, present_d, present_o, reported_p, reported_s, reported_d, reported_o";

/** Every open row and its ledger, for one business date. Paginated — the
 *  PostgREST 1,000-row cap has bitten this codebase before. */
export async function readDate(db: SupabaseClient, date: string): Promise<{ rows: IntegrityRow[]; ledger: Map<string, LedgerFlags> }> {
  const rows: IntegrityRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("variances")
      .select(ROW_COLUMNS)
      .eq("business_date", date)
      .in("status", ["open", "in_progress"])
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`integrity: variances ${date}: ${error.message}`);
    rows.push(...((data ?? []) as IntegrityRow[]));
    if (!data || data.length < 1000) break;
  }
  const ledger = new Map<string, LedgerFlags>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("movement_events")
      .select("business_date, city, direction, barcode, present_p, present_s, present_d, present_o, outcome")
      .eq("business_date", date)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`integrity: ledger ${date}: ${error.message}`);
    for (const e of data ?? []) {
      ledger.set(ledgerKey(e), {
        present: { P: !!e.present_p, S: !!e.present_s, D: !!e.present_d, O: !!e.present_o },
        outcome: e.outcome,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return { rows, ledger };
}
