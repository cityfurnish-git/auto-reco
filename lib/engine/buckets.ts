// Section 10 — Bucket Layer (REAL vs INFO relabel) plus per-variance metadata
// (owner + human-readable note). The relabel is non-destructive: it only
// re-tags priority for reporting. INFO rows get priority forced to Info,
// original_priority preserved, and dampened: true.

import { absenceClaim } from "./absence-claim";
import { VARIANCE } from "./variance-names";
import type { Bucket, Priority, VarianceRowOut } from "./types";

interface VarianceMeta {
  bucket: Bucket;
  responsible: string;
  note: string;
}

// REAL = chase today; INFO = data-hygiene only (Section 10). Keyed by the
// canonical variance names (lib/engine/variance-names.ts).
export const VARIANCE_META: Record<string, VarianceMeta> = {
  // ── REAL — chase list ──────────────────────────────────────────────────
  [VARIANCE.WRONG_SCAN]: {
    bucket: "REAL",
    responsible: "delivery_team",
    note: "The DT scan does not match the expected barcode — verify the physical unit against the SO before trusting the delivery.",
  },
  [VARIANCE.DT_ONLY]: {
    bucket: "REAL",
    responsible: "delivery_team",
    note: "Only DT claims this moved — no floor record. Confirm the unit actually left the warehouse.",
  },
  [VARIANCE.FLOOR_DT_NOT_ODOO]: {
    bucket: "REAL",
    responsible: "odoo_team",
    note: "Gate register + DT confirm the movement but Odoo has not posted it — post the stock move today.",
  },
  [VARIANCE.GATE_OPS_NO_DT_ODOO]: {
    bucket: "REAL",
    responsible: "odoo_team",
    note: "Gate register + ops sheet agree the unit moved, but there is no DT scan and no Odoo posting — post to Odoo and check DT.",
  },
  [VARIANCE.GATE_ONLY]: {
    bucket: "REAL",
    responsible: "warehouse_team",
    note: "Only the gate register logged this — ops sheet, DT and Odoo have no record. Trace where the unit went.",
  },
  [VARIANCE.SHEET_ONLY]: {
    bucket: "REAL",
    responsible: "ops_team",
    note: "Only the ops sheet logged this — nothing else corroborates. Confirm the movement actually happened.",
  },
  [VARIANCE.OPS_ODOO_NO_GATE]: {
    // INFO, not REAL (measured 2026-07-20: 220 of 230 such rows ALSO carried a
    // DT scan — Sheet+DT+Odoo all confirmed; only the handwritten register /
    // its OCR missed the line). The movement is fully documented in the typed
    // systems; a gate-log gap is hygiene, the same family as the other
    // one-source-missing INFO rows below. Never a stock loss.
    bucket: "INFO",
    responsible: "warehouse_team",
    note: "Ops sheet + Odoo (and usually DT) confirm the movement; only the gate register is missing the entry. Gate-log hygiene — remind the guard post, no stock action.",
  },
  [VARIANCE.PICKUP_ODOO_OPEN]: {
    bucket: "REAL",
    responsible: "odoo_team",
    note: "Gate register + DT confirm the pickup, but the Odoo receipt is not closed — close it today.",
  },
  [VARIANCE.REPLACEMENT_CONFIRM]: {
    bucket: "REAL",
    responsible: "warehouse_team",
    note: "The same unit came in and went out on the same SO today — confirm it is a genuine replacement, not a double-count.",
  },
  [VARIANCE.FAILED_DELIVERY]: {
    bucket: "REAL",
    responsible: "ops_team",
    note: "Marked Not Delivered on the way out but the return was never logged inward — confirm the unit is back and write it into the inward register.",
  },
  [VARIANCE.SHEET_NOT_DONE_BUT_POSTED]: {
    // The two systems flatly disagree about whether the movement happened, so
    // one of them is wrong and somebody has to say which. This is the "done in
    // one source, not done in another" case: unlike a plain failed delivery
    // (where DT/Odoo are rightly silent), here they positively posted it as
    // complete while the floor recorded it as not delivered.
    bucket: "REAL",
    responsible: "ops_team",
    note: "The ops sheet records this as Not Delivered, but DT or Odoo posted the movement as done. One of the two is wrong — check whether the unit actually went out, and correct whichever system is lying.",
  },
  [VARIANCE.ODOO_ONLY_TODAY]: {
    // Fires ONLY for customer flows (SO present, not an /INT/ internal
    // transfer) with no floor trace on this or nearby days — vendor PO receipts
    // (serialized at receipt, floor logs the truck not each serial), internal
    // transfers, and Odoo backlog entries all stay INFO (see ladder rung 9 and
    // the recent-floor gate in run.ts).
    bucket: "REAL",
    responsible: "warehouse_team",
    note: "Odoo booked this customer movement today (record created today) and no gate / ops / DT / sheet source logged it — a same-day movement the floor missed, or a phantom posting. Chase: confirm the unit physically moved and log it, or void the Odoo entry.",
  },
  // ── INFO — audit / posting-lag ─────────────────────────────────────────
  // INFO, not REAL (measured on live data): the great majority of Odoo-only
  // rows are Odoo batch-posting EARLIER days' movements (sml.date is the posting
  // timestamp, but the record's create_date predates the run day), whose floor
  // records live on the movement's own day — ops never chase these. The subset
  // whose record was CREATED today with no floor record is split off to the REAL
  // ODOO_ONLY_TODAY chase item above (see ladder rung 9). original_priority High.
  [VARIANCE.ODOO_ONLY]: {
    bucket: "INFO",
    responsible: "odoo_team",
    note: "Odoo posting today of a record created on an earlier day — a late posting of an earlier movement whose floor record lives on its own day. Audit tally, not a stock action.",
  },
  [VARIANCE.ODOO_POSTED_NEXT_DAY]: {
    bucket: "INFO",
    responsible: "odoo_team",
    note: "The floor confirmed this movement for the day, and the Odoo entry does exist — it was just posted a day late (the 1-day buffer picked it up). No action; the entry is made.",
  },
  [VARIANCE.BARCODE_OVERDUE]: {
    bucket: "REAL",
    responsible: "warehouse_team",
    note: "This item was received at the gate without a barcode and still has none after 24 hours. Until a barcode exists the unit cannot be matched to any system — assign it and scan it against the gate entry.",
  },
  [VARIANCE.ODOO_PAST_DEADLINE]: {
    bucket: "REAL",
    responsible: "odoo_team",
    note: "The floor recorded this movement and Odoo did post it — but after the deadline (3pm on the next open day). The entry exists; what failed is the timeliness the business runs on.",
  },
  [VARIANCE.SHEET_DT_ODOO_NO_GATE]: {
    bucket: "REAL",
    responsible: "warehouse_team",
    note: "The ops sheet, the delivery app and Odoo all hold this movement; the gate register has no line for it. Find out how the unit passed the gate unrecorded.",
  },
  [VARIANCE.GATE_DT_ODOO_NO_SHEET]: {
    bucket: "REAL",
    responsible: "ops_team",
    note: "The gate, the delivery app and Odoo all hold this movement; the ops sheet has no line for it. Add the line so the sheet matches what three systems already agree happened.",
  },
  [VARIANCE.ODD_HOUR_TRIP]: {
    // REAL and High (owner, 24 Sep 2026). Measured on the gate app, 1 Aug –
    // 23 Sep: 123 of 141 outward trips opened between 9am and noon and exactly
    // one ever opened after 9pm; 103 of 124 inward trips opened between 6pm
    // and 10pm and two ever opened after midnight. A movement at the wrong end
    // of the clock is rare enough to be worth a person's attention every time.
    bucket: "REAL",
    responsible: "warehouse_team",
    note: "The gate opened this trip at an hour the warehouse rarely moves stock. Confirm who authorised it.",
  },
  [VARIANCE.OT_CASE]: {
    // REAL, because somebody has to act: the transfer re-points a unit between
    // orders inside Odoo and no floor book can confirm it. Odoo team, because
    // only Odoo holds the two orders it links.
    bucket: "REAL",
    responsible: "odoo_team",
    note: "Order transfer in Odoo (Reference# OT-…) with no matching return from the old customer within a day — nothing moved through the gate. Find where the unit came from, map it, then close.",
  },
  [VARIANCE.ODOO_OUT_PENDING]: {
    // INFO, and it replaces a REAL "not in Odoo". Odoo DOES hold this dispatch —
    // an Out line reserved against the customer's sale order — and the gate or
    // DT confirms the unit left. What is outstanding is validation, which Odoo
    // does after delivery. Not a loss; listed on its own as "Items in transit"
    // so the Odoo team closes them rather than hunting for a missing unit.
    bucket: "INFO",
    responsible: "odoo_team",
    note: "The gate or DT saw this unit leave, and Odoo has its Out reserved against the sale order — it has not been validated yet. The unit is in transit; validate the Odoo Out once it is delivered.",
  },
  [VARIANCE.ODOO_POSTED_LATE]: {
    // INFO, and this one replaces a REAL. The floor's own book recorded the
    // movement and Odoo DOES hold the unit — the posting simply landed a few
    // days after the goods. Chasing "post this in Odoo" for an entry that is
    // already made is the single most common false alarm the warehouses report.
    bucket: "INFO",
    responsible: "odoo_team",
    note: "The floor recorded this movement and Odoo does have the unit — the entry was posted a few days after the goods moved, which is normal for vendor receipts. No action; the entry is made.",
  },
  // REAL since 6 Oct 2026 (owner): three books hold the unit and the Tracker
  // does not, which is the same evidence shape as the other three-book rows.
  [VARIANCE.GATE_OPS_ODOO_NO_DT]: {
    bucket: "REAL",
    // The missing thing is the DT scan, so this belongs to the delivery team —
    // it was assigned to odoo_team, which sent the chase to the one team whose
    // record is already present. OPS_ODOO_NO_DT below is the near-identical
    // case and has always said delivery_team.
    responsible: "delivery_team",
    note: "Gate register + ops sheet + Odoo all confirm the movement; only the DT scan is pending. No stock action — DT will catch up.",
  },
  [VARIANCE.OPS_DT_ODOO_PENDING]: {
    bucket: "INFO",
    responsible: "odoo_team",
    note: "Ops sheet + DT confirm the unit moved; Odoo hasn't posted yet. Expected lag, no stock action.",
  },
  // REAL since 22 Oct 2026 (owner: "it needs to be in the sources").
  //
  // It was INFO on the strength of one unmeasured line — "the ops-sheet / DT
  // gap is cosmetic" — with no date, no owner and no number behind it, unlike
  // every other rule in this file. It is also the LARGEST single group in the
  // system: 479 rows over 2-21 Oct, every one of them a unit the guard watched
  // cross the gate and Odoo posted, which the ops sheet and the delivery app
  // have never heard of. Two independent records against two silences is not
  // cosmetic, and nobody was looking at any of it.
  [VARIANCE.GATE_ODOO_NO_OPS_DT]: {
    bucket: "REAL",
    responsible: "ops_team",
    note: "The gate watched this unit move and Odoo posted it, but the ops sheet and the delivery app have no record of it. Add the sheet line and the app scan so every book carries the movement.",
  },
  [VARIANCE.FIELD_MISMATCH]: {
    bucket: "INFO",
    responsible: "ops_team",
    note: "Every source agrees the unit moved; only the barcode text differs (OCR/typo). No stock gap.",
  },
  [VARIANCE.DUPLICATE]: {
    bucket: "INFO",
    responsible: "ops_team",
    note: "Same barcode logged twice within one source — de-duplicate the entry.",
  },
  [VARIANCE.OPS_ODOO_NO_DT]: {
    bucket: "INFO",
    responsible: "delivery_team",
    note: "Ops sheet + Odoo both confirm the movement; only DT has no scan. DT hygiene, no stock gap.",
  },
  [VARIANCE.ADJACENT_DAY]: {
    bucket: "INFO",
    responsible: "ops_team",
    note: "This unit's movement is recorded across the floor systems on a NEARBY day — this row is a date misalignment (register page spanning days, or a late write-up), not a missing entry. No action.",
  },
  [VARIANCE.DT_ODOO_NO_SHEET]: {
    bucket: "INFO",
    responsible: "ops_team",
    note: "DT + Odoo both confirm the movement; the ops sheet entry is missing. Update the sheet, no stock gap.",
  },
};

function metaFor(name: string): VarianceMeta {
  return (
    VARIANCE_META[name] ?? {
      bucket: "INFO",
      responsible: "ops_team",
      note: "Flagged for review.",
    }
  );
}

// Apply metadata + REAL/INFO relabel to a freshly-classified row.
//
// `reported` is omitted from the input and the output: it is which SOURCES ran
// for the whole city, identical for every row of a run, so requiring it here
// would be five copies of one value. runReconciliation stamps it once over the
// finished list instead — and because CityRunResult.variances is the full
// VarianceRowOut[], the only way to satisfy that type is to have stamped it.
// The compiler enforces the stamp happened.
//
// `present` is the opposite case — per row — so it stays required, which is
// what makes every construction site a build error until it supplies one.
/**
 * HOW URGENT A CHASE ITEM IS — ordered by how many books are SHORT of the unit.
 *
 * Owner's rule, 22 Oct 2026. The fewer books that agree, the less certain
 * anybody is that the unit is where the paperwork says. One book claiming a
 * movement three others never saw is the alarming case; three books agreeing
 * with one gap is a record to fix.
 *
 * WHAT THIS REPLACED was not a worse ordering, it was no ordering at all.
 * Measured 2-21 Oct, the chase list ran in a U: 359 rows where THREE books were
 * short, 23 where TWO were, 419 where ONE was. The middle band — 936 further
 * rows, the largest single group in the system — sat filed as "no action
 * needed". Nobody designed that; it is what a year of adding one rule at a time
 * produces, and the gap it left was the 479 rows reading "the gate and Odoo
 * both have this unit, the sheet and the tracker have never heard of it".
 *
 * THREE LEVELS, BECAUSE THE COLUMN HAS THREE. priority_rank (migration 0011) is
 * generated from this word: High 0, Medium 1, Info 2. "Info" is the whole
 * product's word for "nothing to do", so it is never put on a chase item — the
 * two most uncertain bands take High and Medium and the certain one shares
 * Medium. Separating those two needs a fourth word and a migration; it is a
 * refinement, not the point of the change.
 *
 * MISMATCHES ARE NOT RANKED LAST. Several of them are the most urgent thing in
 * the system: a wrong unit scanned means two customers hold each other's
 * furniture, and a unit with no barcode after 24 hours is physically present
 * and invisible to every system. They are placed on what they mean, not on the
 * fact that they are not an absence.
 */
const CHASE_PRIORITY: Record<string, Priority> = {
  // THREE BOOKS SHORT — one record, nothing corroborating it.
  [VARIANCE.GATE_ONLY]: "High",
  [VARIANCE.SHEET_ONLY]: "High",
  [VARIANCE.DT_ONLY]: "High",
  [VARIANCE.ODOO_ONLY_TODAY]: "High",

  // TWO BOOKS SHORT — two say it moved, two never saw it.
  [VARIANCE.GATE_OPS_NO_DT_ODOO]: "Medium",
  [VARIANCE.PICKUP_ODOO_OPEN]: "Medium",
  [VARIANCE.GATE_ODOO_NO_OPS_DT]: "Medium",

  // ONE BOOK SHORT — three agree, so the movement is not in doubt and the gap
  // is a record somebody owns.
  [VARIANCE.FLOOR_DT_NOT_ODOO]: "Medium",
  [VARIANCE.GATE_OPS_ODOO_NO_DT]: "Medium",
  [VARIANCE.SHEET_DT_ODOO_NO_GATE]: "Medium",
  [VARIANCE.GATE_DT_ODOO_NO_SHEET]: "Medium",

  // NOT ABSENCES. Placed on what each one means.
  [VARIANCE.WRONG_SCAN]: "High",          // two units now on each other's records
  [VARIANCE.BARCODE_OVERDUE]: "High",     // on the floor, invisible to everything
  [VARIANCE.FAILED_DELIVERY]: "High",     // left the building, nothing says it returned
  [VARIANCE.SHEET_NOT_DONE_BUT_POSTED]: "High", // two books flatly contradict each other
  [VARIANCE.REPLACEMENT_CONFIRM]: "High", // a swap, or the same movement counted twice
  [VARIANCE.ODD_HOUR_TRIP]: "High",       // who authorised a van at 3am
  [VARIANCE.OT_CASE]: "Medium",           // bookkeeping, but only a person can map it
  [VARIANCE.ODOO_PAST_DEADLINE]: "Medium",// the entry EXISTS; the deadline was missed
};

export function applyBucket(
  row: Omit<VarianceRowOut, "bucket" | "responsible" | "note" | "reported"> & {
    note?: string;
    responsible?: string;
  }
): Omit<VarianceRowOut, "reported"> {
  const meta = metaFor(row.variance_name);
  const naturalPriority: Priority = row.priority;

  if (meta.bucket === "INFO") {
    return {
      ...row,
      bucket: "INFO",
      priority: "Info",
      original_priority: naturalPriority,
      dampened: true,
      responsible: row.responsible ?? meta.responsible,
      note: row.note ?? meta.note,
    };
  }

  return {
    ...row,
    // Ordered by how many books are short — see CHASE_PRIORITY. Falls back to
    // whatever the ladder decided for any name not listed there, so a new
    // variance is never silently ranked by omission.
    bucket: "REAL",
    priority: CHASE_PRIORITY[row.variance_name] ?? naturalPriority,
    responsible: row.responsible ?? meta.responsible,
    note: row.note ?? meta.note,
  };
}

/**
 * The priority a chase item SHOULD carry, given which books reported.
 *
 * CHASE_PRIORITY ranks by how many books a name says are short — but the name
 * is chosen before anyone asks whether every book it accuses actually filed.
 * Four of five cities have had no gate book since August, so "Only MS has it"
 * there means MS has it and DT and Odoo do not: TWO books short, not three.
 * Measured 23 Oct 2026: 1,424 open rows graded High on a book that never
 * reported (rule 16 — a book that did not report is never blamed — applied to
 * the ranking as well as the wording).
 *
 * Books short = the name's absence claim ∩ the books that reported. Three is
 * High, one or two is Medium; a name with no testable claim keeps its rank.
 *
 * ONE DEFINITION, read by the engine when it stamps a row AND by the nightly
 * integrity check, so the two cannot drift (the 0051 regrade did, by reading
 * grading from the name alone).
 */
export function chasePriority(
  varianceName: string,
  reported: { P: boolean; S: boolean; D: boolean; O: boolean },
  fallback: Priority = "High"
): { bucket: "REAL" | "INFO"; priority: Priority } {
  const meta = metaFor(varianceName);
  if (meta.bucket === "INFO") return { bucket: "INFO", priority: "Info" };
  const base = CHASE_PRIORITY[varianceName] ?? fallback;
  const claim = absenceClaim(varianceName);
  if (claim.length === 0) return { bucket: "REAL", priority: base };
  const short = claim.filter((k) => reported[k]).length;
  if (short === 0) return { bucket: "REAL", priority: base };
  return { bucket: "REAL", priority: short >= 3 ? "High" : "Medium" };
}

