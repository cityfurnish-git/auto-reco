// The notifications box shortens the run's own lines (23 Oct 2026). Inputs are
// verbatim from the 22 Oct 2026 run's warnings.
import { describe, expect, it } from "vitest";
import { shortNotice } from "../../lib/ui/short-notice";

describe("shortNotice", () => {
  it("a sheet missing a column", () => {
    expect(shortNotice("Google Sheets: PUNE/Inward header is missing its Barcode column — 17576 rows skipped.")).toEqual({
      who: "Pune · Inward sheet", what: "Barcode column missing", extra: "17,576 rows skipped",
    });
  });
  it("a sheet with no header row", () => {
    expect(
      shortNotice("Google Sheets: MUMBAI/Inward has no header row (no Date column in the first 10 rows) — 50500 rows skipped. Restore the header and re-run.")
    ).toEqual({ who: "Mumbai · Inward sheet", what: "Header row missing", extra: "50,500 rows skipped" });
  });
  it("barcodes overdue", () => {
    expect(shortNotice("170 items received without a barcode and still unassigned after 24 hours")).toEqual({
      who: "170 items", what: "No barcode after 24 hours",
    });
  });
  it("a gate that recorded nothing", () => {
    expect(shortNotice("Gate Register: DELHI: no gate scans for 2026-10-15").who).toBe("Delhi · Gate");
  });
  it("an Odoo lookup that timed out", () => {
    expect(shortNotice("Odoo late-posting lookahead failed: The operation was aborted due to timeout")).toEqual({
      who: "Odoo", what: "Late-posting check timed out",
    });
  });
  it("passes an unknown line through whole", () => {
    expect(shortNotice("Something new went wrong")).toEqual({ who: "", what: "Something new went wrong" });
  });
});
