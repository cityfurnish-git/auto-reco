// EVERY CLOSURE TEST READS THE DELIVERY APP, not the literal weekly map.
//
// The bug that produced this suite, 22 Oct 2026: the app's own weekly-off rule
// was switched off in all five cities on the 17th, and the closures it declares
// now arrive as one-off holidays — 20 Oct in every city. Nine files were still
// asking lib/engine/schedule's hardcoded Thursday map, which knows nothing of
// either change. Three cities were therefore "shut" every Thursday in the
// digest's coverage and trend figures, in the accuracy denominator, on the
// Stock Analyser and on the uploads screen, so a Thursday gap in Mumbai, Pune
// or Hyderabad was excused as an expected absence.
//
// This suite pins the shape of the fix rather than any one call site: given a
// calendar, every one of these helpers must believe the calendar. Given none,
// each must behave exactly as it used to — that fallback is what keeps a failed
// calendar read from changing anybody's numbers.

import { describe, expect, it } from "vitest";
import type { ClosureCalendar } from "../../lib/engine/schedule";
import { scorable, dailyTotals, type StatRow } from "../../lib/stats/accuracy";
import { assessComparability } from "../../lib/stock/coverage";
import { restDayCities } from "../../lib/email/followup/build";
import { recheckTargetDate } from "../../lib/reconcile/cron-dates";
import { buildTrends, type CoverageRow } from "../../lib/email/digest/trends";
import type { Coverage, FoldedPass, PassCitySnapshot } from "../../lib/stock/snapshot";

const THU = "2026-10-15"; // Thursday. Off in the literal map, worked per the app.
const HOLIDAY = "2026-10-20"; // Tuesday. Declared in all five cities; the map cannot see it.

/** The app as it actually stands: no weekly rule, closures as declared days. */
const APP: ClosureCalendar = {
  weeklyOff: {},
  holidays: { MUMBAI: [HOLIDAY], PUNE: [HOLIDAY], HYDERABAD: [HOLIDAY], DELHI: [HOLIDAY], BANGALORE: [HOLIDAY] },
} as ClosureCalendar;

describe("accuracy's shut-warehouse exclusion", () => {
  const row = (city: string, date: string): StatRow =>
    ({ city, business_date: date, movements: 100, real_count: 2, high_count: 1 }) as StatRow;

  it("scores a Thursday the app says was worked", () => {
    expect(scorable(row("MUMBAI", THU), THU, THU, APP)).toBe(true);
    // Without a calendar the literal map still answers, as it always did.
    expect(scorable(row("MUMBAI", THU), THU, THU)).toBe(false);
  });

  it("excludes a day the app declared a holiday, which the map cannot see", () => {
    expect(scorable(row("MUMBAI", HOLIDAY), HOLIDAY, HOLIDAY, APP)).toBe(false);
    expect(scorable(row("MUMBAI", HOLIDAY), HOLIDAY, HOLIDAY)).toBe(true);
  });

  // THE DENOMINATOR IS THE POINT. A day wrongly excluded simply vanishes from
  // the accuracy figure with nothing on screen to say so.
  it("carries the calendar into the daily totals", () => {
    const rows = [row("MUMBAI", THU), row("PUNE", THU)];
    expect(dailyTotals(rows, THU, THU, APP).get(THU)?.movements).toBe(200);
    expect(dailyTotals(rows, THU, THU).has(THU)).toBe(false);
  });
});

describe("the Stock Analyser's rest-day allowance", () => {
  const coverage = (mask: Partial<Coverage>): Coverage => ({
    P: true, S: true, D: true, O: true, movements: 10, sheetTruncated: false,
    rows: { sheetIn: 0, sheetOut: 0, odooIn: 0, odooOut: 0, dtIn: 0, dtOut: 0, physIn: 0, physOut: 0 },
    ...mask,
  });
  const snap = (city: string, cov: Coverage, date: string): PassCitySnapshot => ({
    runId: "r", businessDate: date, city,
    emittedCount: 0, tier1: 0, tier2: 0, tier3: 0, flagged: 0,
    byVariance: {}, supersededCount: 0, resolvedLateCount: 0, coverage: cov,
    tier1Keys: [], tier2Keys: [], tier3Keys: [],
    keysTruncated: false, keysPruned: false, backfilled: false,
  });
  const fold = (runId: string, rows: PassCitySnapshot[], date: string): FoldedPass => ({
    runId, date, cities: new Map(rows.map((r) => [r.city, r])),
    flaggedUnits: new Set(), tier3Units: new Set(), keyOfUnit: new Map(),
    flaggedCount: 0, keysUnavailable: false, backfilled: false,
  });

  // A city with no floor books on a REST day is "by design"; on a working day
  // it is an outage. Reading the wrong calendar swaps one for the other.
  const blind = (date: string) =>
    [
      fold("a", [snap("MUMBAI", coverage({}), date)], date),
      fold("b", [snap("MUMBAI", coverage({ P: false, S: false, D: false }), date)], date),
    ] as const;

  it("treats a worked Thursday's missing books as an outage, not as rest", () => {
    const [a, b] = blind(THU);
    expect(assessComparability(a, b, THU, APP).perCity[0].restDay).toBe(false);
    expect(assessComparability(a, b, THU).perCity[0].restDay).toBe(true);
  });

  it("allows rest on a day the app declared a holiday", () => {
    const [a, b] = blind(HOLIDAY);
    expect(assessComparability(a, b, HOLIDAY, APP).perCity[0].restDay).toBe(true);
    // The literal map has never known a one-off holiday.
    expect(assessComparability(a, b, HOLIDAY).perCity[0].restDay).toBe(false);
  });
});

describe("the follow-up email's forgive-these-cities banner", () => {
  it("names only the cities the app says were shut", () => {
    expect(restDayCities(THU, ["MUMBAI", "PUNE", "DELHI"], APP)).toEqual([]);
    expect(restDayCities(HOLIDAY, ["MUMBAI", "PUNE", "DELHI"], APP)).toEqual([
      "MUMBAI", "PUNE", "DELHI",
    ]);
    // No calendar: the literal map, exactly as before.
    expect(restDayCities(THU, ["MUMBAI", "PUNE", "DELHI"])).toEqual(["MUMBAI", "PUNE"]);
  });
});

describe("which day the second re-check pass re-runs", () => {
  // A closure pushes a day's books forward, so the pass steps back one day
  // instead of two. Driven by real closures now, not by every Thursday.
  const at = (d: string) => new Date(`${d}T16:30:00+05:30`);

  // Run on Friday 16 Oct the primary target is Thursday 15 Oct. The literal map
  // calls that a closure in three cities and steps back one day; the app says
  // nobody was shut, so the ordinary two-day step is correct — and two days is
  // what FOLLOW_UP_DELAY_DAYS is derived from, so the follow-up lands on the
  // date that was actually re-run.
  const FRIDAY = at("2026-10-16");
  const NO_CLOSURES: ClosureCalendar = { weeklyOff: {}, holidays: {} };

  it("steps back two days when the app says nothing was shut", () => {
    expect(recheckTargetDate(FRIDAY, NO_CLOSURES)).toBe("2026-10-13");
    expect(recheckTargetDate(FRIDAY)).toBe("2026-10-14"); // the map's answer
  });

  it("still steps back one when a closure really did land on the target", () => {
    const cal: ClosureCalendar = {
      weeklyOff: {}, holidays: { MUMBAI: [THU] },
    } as ClosureCalendar;
    expect(recheckTargetDate(FRIDAY, cal)).toBe("2026-10-14");
  });
});

describe("the digest's trend verdicts", () => {
  // THE WORST OF THE NINE, because it is the one that reaches the owner's inbox:
  // a city wrongly read as shut gets no verdict at all, and the day's headline
  // is computed as though that city were not expected to report.
  const SEP = "\u0000";
  const cities = ["MUMBAI", "PUNE", "DELHI"];
  const dates = ["2026-10-12", "2026-10-13", "2026-10-14", THU];
  const coverage: CoverageRow[] = dates.flatMap((d) =>
    cities.map((city) => ({
      business_date: d, city, movements: 200,
      reported_p: true, reported_s: true, reported_d: true, reported_o: true,
    }))
  ) as CoverageRow[];
  const tier1 = new Map<string, number>();
  for (const d of dates) for (const c of cities) tier1.set(`${c}${SEP}${d}`, d === THU ? 30 : 2);

  const input = (calendar?: ClosureCalendar) => ({
    businessDate: THU,
    tier1,
    priorDates: dates.slice(0, 3),
    coverage,
    cities,
    ratio: 1.5,
    minUnits: 5,
    calendar,
  });

  it("gives a worked Thursday its verdict in every city", () => {
    const out = buildTrends(input(APP));
    for (const c of cities) expect(out.byCity.get(c), c).not.toBeNull();
    expect(out.dayTrend).not.toBeNull();
  });

  // Without a calendar, Mumbai and Pune are withheld on the literal map's word
  // — which is precisely the silence this change removes.
  it("withholds them on the literal map, as it used to", () => {
    const out = buildTrends(input());
    expect(out.byCity.get("MUMBAI")).toBeNull();
    expect(out.byCity.get("PUNE")).toBeNull();
    expect(out.byCity.get("DELHI")).not.toBeNull();
  });
});
