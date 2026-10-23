// Fixes from the 23 Oct 2026 integrity audit of the live queue (10,856 open
// rows). Each block names the family it closes and the count it was.
import { describe, expect, it } from "vitest";
import { runReconciliation } from "../../lib/engine/run";
import { chasePriority } from "../../lib/engine/buckets";
import { coveredAsRaised } from "../../lib/db/persist";
import { VARIANCE } from "../../lib/engine/variance-names";
import type { SourceRow } from "../../lib/engine/types";

const ALL = { P: true, S: true, D: true, O: true };
const NO_GATE = { P: false, S: true, D: true, O: true };

describe("chasePriority — rank by books that reported (1,424 rows)", () => {
  it("'Only MS has it' with no gate book is two books short: Medium", () => {
    expect(chasePriority(VARIANCE.SHEET_ONLY, NO_GATE)).toEqual({ bucket: "REAL", priority: "Medium" });
  });
  it("…and three short when all four filed: High", () => {
    expect(chasePriority(VARIANCE.SHEET_ONLY, ALL)).toEqual({ bucket: "REAL", priority: "High" });
  });
  it("a name with no absence claim keeps its rank", () => {
    expect(chasePriority(VARIANCE.FAILED_DELIVERY, NO_GATE).priority).toBe("High");
  });
  it("an INFO name stays Info whoever reported", () => {
    expect(chasePriority(VARIANCE.ODOO_ONLY, NO_GATE)).toEqual({ bucket: "INFO", priority: "Info" });
  });
});

describe("coveredAsRaised — cleared gaps in three-book cities (148 rows)", () => {
  it("a row raised without a gate book clears when the other three report", () => {
    expect(coveredAsRaised(NO_GATE, NO_GATE)).toBe(true);
  });
  it("a book that reported then and is silent now still blocks", () => {
    expect(coveredAsRaised(ALL, NO_GATE)).toBe(false);
    expect(coveredAsRaised(NO_GATE, { P: false, S: false, D: true, O: true })).toBe(false);
  });
  it("a run where nothing reported never clears anything", () => {
    const none = { P: false, S: false, D: false, O: false };
    expect(coveredAsRaised(none, none)).toBe(false);
  });
});

describe("a failed delivery owns its outward leg (81 unit-days with two names)", () => {
  const D = "2026-10-20";
  const r = (source: SourceRow["source"], status = "done"): SourceRow => ({
    source, direction: "OUT", barcode: "FUL52A22111024", status, date: D, createdOn: D,
  });
  const busy: SourceRow[] = [
    { source: "SHEET", direction: "OUT", barcode: "FUMYSU23010016", status: "Delivered", date: D },
    { source: "DT", direction: "OUT", barcode: "FUMYSU23010016", status: "done", date: D },
    { source: "ODOO", direction: "OUT", barcode: "FUMYSU23010016", status: "done", date: D, createdOn: D },
  ];
  it("raises only 'Delivery failed', not 'Not in Odoo' beside it", () => {
    const res = runReconciliation(
      [...busy, r("SHEET", "Not Delivered"), r("PHYSICAL"), r("DT")],
      "DELHI", ALL, new Set(), D
    );
    const names = res.variances.filter((v) => v.barcode_display === "FUL52A22111024").map((v) => v.variance_name);
    expect(names).toEqual([VARIANCE.FAILED_DELIVERY]);
  });
});
