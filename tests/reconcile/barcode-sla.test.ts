// The 24-hour barcode deadline.
//
// Owner's rule, 6 Oct 2026: a new item received at the warehouse must have a
// barcode assigned within 24 hours of being logged in the gate app. Measured
// that day, before any of this existed: 78 items were waiting and 76 were
// already past the deadline, the oldest by nearly five days.

import { describe, it, expect } from "vitest";
import {
  BARCODE_SLA_HOURS,
  hoursWaiting,
  isOverdue,
  noteFor,
  type PendingItem,
} from "../../lib/reconcile/barcode-sla";

const NOW = Date.parse("2026-10-06T12:00:00+05:30");
/** A gate entry `h` hours before NOW. */
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const item = (over: Partial<PendingItem> = {}): PendingItem => ({
  id: "scan-1",
  city: "DELHI",
  serial_no: "SN-4417",
  so_number: null,
  ticket_id: null,
  item_kind: "vendor_goods",
  quantity: 1,
  exception_reason: null,
  scanned_at: at(30),
  business_date: "2026-10-05",
  ...over,
});

describe("barcode SLA — the clock", () => {
  it("counts from the gate entry, not from the Odoo receipt", () => {
    expect(hoursWaiting(at(30), NOW)).toBeCloseTo(30, 5);
    expect(hoursWaiting(at(0.5), NOW)).toBeCloseTo(0.5, 5);
  });

  it("leaves an item inside the deadline alone", () => {
    for (const h of [0, 1, 12, 23.9, BARCODE_SLA_HOURS]) {
      expect(isOverdue(at(h), NOW)).toBe(false);
    }
  });

  it("flags one past it", () => {
    for (const h of [24.1, 41, 69, 113.8]) {
      expect(isOverdue(at(h), NOW)).toBe(true);
    }
  });
});

describe("barcode SLA — what the row says", () => {
  it("names the serial, the age and the deadline", () => {
    const n = noteFor(item({ scanned_at: at(30) }), NOW);
    expect(n).toContain("SN-4417");
    expect(n).toContain("30 hours");
    expect(n).toContain("24 hours");
  });

  it("reads in days once it is past two", () => {
    expect(noteFor(item({ scanned_at: at(69) }), NOW)).toContain("2 days");
  });

  it("says how big a vendor batch is, because one scan cannot close it", () => {
    const n = noteFor(item({ item_kind: "vendor_goods", quantity: 10 }), NOW);
    expect(n).toContain("vendor delivery of 10 units");
  });

  // A CityFurnish unit left tagged, so an untagged return is a different
  // problem and the guard already had to say why. Carrying that reason saves a
  // manager a round trip.
  it("carries the guard's stated reason on a customer return", () => {
    const n = noteFor(
      item({ item_kind: "customer_return", exception_reason: "sticker torn off in transit" }),
      NOW
    );
    expect(n).toContain("customer return");
    expect(n).toContain("sticker torn off in transit");
  });

  it("falls back to the order when there is no serial", () => {
    const n = noteFor(item({ serial_no: null, so_number: "SO-9912" }), NOW);
    expect(n).toContain("SO-9912");
  });
});
