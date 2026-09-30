// An inward scan is the return of a delivery only while that delivery is open.
//
// Reported 30 Sep 2026 on washing machine APMYGL25081042. Odoo's story: out to
// Shreya Mandal on the 16th, back in on the 23rd, then out to Gauransh on an
// Out line Odoo had not validated. The gate scanned it in on the 28th and the
// row named Shreya — the last completed Out, twelve days old and already
// closed by its own return.

import { describe, it, expect } from "vitest";
import { odooMoveForScan } from "../../lib/gate/movement";
import { taskForScan } from "../../lib/gate/enrich";

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

// A van that goes out full and comes back full has no pickup task — only the
// delivery it failed. APMYGL25081042 left at 09:35 on the 28th for Gauransh
// and was scanned back at 18:46 the same evening.
describe("an inward with no pickup task", () => {
  const task = (kind: "pickup" | "delivery", date: string, ticket: string, so: string) =>
    ({ serial: "APMYGL25081042", kind, date, ticket, so, jobType: null, city: "DELHI" }) as Parameters<typeof taskForScan>[0][number];

  it("matches the delivery it is coming back from", () => {
    const t = taskForScan([task("delivery", "2026-09-28", "1232416", "ON-RET-GUR-82012")], SCAN, "IN");
    expect(t?.ticket).toBe("1232416");
  });

  it("still prefers a real pickup task when there is one", () => {
    const t = taskForScan([
      task("delivery", "2026-09-28", "1232416", "ON-RET-GUR-82012"),
      task("pickup", "2026-09-28", "9999", "ON-RET-GUR-70000"),
    ], SCAN, "IN");
    expect(t?.ticket).toBe("9999");
  });

  it("does not reach outside the window for one", () => {
    expect(taskForScan([task("delivery", "2026-09-16", "1226365", "ON-RET-GUR-81227")], SCAN, "IN")).toBeNull();
  });

  it("leaves outward alone — a delivery never matches a pickup task", () => {
    expect(taskForScan([task("pickup", "2026-09-28", "9999", "ON-RET-GUR-70000")], SCAN, "OUT")).toBeNull();
  });
});
