// Reading the delivery app's own warehouse status, and what happens when the
// read comes back empty.
//
// THE BUG THIS LOCKS DOWN (22 Oct 2026). This read opened its own direct
// MongoClient while the rest of the delivery data moved to Metabase on 13 Oct,
// so when the allowlist shut the direct route it failed alone — and silently,
// because the pipeline catches the error and carries on with whatever the last
// sync left behind. Every warehouse_calendar row carried the same synced_at,
// 13 Oct 18:00 IST, while the app's own master had been edited on the 17th: the
// engine, the dashboards and the digest judged nine days of closures from a
// frozen copy. A direct read from a developer machine on 22 Oct timed out after
// 15 seconds; the same read through the shared transport answered in 505ms.
//
// What the live app actually said once it could be reached: no city takes a
// weekly day off any more, and 20 Oct 2026 is a declared holiday in all five —
// the day four cities spent silent while the stale copy called it a workday.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const aggregate = vi.fn();
const close = vi.fn(async () => {});
vi.mock("../../lib/connectors/dt-transport", () => ({
  dtTransport: () => ({ kind: "metabase", parentCollection: "deliveries", aggregate, distinctIds: vi.fn(), close }),
}));

const { readWarehouseCalendar } = await import("../../lib/connectors/warehouse-calendar");

beforeEach(() => { aggregate.mockReset(); close.mockClear(); });
afterEach(() => vi.clearAllMocks());

const WEEKLY = (status: boolean) => ({
  master: "weekly_off",
  rows: [{ city: "Gurgaon", "week day": "Thu", status }],
});
const HOLIDAY = {
  master: "holiday",
  rows: [{ date: "20/10/2026", city: ["Gurgaon"], status: true }],
};

describe("readWarehouseCalendar", () => {
  it("reads both masters in one trip and closes the transport", async () => {
    aggregate.mockResolvedValue([WEEKLY(true), HOLIDAY]);
    const cal = await readWarehouseCalendar();
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate.mock.calls[0][0]).toBe("master_datas");
    expect(cal?.weeklyOff.DELHI).toEqual([4]);
    expect(cal?.holidays.DELHI).toContain("2026-10-20");
    expect(close).toHaveBeenCalled();
  });

  // WHAT THE LIVE APP SAYS TODAY: the Thursday rule is switched off in all five
  // cities, so a correct read now yields no weekly off at all. The holiday list
  // is doing the work instead, which is why reading it live matters.
  it("yields no weekly off when the app has the rule switched off", async () => {
    aggregate.mockResolvedValue([WEEKLY(false), HOLIDAY]);
    const cal = await readWarehouseCalendar();
    expect(cal?.weeklyOff).toEqual({});
    expect(cal?.holidays.DELHI).toContain("2026-10-20");
  });

  // AN EMPTY READ IS NOT AN EMPTY CALENDAR. The sync replaces the stored copy
  // wholesale, so folding nothing into "no city is ever closed" would erase a
  // real calendar on one odd read. Null keeps the last good copy in place.
  it("returns null when the read finds no masters", async () => {
    aggregate.mockResolvedValue([]);
    expect(await readWarehouseCalendar()).toBeNull();
    aggregate.mockResolvedValue([{ master: "weekly_off", rows: [] }, { master: "holiday", rows: [] }]);
    expect(await readWarehouseCalendar()).toBeNull();
  });

  it("returns null rather than throwing when the transport fails", async () => {
    aggregate.mockRejectedValue(new Error("server selection timed out"));
    expect(await readWarehouseCalendar()).toBeNull();
    expect(close).toHaveBeenCalled();
  });
});
