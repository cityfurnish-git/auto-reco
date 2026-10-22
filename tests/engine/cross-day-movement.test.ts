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

  // BOTH FLOOR BOOKS SAW IT GO AND COME BACK (owner, 22 Oct 2026), so there is
  // nothing for a person to confirm — the swap is documented twice over.
  // Measured over 2-21 Oct: 22 of 66 such rows stand down on this.
  it("stands down when the gate AND the sheet both hold both legs", () => {
    const res = run([
      sameDay("OUT", "PHYSICAL"), sameDay("OUT", "SHEET"),
      sameDay("IN", "PHYSICAL"), sameDay("IN", "SHEET"),
    ]);
    expect(crossRows(res)).toHaveLength(0);
  });

  it("is still raised when the sheet has both legs but the gate saw only one", () => {
    const res = run([
      sameDay("OUT", "PHYSICAL"), sameDay("OUT", "SHEET"),
      sameDay("IN", "SHEET"),
    ]);
    expect(crossRows(res)).toHaveLength(1);
  });

  // SUPERSEDED BY A LATER RULE (owner, 22 Oct 2026), and the two must not be
  // confused. This case — the gate holding both legs and NO other book holding
  // the unit at all — is now suppressed upstream by the gate round-trip rule in
  // run.ts: nothing left the site on balance, so there is no order, no delivery
  // job and no stock move for anybody to confirm. See gate-round-trip.test.ts.
  //
  // The swap rule below is still what decides the cases where another book IS
  // involved, which is why that test sits immediately after this one.
  it("raises nothing when the gate alone holds both legs and no other book has it", () => {
    const res = run([
      sameDay("OUT", "PHYSICAL"), sameDay("IN", "PHYSICAL"),
    ]);
    expect(crossRows(res)).toHaveLength(0);
  });

  it("is still raised when the gate has both legs and another book is involved", () => {
    const res = run([
      sameDay("OUT", "PHYSICAL"), sameDay("IN", "PHYSICAL"), sameDay("OUT", "DT"),
    ]);
    expect(crossRows(res)).toHaveLength(1);
  });

  // THE CLAUSE THAT MAKES THE RULE WORK AT ALL. 64 of those 66 rows fall in
  // cities with no gate book, so requiring both gate legs everywhere suppressed
  // nothing. Where the gate did not file, the sheet's two legs are the whole
  // of the evidence and they are enough.
  it("stands down on the sheet alone in a city whose gate did not report", () => {
    const res = runReconciliation(
      [sameDay("OUT", "SHEET"), sameDay("IN", "SHEET")],
      "MUMBAI",
      { P: false, S: true, D: true, O: true },
      new Set(),
      D
    );
    expect(res.variances.filter((v) => v.variance_name === VARIANCE.REPLACEMENT_CONFIRM)).toHaveLength(0);
  });
});
