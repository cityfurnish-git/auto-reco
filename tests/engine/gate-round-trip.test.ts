// A unit the guard scanned out and back in on the same day, with no other book
// involved.
//
// Owner's rule, 22 Oct 2026: "if a stock movement passes through guard but not
// other sources, it should be flagged as a variance if the movement is not
// mapped or found in the inward as well as outward of guard data; if the item
// goes out and comes back on the same day in guard's data, then it should not
// be marked as variance."
//
// Nothing left the site on balance, so there is no order, no delivery job and
// no stock move to find — the other three books being silent is correct rather
// than a gap.
//
// Measured 2-21 Oct: 5 of the 22 "only the gate log has it" rows are this
// shape. The other 17 have a single leg and keep their place at the top of the
// queue, which is where a unit nobody but the guard saw belongs.

import { describe, it, expect } from "vitest";
import { runReconciliation } from "../../lib/engine/run";
import { VARIANCE } from "../../lib/engine/variance-names";
import type { SourceRow } from "../../lib/engine/types";

const D = "2026-10-20";
const BC = "FUM3XJ22086103";

const gate = (direction: "IN" | "OUT", barcode = BC): SourceRow => ({
  source: "PHYSICAL", direction, barcode, status: "done", date: D,
});
const typed = (
  source: SourceRow["source"],
  direction: "IN" | "OUT",
  barcode = BC
): SourceRow => ({
  source, direction, barcode, status: "done", date: D, createdOn: D,
  soNumber: "ON-RET-GUR-90210",
});

const run = (rows: SourceRow[]) => runReconciliation(rows, "DELHI", undefined, new Set(), D);
const forUnit = (res: ReturnType<typeof run>, bc = BC) =>
  res.variances.filter((v) => v.barcode_display === bc);

describe("the guard saw it leave and come back", () => {
  it("raises nothing when the gate has both legs and no other book has it", () => {
    const res = run([gate("OUT"), gate("IN")]);
    expect(forUnit(res)).toHaveLength(0);
    expect(res.warnings.join(" ")).toContain("out and back in on the same day");
  });

  // A single leg is the alarming case the rule deliberately leaves alone: one
  // book claims a movement three others never saw, and it stays High.
  it("still raises when the guard saw it leave and never come back", () => {
    const res = run([gate("OUT")]);
    const hit = forUnit(res).find((v) => v.variance_name === VARIANCE.GATE_ONLY);
    expect(hit).toBeDefined();
    expect(hit!.priority).toBe("High");
  });

  it("still raises when the guard saw it arrive and never leave", () => {
    const res = run([gate("IN")]);
    expect(forUnit(res).map((v) => v.variance_name)).toContain(VARIANCE.GATE_ONLY);
  });

  // THE POINT IS THE SILENCE, NOT THE ROUND TRIP. A unit a typed system also
  // holds has orders and stock moves to reconcile, so it grades as it always
  // did — otherwise this rule would quietly hide every same-day replacement.
  it("does not silence a round trip that another book also recorded", () => {
    const res = run([gate("OUT"), gate("IN"), typed("SHEET", "OUT"), typed("SHEET", "IN")]);
    expect(forUnit(res).length).toBeGreaterThan(0);
  });

  it("leaves an ordinary one-way gate movement with other books alone", () => {
    const res = run([gate("OUT"), typed("SHEET", "OUT"), typed("DT", "OUT"), typed("ODOO", "OUT")]);
    expect(res.warnings.join(" ")).not.toContain("out and back in on the same day");
  });
});

describe("gate and Odoo hold it, the sheet and the tracker do not", () => {
  // Owner, 22 Oct 2026: "flag it as a real variance, it needs to be in the
  // sources." It had been informational on one unmeasured line, and is the
  // largest single group in the system — 479 rows over 2-21 Oct.
  it("is a chase item, not an audit note", () => {
    const res = run([gate("OUT"), typed("ODOO", "OUT")]);
    const hit = forUnit(res).find((v) => v.variance_name === VARIANCE.GATE_ODOO_NO_OPS_DT);
    expect(hit).toBeDefined();
    expect(hit!.bucket).toBe("REAL");
    // Two books short: ranked below a unit only ONE book saw, above nothing.
    expect(hit!.priority).toBe("Medium");
  });
});
