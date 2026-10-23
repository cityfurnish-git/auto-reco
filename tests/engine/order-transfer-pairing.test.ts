// Order transfers — chase only an incomplete pair (owner, 23 Oct 2026).
//
// Odoo writes a transfer as the old customer's IN and the new order's OUT a
// minute apart; together they are paperwork. Shapes below are taken from live
// Odoo: APC7VY19031375 (PUN, 20 Oct 2026) IN on ON-RET-PUN-29566 at 10:25:53Z,
// OUT on OT-20261017-616707 at 10:27:53Z.

import { describe, it, expect } from "vitest";
import { runReconciliation } from "../../lib/engine/run";
import { pairOrderTransfers } from "../../lib/engine/order-transfer";
import { VARIANCE } from "../../lib/engine/variance-names";
import type { SourceRow } from "../../lib/engine/types";

const D = "2026-10-20";
const odoo = (direction: "IN" | "OUT", barcode: string, at: string, extra: Partial<SourceRow> = {}): SourceRow => ({
  source: "ODOO", direction, barcode, status: "done", date: D, createdOn: D,
  recordCreatedOn: D, movementDate: at, ...extra,
});
const floor = (source: SourceRow["source"], direction: "IN" | "OUT", barcode: string): SourceRow => ({
  source, direction, barcode, status: "done", date: D,
});
const OT = { orderTransferRef: "OT-20261017-616707", soNumber: "ON-RET-PUN-71755" };
const run = (rows: SourceRow[]) => runReconciliation(rows, "PUNE", undefined, new Set(), D);
const forUnit = (res: ReturnType<typeof run>, bc: string) =>
  res.variances.filter((v) => v.barcode_display === bc);

// Something for the floor to have filed, so the run is not empty.
const busy = [floor("SHEET", "OUT", "FUMYSU23010016"), floor("DT", "OUT", "FUMYSU23010016"),
  odoo("OUT", "FUMYSU23010016", "2026-10-20T06:00:00Z")];

describe("a complete transfer — old customer in, new order out", () => {
  const res = run([
    ...busy,
    odoo("IN", "APC7VY19031375", "2026-10-20T10:25:53Z", { soNumber: "ON-RET-PUN-29566" }),
    odoo("OUT", "APC7VY19031375", "2026-10-20T10:27:53Z", OT),
  ]);

  it("raises nothing for either half", () => {
    expect(forUnit(res, "APC7VY19031375")).toEqual([]);
  });

  it("says so in the run notes", () => {
    expect(res.warnings.some((w) => w.includes("1 order transfer complete"))).toBe(true);
  });
});

describe("an incomplete transfer", () => {
  it("is still raised for a person to map", () => {
    const res = run([...busy, odoo("OUT", "APC7VY19031375", "2026-10-20T10:27:53Z", OT)]);
    expect(forUnit(res, "APC7VY19031375").map((v) => v.variance_name)).toEqual([VARIANCE.OT_CASE]);
  });

  it("an IN more than a day away does not complete it", () => {
    const res = run([
      ...busy,
      odoo("IN", "APC7VY19031375", "2026-10-18T09:00:00Z", { createdOn: "2026-10-18" }),
      odoo("OUT", "APC7VY19031375", "2026-10-20T10:27:53Z", OT),
    ]);
    expect(forUnit(res, "APC7VY19031375").some((v) => v.variance_name === VARIANCE.OT_CASE)).toBe(true);
  });
});

describe("a transfer return — the new customer hands the unit back", () => {
  it("is reconciled as a pickup, not raised as a transfer", () => {
    const res = run([
      ...busy,
      floor("SHEET", "IN", "APC7VY24060048"),
      floor("DT", "IN", "APC7VY24060048"),
      // Stored rows from before 23 Oct carry the tag on an IN as well.
      odoo("IN", "APC7VY24060048", "2026-10-20T11:00:00Z", { orderTransferRef: "OT-20261019-8289E9" }),
    ]);
    const names = forUnit(res, "APC7VY24060048").map((v) => v.variance_name);
    expect(names).not.toContain(VARIANCE.OT_CASE);
    expect(names).not.toContain(VARIANCE.ODOO_ONLY);
  });

  it("is chased like any return when a book is missing it", () => {
    const res = run([
      ...busy,
      odoo("IN", "APC7VY24060048", "2026-10-20T11:00:00Z", { orderTransferRef: "OT-20261019-8289E9" }),
    ]);
    const names = forUnit(res, "APC7VY24060048").map((v) => v.variance_name);
    expect(names).not.toContain(VARIANCE.OT_CASE);
    expect(names.length).toBe(1);
  });
});

describe("pairOrderTransfers", () => {
  const inLeg = odoo("IN", "APC7VY19031375", "2026-10-20T10:25:53Z");
  const outLeg = odoo("OUT", "APC7VY19031375", "2026-10-20T10:27:53Z", OT);

  it("keeps the IN half in the check when a floor book saw the unit come in", () => {
    const p = pairOrderTransfers([inLeg, outLeg], [floor("SHEET", "IN", "APC7VY19031375")]);
    expect(p.paired).toEqual([outLeg]);
    expect(p.dropInLegs.size).toBe(0);
  });

  it("drops the IN half when only Odoo has it", () => {
    const p = pairOrderTransfers([inLeg, outLeg], []);
    expect([...p.dropInLegs]).toEqual([inLeg]);
  });

  it("uses one IN for one transfer", () => {
    const second = odoo("OUT", "APC7VY19031375", "2026-10-20T12:00:00Z", OT);
    const p = pairOrderTransfers([inLeg, outLeg, second], []);
    expect(p.paired).toHaveLength(1);
    expect(p.unpaired).toHaveLength(1);
  });

  it("matches the canonical barcode, not the typed one", () => {
    const typed = odoo("IN", "APC7VYI9O31375", "2026-10-20T10:25:53Z");
    expect(pairOrderTransfers([typed, outLeg], []).paired).toHaveLength(1);
  });
});
