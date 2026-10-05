// A delivery that failed and came home is not a variance. One that failed and
// never came home is.
//
// Owner's rule, 21 Sep 2026, from fridge APZQN422041372 on the 18th: the guard
// scanned it out at 09:48 and back at 20:14, the sheet read "Not Delievered"
// outward and "Received" inward, and the Tracker held one row saying Not Done.
// The tool raised two urgent variances telling ops to post it to Odoo — which
// would have been wrong, because no delivery happened.
//
// WIDENED 5 OCT 2026, by the same owner. The rule used to ALSO require one
// Tracker row saying Not Done (or completed on a later day); it now judges a
// failed delivery on the two books that witness the yard — the gate register
// and the ops sheet — and asks only whether both legs are there. The Tracker
// keeps one rewritten row per job and is the least reliable witness to a
// same-day return, which is what made that condition worth dropping.
//
// AND THE ONE-WAY CASE IS RAISED AGAIN. A unit the sheet dispatched and marked
// Not Delivered with NO return in either book had been silently dropped since
// FAILED_DELIVERY was retired on 5 Aug. That retirement removed an honest
// finding along with the false ones: the unit left the building and no book
// says it came back.

import { describe, it, expect } from "vitest";
import { runReconciliation } from "../../lib/engine/run";
import { VARIANCE } from "../../lib/engine/variance-names";
import type { SourceRow } from "../../lib/engine/types";

const D = "2026-09-18";
const BC = "APZQN422041372";

const gate = (direction: "IN" | "OUT", barcode = BC): SourceRow => ({
  source: "PHYSICAL", direction, barcode, status: "done", date: D,
});
const sheet = (direction: "IN" | "OUT", status: string, barcode = BC): SourceRow => ({
  source: "SHEET", direction, barcode, status, date: D,
  soNumber: "ON-RET-GUR-74953", ticketId: "1223452", customer: "BHARANI DHARAN",
});
const dt = (physicalStatus: string, barcode = BC): SourceRow => ({
  source: "DT", direction: "OUT", barcode, status: "done", physicalStatus, date: D,
  soNumber: "ON-RET-GUR-74953", ticketId: "1223452",
});

const run = (rows: SourceRow[]) => runReconciliation(rows, "DELHI", undefined, new Set(), D);
const forUnit = (res: ReturnType<typeof run>) => res.variances.filter((v) => v.barcode_display === BC);
const names = (res: ReturnType<typeof run>) => forUnit(res).map((v) => v.variance_name);

/** Both legs in both books — the shape that means "out and back". */
const outAndBack = (): SourceRow[] => [
  gate("OUT"), gate("IN"),
  // The sheet's own misspelling, as Delhi writes it.
  sheet("OUT", "Not Delievered"), sheet("IN", "Received"),
];

describe("not delivered — out and back", () => {
  it("raises nothing when the gate and the sheet both have both legs", () => {
    const res = run([...outAndBack(), dt("Not Done")]);
    expect(forUnit(res)).toHaveLength(0);
    expect(res.warnings.join(" ")).toContain("went out and came back the same day");
  });

  // The three Tracker shapes that used to decide this, and no longer do. The
  // gate and the sheet already agree the unit left and returned; the Tracker's
  // one rewritten row cannot overturn two books that watched it happen.
  it("raises nothing whatever the tracker says — done today", () => {
    const res = run([...outAndBack(), { ...dt("Done"), movementDate: `${D}T14:10:00.000Z` }]);
    expect(forUnit(res)).toHaveLength(0);
  });

  it("raises nothing whatever the tracker says — completed on an earlier day", () => {
    const res = run([...outAndBack(), { ...dt("Done"), movementDate: "2026-09-15T10:00:00.000Z" }]);
    expect(forUnit(res)).toHaveLength(0);
  });

  it("raises nothing whatever the tracker says — no tracker row at all", () => {
    const res = run(outAndBack());
    expect(forUnit(res)).toHaveLength(0);
  });

  it("leaves an ordinary dispatch alone", () => {
    const res = run([gate("OUT"), sheet("OUT", "Delievered"), dt("Done")]);
    expect(res.warnings.join(" ")).not.toContain("went out and came back the same day");
  });
});

describe("not delivered — no return in either book", () => {
  it("raises a failed delivery when nothing recorded the unit coming back", () => {
    const res = run([gate("OUT"), sheet("OUT", "Not Delievered")]);
    expect(names(res)).toContain(VARIANCE.FAILED_DELIVERY);
    const row = forUnit(res).find((v) => v.variance_name === VARIANCE.FAILED_DELIVERY)!;
    expect(row.direction).toBe("OUT");
    expect(row.bucket).toBe("REAL");
    expect(row.priority).toBe("High");
    // The sheet's identifying fields reach the row: it is the book that
    // recorded the dispatch, and a chase needs the order and the customer.
    expect(row.so_number).toBe("ON-RET-GUR-74953");
    expect(row.customer).toBe("BHARANI DHARAN");
    expect(res.warnings.join(" ")).toContain("no return logged in either book");
  });

  it("raises it with no gate book at all — the sheet alone is enough to say it left", () => {
    const res = run([sheet("OUT", "Not Delievered")]);
    expect(names(res)).toContain(VARIANCE.FAILED_DELIVERY);
  });

  // THE MIDDLE BAND, left exactly as it was. Four of five cities have had no
  // gate book since August, so "no return logged" against a sheet that plainly
  // logged one would be a false accusation about twenty times a day — the same
  // false-chase class the 5 Aug return-leg rule was written to kill.
  it("says nothing new when the sheet logged the return but the gate did not", () => {
    const res = run([gate("OUT"), sheet("OUT", "Not Delievered"), sheet("IN", "Received")]);
    expect(names(res)).not.toContain(VARIANCE.FAILED_DELIVERY);
  });

  it("does not raise when the gate saw it come back", () => {
    const res = run([gate("OUT"), gate("IN"), sheet("OUT", "Not Delievered")]);
    expect(names(res)).not.toContain(VARIANCE.FAILED_DELIVERY);
  });

  // Two ops lines for one unit, one of them a completion claim. Ambiguous, and
  // ambiguity must not be read as failure in EITHER direction — neither
  // suppressed as a return nor raised as a loss.
  it("stands down when the sheet also claims the dispatch was delivered", () => {
    const res = run([gate("OUT"), sheet("OUT", "Not Delievered"), sheet("OUT", "Delievered")]);
    expect(names(res)).not.toContain(VARIANCE.FAILED_DELIVERY);
  });
});
