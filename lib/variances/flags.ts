// Flags on a variance: a known, usually harmless reason a book is missing it.
//
// Owner's decision, 18 Sep 2026: a variance with a known reason stays on the
// list — it is still a real disagreement between the books — but carries a
// label saying why, the way OT CASE does. Nothing here hides or closes a row.
//
// Worked out when the rows are READ, not stored by the run, on purpose:
// ODOO PENDING is about the clock, not the data — it must disappear on its own
// the moment Odoo's window shuts, without waiting for a re-run. The other three
// are cheap lookups against rows the run already stored, and a new column
// would need a hand-applied migration for no gain.
//
//   ODOO PENDING     Odoo lacks it, and Odoo's window for the day (3pm on the
//                    next open day) has not shut yet.
//   VENDOR RECEIPT   a vendor / PO inward the Delivery Tracker lacks — vendor
//                    receipts never pass through the tracker.
//   NOT DELIVERED    an outward the sheet marks "Not Delivered" or the tracker
//                    marks "Not Done": it went out and came back.
//   GUARD OFF-SHIFT  Guard Check lacks it and NO guard was signed in at that
//                    city's gate at any time that day (owner chose this strict
//                    rule, "A", over matching movement times to shifts: no book
//                    records when a unit crossed the gate precisely enough).
//                    Only for cities on the gate app — a paper register has no
//                    sign-ins, and every row there would be wrongly flagged.

import { isCityClosed, type ClosureCalendar } from "../engine/schedule";
import { addDays } from "../engine/dates";
import { usesCalendarDay } from "../connectors/ist-window";
import type { City } from "../sample-data";

export const FLAG = {
  ODOO_PENDING: "ODOO PENDING",
  VENDOR_RECEIPT: "VENDOR RECEIPT",
  NOT_DELIVERED: "NOT DELIVERED",
  GUARD_OFF_SHIFT: "GUARD OFF-SHIFT",
  ATTEMPT_LATER: "ATTEMPT — COMPLETED LATER",
} as const;
export type VarianceFlag = (typeof FLAG)[keyof typeof FLAG];

export const FLAG_HINT: Record<VarianceFlag, string> = {
  "ODOO PENDING": "Odoo's window for this day is still open (3pm on the next day the warehouse opens) — the entry may still be posted.",
  "VENDOR RECEIPT": "A vendor / PO receipt. These never go through the Delivery Tracker, so its absence there is expected.",
  "NOT DELIVERED": "The sheet says Not Delivered or the tracker says Not Done — the goods went out and came back.",
  "GUARD OFF-SHIFT": "No guard was signed in at this gate at any time that day, so Guard Check could not record it.",
  "ATTEMPT — COMPLETED LATER": "The Delivery Tracker recorded an attempt on this day and closed the job on a later date — often a van that went out and came back empty. It is the only book claiming this movement today.",
};

export interface FlagInput {
  direction: string;
  job_type: string | null;
  present_p?: boolean;
  present_s?: boolean;
  present_d?: boolean;
  present_o?: boolean;
}

export interface FlagContext {
  /** When Odoo's window for this city and day shuts (ms), or null if not a calendar-day run. */
  odooWindowEndMs: number | null;
  nowMs: number;
  /** Was any guard signed in that day? null = the city is not on the gate app. */
  guardOnDuty: boolean | null;
  /** The sheet or the tracker says this outward unit was not delivered. */
  notDelivered: boolean;
  /**
   * The Tracker's row for this unit and day says the job finished on a LATER
   * date — an attempt, not a completion.
   *
   * WHY THIS IS A LABEL AND NOT A RULE (owner, 29 Sep 2026). The Tracker keeps
   * one row per job, so a van that goes out on Saturday and succeeds on Monday
   * leaves one row reading "finished Monday" either way. Two pickups on 26 Sep
   * were identical in it — same created date, same later completion — and only
   * the gate knew that one fridge was collected that evening and the other two
   * days later. Measured over 20–28 Sep: 434 inward rows look like this, and
   * 387 of them were confirmed that day by the gate, the sheet or Odoo. A rule
   * that dropped them would fix 47 and break 387, so the row stays and says so.
   */
  attemptCompletedLater: boolean;
}

/** Pure: which flags a variance row carries. */
export function flagsFor(v: FlagInput, ctx: FlagContext): VarianceFlag[] {
  const out: VarianceFlag[] = [];
  if (v.present_o === false && ctx.odooWindowEndMs !== null && ctx.nowMs < ctx.odooWindowEndMs) {
    out.push(FLAG.ODOO_PENDING);
  }
  if (v.direction === "IN" && v.present_d === false && isVendorJob(v.job_type)) {
    out.push(FLAG.VENDOR_RECEIPT);
  }
  if (v.direction === "OUT" && ctx.notDelivered) out.push(FLAG.NOT_DELIVERED);
  if (v.present_p === false && ctx.guardOnDuty === false) out.push(FLAG.GUARD_OFF_SHIFT);
  // ONLY WHERE IT EXPLAINS SOMETHING: the Tracker alone has the unit. Where
  // the gate, the sheet or Odoo also recorded it that day, the movement is not
  // in doubt and the label is noise — 45 rows a day rather than 5 when it fired
  // on every row whose job happened to close later.
  if (
    ctx.attemptCompletedLater &&
    v.present_d === true && v.present_p === false && v.present_s === false && v.present_o === false
  ) {
    out.push(FLAG.ATTEMPT_LATER);
  }
  return out;
}

/** PO_INWARD is how every source's "PO inward" / vendor job type is normalised. */
export function isVendorJob(jobType: string | null | undefined): boolean {
  const j = (jobType ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  // Not every "PO_…": "PO Payment" is a money job, not a receipt.
  return j === "PO_INWARD" || j.includes("VENDOR");
}

/** When Odoo's window for (city, day) shuts: 3pm IST on the next open day. */
export function odooWindowEnd(city: string, day: string, cal: ClosureCalendar | null): number | null {
  if (!usesCalendarDay(day)) return null;
  let d = addDays(day, 1);
  for (let i = 0; i < 7 && isCityClosed(city as City, d, cal); i++) d = addDays(d, 1);
  return Date.parse(`${d}T15:00:00+05:30`);
}
