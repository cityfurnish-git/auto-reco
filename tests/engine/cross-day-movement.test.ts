// "Same unit in and out today" needs both legs to have moved TODAY.
//
// Odoo is pulled a day either side so a late posting can be matched to the day
// the goods moved, and those neighbouring rows build views like any other.
// Fridge FUUMPC24121005 (owner, 30 Sep 2026) went out on the 27th and came back
// on the 29th; both Odoo postings landed in the 28th's raw feed under one sale
// order, and the pair was raised as an urgent same-day replacement on a day the
// unit never moved.

import { describe, it, expect } from "vitest";
import { runReconciliation } from "../../lib/engine/run";
import { VARIANCE } from "../../lib/engine/variance-names";
import type { SourceRow } from "../../lib/engine/types";

const D = "2026-09-28";
const SO = "ON-RET-GUR-81950";
const BC = "FUUMPC24121005";

/** An Odoo line posted on a NEIGHBOURING day, as the ±1 pull returns them. */
const odooNeighbour = (direction: "IN" | "OUT", postedOn: string): SourceRow => ({
  source: "ODOO", direction, barcode: BC, status: "done", date: D,
  createdOn: postedOn, soNumber: SO, jobType: "new",
});
const sameDay = (direction: "IN" | "OUT", src: SourceRow["source"]): SourceRow => ({
  source: src, direction, barcode: BC, status: "done", date: D,
  createdOn: D, soNumber: SO, jobType: "new",
});

const run = (rows: SourceRow[]) => runReconciliation(rows, "DELHI", undefined, new Set(), D);
const crossRows = (r: ReturnType<typeof run>) =>
  r.variances.filter((v) => v.variance_name === VARIANCE.REPLACEMENT_CONFIRM);

describe("same unit in and out today", () => {
  it("is not raised when both legs are neighbouring-day Odoo postings", () => {
    const res = run([odooNeighbour("OUT", "2026-09-27"), odooNeighbour("IN", "2026-09-29")]);
    expect(crossRows(res)).toHaveLength(0);
  });

  it("is not raised when only one leg moved today", () => {
    const res = run([sameDay("OUT", "PHYSICAL"), odooNeighbour("IN", "2026-09-29")]);
    expect(crossRows(res)).toHaveLength(0);
  });

  it("is still raised when both legs moved today", () => {
    const res = run([
      sameDay("OUT", "PHYSICAL"), sameDay("OUT", "SHEET"),
      sameDay("IN", "PHYSICAL"), sameDay("IN", "SHEET"),
    ]);
    expect(crossRows(res)).toHaveLength(1);
  });
});
