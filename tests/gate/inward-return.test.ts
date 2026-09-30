// An inward scan is the return of a delivery only while that delivery is open.
//
// Reported 30 Sep 2026 on washing machine APMYGL25081042. Odoo's story: out to
// Shreya Mandal on the 16th, back in on the 23rd, then out to Gauransh on an
// Out line Odoo had not validated. The gate scanned it in on the 28th and the
// row named Shreya — the last completed Out, twelve days old and already
// closed by its own return.

import { describe, it, expect } from "vitest";
import { odooMoveForScan } from "../../lib/gate/movement";

const move = (date: string, movementType: string, state: string, so: string, customer: string) =>
  ({ date, movementType, state, so, customer } as Parameters<typeof odooMoveForScan>[0][number]);

const SCAN = "2026-09-28T13:16:00.000Z"; // 18:46 IST on the 28th

describe("which delivery an inward scan is returning from", () => {
  it("names nobody once the delivery has already come back", () => {
    const moves = [
      move("2026-09-16T05:00:00Z", "Out", "done", "ON-RET-GUR-81227", "Shreya Mandal"),
      move("2026-09-23T15:07:00Z", "In", "done", "ON-RET-GUR-81227", "Shreya Mandal"),
    ];
    expect(odooMoveForScan(moves, SCAN, "IN")).toBeNull();
  });

  it("still names the customer while the unit is genuinely out with them", () => {
    const moves = [move("2026-09-16T05:00:00Z", "Out", "done", "ON-RET-GUR-81227", "Shreya Mandal")];
    expect(odooMoveForScan(moves, SCAN, "IN")?.customer).toBe("Shreya Mandal");
  });

  it("ignores a return that happened after this scan", () => {
    const moves = [
      move("2026-09-16T05:00:00Z", "Out", "done", "ON-RET-GUR-81227", "Shreya Mandal"),
      move("2026-09-29T10:00:00Z", "In", "done", "ON-RET-GUR-81227", "Shreya Mandal"),
    ];
    expect(odooMoveForScan(moves, SCAN, "IN")?.so).toBe("ON-RET-GUR-81227");
  });

  it("takes the later delivery when the unit went out twice", () => {
    const moves = [
      move("2026-09-16T05:00:00Z", "Out", "done", "ON-RET-GUR-81227", "Shreya Mandal"),
      move("2026-09-23T15:07:00Z", "In", "done", "ON-RET-GUR-81227", "Shreya Mandal"),
      move("2026-09-27T05:00:00Z", "Out", "done", "ON-RET-GUR-82012", "GAURANSH"),
    ];
    expect(odooMoveForScan(moves, SCAN, "IN")?.customer).toBe("GAURANSH");
  });
});
