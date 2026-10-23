// The integrity rules (23 Oct 2026). One case per family the audit found,
// plus the cases that must NOT fire — a guardrail that cries wolf gets muted.
import { describe, expect, it } from "vitest";
import { checkRows, ledgerKey, type IntegrityRow, type LedgerFlags } from "../../lib/integrity/checks";
import { RESOLVED_LATE_NOTE } from "../../lib/engine/resolution";
import { VARIANCE } from "../../lib/engine/variance-names";
import { shortNotice } from "../../lib/ui/short-notice";

let n = 0;
const row = (over: Partial<IntegrityRow> = {}): IntegrityRow => ({
  id: `r${++n}`, business_date: "2026-10-21", city: "DELHI", direction: "IN", barcode: "U1",
  variance_name: VARIANCE.FLOOR_DT_NOT_ODOO, bucket: "REAL", priority: "Medium", status: "open", note: null,
  present_p: true, present_s: true, present_d: true, present_o: false,
  reported_p: true, reported_s: true, reported_d: true, reported_o: true,
  ...over,
});
const led = (r: IntegrityRow, outcome: LedgerFlags["outcome"], P = true, S = true, D = true, O = true) =>
  new Map([[ledgerKey(r), { outcome, present: { P, S, D, O } }]]);
const rules = (rows: IntegrityRow[], l = new Map<string, LedgerFlags>()) => checkRows(rows, l).map((f) => f.rule);

describe("checkRows", () => {
  it("a correct open row raises nothing", () => {
    const r = row();
    expect(rules([r], led(r, "REAL", true, true, true, false))).toEqual([]);
  });

  it("cleared but still on the chase list (107)", () => {
    expect(rules([row({ note: RESOLVED_LATE_NOTE })])).toEqual(["cleared-on-chase-list"]);
  });

  it("cleared with ticks the latest records disagree with (162)", () => {
    const r = row({ note: RESOLVED_LATE_NOTE, bucket: "INFO", priority: "Info", present_s: false, present_d: false });
    expect(rules([r], led(r, "CLEAN"))).toEqual(["stale-ticks"]);
  });

  it("on the chase list though the records are clean (204)", () => {
    const r = row();
    expect(rules([r], led(r, "CLEAN"))).toEqual(["stale-chase"]);
  });

  it("…but never for a name raised outside the ladder", () => {
    const r = row({ variance_name: VARIANCE.ODD_HOUR_TRIP, priority: "High" });
    expect(rules([r], led(r, "CLEAN"))).toEqual([]);
  });

  it("graded High on a book that never reported (1,348)", () => {
    const r = row({
      variance_name: VARIANCE.SHEET_ONLY, priority: "High",
      present_p: false, present_s: true, present_d: false, present_o: false, reported_p: false,
    });
    expect(rules([r])).toEqual(["grading"]);
  });

  it("two names on one unit-day (75 groups)", () => {
    const a = row({ direction: "OUT" });
    const b = row({ direction: "OUT", variance_name: VARIANCE.FAILED_DELIVERY, priority: "High", present_o: false });
    expect(rules([a, b])).toEqual(["two-names"]);
  });

  it("…except a duplicate-scan note, which is about the records", () => {
    const a = row();
    const b = row({ variance_name: VARIANCE.DUPLICATE, bucket: "INFO", priority: "Info" });
    expect(rules([a, b])).toEqual([]);
  });

  it("a row whose own tick contradicts its name", () => {
    expect(rules([row({ present_o: true })])).toEqual(["self-contradiction"]);
  });

  it("closed rows are not judged", () => {
    expect(rules([row({ status: "closed", note: RESOLVED_LATE_NOTE })])).toEqual([]);
  });
});

describe("integrity lines in the notifications box", () => {
  it("reads as the check, the problem and the count", () => {
    expect(shortNotice("Integrity (2026-10-22): 3 rows — Cleared on re-check but still on the chase list")).toEqual({
      who: "Integrity check", what: "Cleared on re-check but still on the chase list", extra: "3 rows · 2026-10-22",
    });
  });
});
