// Server side of lib/variances/flags.ts: gathers what the pure rule needs for
// a page of variance rows, in a handful of queries per (city, day).
//
// Uses the admin client for the lookups, deliberately and narrowly: the rows
// themselves were already read through RLS by the caller, and all this returns
// about each one is a yes/no computed from its own city and day — nothing from
// another city reaches the response. Shifts and source rows are not all
// readable by a manager's RLS role, and the flags must not differ by who looks.
//
// A failed lookup leaves the rows unflagged rather than failing the list: a
// flag is a hint, and the list is the job.

import { createAdminClient } from "@/lib/supabase/admin";
import type { ClosureCalendar } from "@/lib/engine/schedule";
import { gateAppCities } from "@/lib/connectors/guard";
import { normalizeStatus } from "@/lib/engine/util";
import type { City } from "@/lib/sample-data";
import { flagsFor, odooWindowEnd, type VarianceFlag } from "./flags";

/** The IST calendar day of a stored timestamp, or null. */
const istDay = (v: string | null): string | null =>
  v ? new Date(Date.parse(v) + 5.5 * 3600_000).toISOString().slice(0, 10) : null;

interface Row {
  run_id: string;
  business_date: string;
  city: string;
  barcode: string;
  direction: string;
  job_type: string | null;
  present_p?: boolean;
  present_d?: boolean;
  present_o?: boolean;
}

export async function attachFlags<T extends Row>(rows: T[]): Promise<(T & { flags: VarianceFlag[] })[]> {
  if (!rows.length) return [];
  const none = () => rows.map((r) => ({ ...r, flags: [] as VarianceFlag[] }));
  try {
    const db = createAdminClient();
    const nowMs = Date.now();

    // Closure calendar — once.
    let cal: ClosureCalendar | null = null;
    const calRes = await db.from("warehouse_calendar").select("city, weekday, holiday_date");
    if (!calRes.error && calRes.data?.length) {
      const weeklyOff: Record<string, number[]> = {};
      const holidays: Record<string, string[]> = {};
      for (const r of calRes.data as { city: string; weekday: number | null; holiday_date: string | null }[]) {
        if (r.weekday !== null && r.weekday !== undefined) (weeklyOff[r.city] ??= []).push(r.weekday);
        else if (r.holiday_date) (holidays[r.city] ??= []).push(r.holiday_date);
      }
      cal = { weeklyOff, holidays } as ClosureCalendar;
    }

    const groups = new Map<string, T[]>();
    for (const r of rows) {
      const k = `${r.city}|${r.business_date}|${r.run_id}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }

    const guardOnDuty = new Map<string, boolean | null>(); // city|day
    const notDelivered = new Set<string>(); // run|city|barcode (outward)
    const attemptLater = new Set<string>(); // run|city|direction|barcode

    await Promise.all([...groups.entries()].map(async ([k, list]) => {
      const [city, day, runId] = k.split("|");

      // Rule A: was ANY guard signed in at this gate at any point in the day?
      const gk = `${city}|${day}`;
      if (!guardOnDuty.has(gk)) {
        guardOnDuty.set(gk, null);
        if (gateAppCities(day).has(city as City)) {
          const start = new Date(`${day}T00:00:00+05:30`).toISOString();
          const end = new Date(Date.parse(`${day}T00:00:00+05:30`) + 86_400_000).toISOString();
          // A shift touches the day if it began before the day ended and had
          // not ended before the day began (or is still open).
          const s = await db.from("guard_shifts").select("id", { count: "exact", head: true })
            .eq("city", city).lt("checked_in_at", end)
            .or(`checked_out_at.is.null,checked_out_at.gte.${start}`);
          if (!s.error) guardOnDuty.set(gk, (s.count ?? 0) > 0);
        }
      }

      // The run's own sheet and tracker rows for these units — two questions in
      // one read: did a book say the outward was not delivered, and does the
      // Tracker's own row close the job on a LATER date than the day it sits on?
      const bcs = [...new Set(list.map((r) => r.barcode))];
      for (let i = 0; i < bcs.length; i += 200) {
        const sr = await db.from("source_rows")
          .select("source, status, direction, barcode_canonical, movement_date, raw")
          .eq("run_id", runId).eq("city", city)
          .in("source", ["SHEET", "DT"])
          .in("barcode_canonical", bcs.slice(i, i + 200));
        if (sr.error) continue;
        for (const x of (sr.data ?? []) as { source: string; status: string | null; direction: string;
                                             barcode_canonical: string; movement_date: string | null;
                                             raw: { physicalStatus?: string } | null }[]) {
          if (x.direction === "OUT") {
            const nd = x.source === "SHEET"
              ? normalizeStatus(x.status) === "not_done"
              : /^not\s*done$/i.test(x.raw?.physicalStatus ?? "");
            if (nd) notDelivered.add(`${runId}|${city}|${x.barcode_canonical}`);
          }
          // The Tracker's completion time is its own word for when the job
          // closed. Later than the day it is filed under = this was an attempt.
          if (x.source === "DT" && istDay(x.movement_date) && istDay(x.movement_date)! > day) {
            attemptLater.add(`${runId}|${city}|${x.direction}|${x.barcode_canonical}`);
          }
        }
      }
    }));

    return rows.map((r) => ({
      ...r,
      flags: flagsFor(r, {
        odooWindowEndMs: odooWindowEnd(r.city, r.business_date, cal),
        nowMs,
        guardOnDuty: guardOnDuty.get(`${r.city}|${r.business_date}`) ?? null,
        notDelivered: notDelivered.has(`${r.run_id}|${r.city}|${r.barcode}`),
        attemptCompletedLater: attemptLater.has(`${r.run_id}|${r.city}|${r.direction}|${r.barcode}`),
      }),
    }));
  } catch {
    return none();
  }
}
