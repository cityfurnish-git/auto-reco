// Whether a warehouse worked a day, judged on what its floor actually did.
//
// Owner, 22 Oct 2026: "take this status for any warehouse operating on a day or
// not from the DT, and not our set days — lately the ops are a little volatile,
// warehouses are operating without a proper structure."
//
// Measured 1-21 Oct, 105 city-days: the configured calendar and the floor
// disagreed on twelve. Four cities ran a full Thursday on 1 Oct that the
// calendar called a day off.
//
// The rule moves the answer ONE WAY: volume proves a day was worked, silence
// proves nothing. The engine cannot tell an empty book from an unread one —
// `reported` means "connector ok AND at least one row" — and across the same
// three weeks the twelve genuinely silent city-days produced 3 REAL rows and 0
// chase items between them. See isCityClosed's header.

import { describe, it, expect } from "vitest";
import {
  floorRowsOf,
  isCityClosed,
  OPEN_DAY_MIN_ROWS,
  type ClosureCalendar,
} from "../../lib/engine/schedule";
import { runReconciliation } from "../../lib/engine/run";
import type { SourceRow } from "../../lib/engine/types";

const THURSDAY = "2026-10-01"; // a configured day off for four cities
const TUESDAY = "2026-10-20"; // a configured working day the floor spent silent

/** The delivery app's calendar as it actually stands: Thursday off. */
const CAL: ClosureCalendar = {
  weeklyOff: { DELHI: [4], MUMBAI: [4], PUNE: [4], HYDERABAD: [4] },
  // 2 Oct was a declared holiday in every city.
  holidays: { DELHI: ["2026-10-02"], MUMBAI: ["2026-10-02"], PUNE: ["2026-10-02"], HYDERABAD: ["2026-10-02"] },
} as ClosureCalendar;

const busy = (rows: number) => ({ rows });

describe("a day the calendar calls closed", () => {
  it("is open when the floor plainly worked it", () => {
    // 1 Oct, Delhi: 154 tracker, 172 sheet, 153 gate.
    expect(isCityClosed("DELHI", THURSDAY, CAL, busy(479))).toBe(false);
  });

  // THE CASE THE TRACKER ALONE WOULD HAVE GOT WRONG, and the reason this reads
  // every floor book: 8 Oct Delhi held 2 tracker rows and 300 ops-sheet rows.
  it("is open on the ops sheet alone", () => {
    expect(isCityClosed("DELHI", "2026-10-08", CAL, busy(302))).toBe(false);
  });

  // ONE STRAGGLER IS NOT A VERDICT. Mumbai filed exactly one tracker row on the
  // 2 Oct holiday. Too little to call the day worked — so the calendar answers,
  // and the calendar says holiday.
  it("defers to the calendar when one straggler is all there is", () => {
    expect(isCityClosed("MUMBAI", "2026-10-02", CAL, busy(1))).toBe(true);
  });

  it("draws the line at the threshold", () => {
    expect(isCityClosed("DELHI", THURSDAY, CAL, busy(OPEN_DAY_MIN_ROWS - 1))).toBe(true);
    expect(isCityClosed("DELHI", THURSDAY, CAL, busy(OPEN_DAY_MIN_ROWS))).toBe(false);
  });

  it("stays closed when the floor filed nothing", () => {
    expect(isCityClosed("DELHI", THURSDAY, CAL, busy(0))).toBe(true);
  });
});

describe("a day the calendar calls open", () => {
  // AN OUTAGE IS NEVER A CLOSURE — the safeguard that matters most, and here it
  // is structural rather than a guard clause. The Tracker was unreachable for
  // twenty days this month; silence cannot close a day, so those twenty days
  // cannot read as closures however the connectors behaved.
  it("stays open however silent the floor was", () => {
    expect(isCityClosed("DELHI", TUESDAY, CAL, busy(0))).toBe(false);
    expect(isCityClosed("DELHI", TUESDAY, CAL, busy(2))).toBe(false);
  });

  it("is open on an ordinary working day", () => {
    expect(isCityClosed("DELHI", "2026-10-19", CAL, busy(265))).toBe(false);
  });
});

describe("a day nobody can observe yet", () => {
  // What the Odoo deadline asks about: the NEXT open day, which has not
  // happened. There is nothing to observe, so the calendar still answers.
  it("falls back to the calendar", () => {
    expect(isCityClosed("DELHI", THURSDAY, CAL)).toBe(true);
    expect(isCityClosed("BANGALORE", THURSDAY, CAL)).toBe(false); // never off
  });
});

// ─── through the engine ──────────────────────────────────────────────────────

describe("the run itself", () => {
  const THU = "2026-10-01";
  const CLOSED: ClosureCalendar = { weeklyOff: { DELHI: [4] }, holidays: {} };
  const sheetRow = (barcode: string): SourceRow => ({
    source: "SHEET", direction: "OUT", barcode, status: "done", date: THU,
    createdOn: THU, soNumber: "ON-RET-GUR-90001",
  });
  // Six units on a day the calendar calls shut: above the threshold, so the day
  // grades as worked and the off-day suppression must not apply.
  const worked = Array.from({ length: 6 }, (_, i) => sheetRow(`FUMYGB2212006${i}`));

  const offDayNoted = (w: string[]) => w.some((s) => /weekly off/i.test(s));

  it("reads a worked-through closure as a working day, and says so", () => {
    const res = runReconciliation(
      worked, "DELHI", undefined, new Set(), THU, new Set(), new Set(), CLOSED
    );
    expect(offDayNoted(res.warnings)).toBe(false);
    expect(res.warnings.join(" ")).toContain("configured closed on 2026-10-01");
    expect(res.warnings.join(" ")).toContain("6 rows");
  });

  it("leaves a genuinely quiet closure alone", () => {
    const res = runReconciliation(
      [worked[0]], "DELHI", undefined, new Set(), THU, new Set(), new Set(), CLOSED
    );
    expect(offDayNoted(res.warnings)).toBe(true);
    expect(res.warnings.join(" ")).not.toContain("read as a working day");
  });
});

// ─── one reading of the day, everywhere ──────────────────────────────────────

describe("floorRowsOf", () => {
  // The dashboards' OFF badge, the digest's "off" label and the engine all have
  // to answer the same way, or the board calls a warehouse shut on a day the
  // engine graded as working.
  it("adds up every floor book, both directions", () => {
    expect(
      floorRowsOf({
        gate: { in: 70, out: 83 },
        sheet: { in: 80, out: 92 },
        dt: { in: 74, out: 80 },
      }).rows
    ).toBe(479); // 1 Oct 2026, Delhi
  });

  // ODOO IS NOT A FLOOR BOOK. It posts from the office, often the next morning,
  // so its rows say nothing about whether the warehouse opened.
  it("ignores anything that is not a floor book", () => {
    expect(floorRowsOf({ gate: { in: 2, out: 3 } } as never).rows).toBe(5);
  });

  it("treats a missing or null count as zero, not as a crash", () => {
    expect(floorRowsOf({}).rows).toBe(0);
    expect(floorRowsOf({ sheet: { in: null, out: 4 } }).rows).toBe(4);
    expect(floorRowsOf({ dt: { in: Number.NaN, out: 6 } }).rows).toBe(6);
  });
});
