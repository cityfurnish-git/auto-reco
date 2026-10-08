// An item that arrived at the gate without a barcode and still has none.
//
// Owner's rule, 6 Oct 2026: every new item received at the warehouse must have
// a barcode assigned within 24 HOURS of being logged in the gate app, and the
// guard owns doing it. Past that, it is a variance.
//
// WHY THIS IS WORTH A RULE. An untagged unit cannot be matched to anything.
// Every other check in this system is per canonical barcode, so until the
// sticker exists the unit is invisible to reconciliation — it is not missing,
// it is unaskable. Measured on 6 Oct 2026, before any of this was built: 78
// items were sitting unassigned and 76 of them were already past 24 hours, the
// oldest by nearly five days. Nobody could see that list.
//
// THE CLOCK STARTS AT THE GATE, not at the Odoo receipt (owner's choice). The
// gate entry is the first moment the business knows the unit is on site, and it
// is the moment the guard — who owns the task — was standing next to it.
//
// ODOO IS THE SOURCE OF TRUTH FOR WHAT THE ITEM IS. The gate records a serial;
// Odoo maps that serial to the unit and, once assigned, to its barcode. That
// mapping is what lets the guard's closing scan find the right pending row
// rather than guessing between ten identical fridges.
//
// TWO KINDS ARRIVE UNTAGGED AND THEY ARE NOT THE SAME PROBLEM:
//
//   vendor_goods      Legitimately untagged — a vendor's truck arrives and the
//                     stickers go on after receipt. This is the SLA's real
//                     target, and the one the warehouse controls.
//   customer_return   A CityFurnish unit coming BACK has been tagged already,
//                     so a missing sticker means it was removed or fell off.
//                     gate_scans already forces a stated reason for these
//                     (migration 0023), and that reason is carried into the row
//                     so a manager reads the cause rather than re-deriving it.
//
// QUANTITY MATTERS FOR VENDOR BATCHES. "Ten fridges, no stickers yet" is ONE
// gate row with quantity ten, so one closing scan cannot finish it. The row
// reports how many of the batch are still untagged and clears only when all of
// them are (owner, 6 Oct 2026).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { City } from "../sample-data";
import { VARIANCE } from "../engine/variance-names";
import { VARIANCE_META } from "../engine/buckets";
import { varianceSource } from "../engine/variance-source";
import { gateAppCities } from "../connectors/guard";

type DB = SupabaseClient;

/** The owner's deadline, from the gate entry. */
export const BARCODE_SLA_HOURS = 24;

export interface PendingItem {
  id: string;
  city: string;
  serial_no: string | null;
  so_number: string | null;
  ticket_id: string | null;
  item_kind: string | null;
  quantity: number | null;
  exception_reason: string | null;
  scanned_at: string;
  business_date: string;
}

/** Hours between the gate entry and `now`. */
export function hoursWaiting(scannedAt: string, nowMs: number): number {
  return (nowMs - Date.parse(scannedAt)) / 3_600_000;
}

/** Pure: is this item past the deadline? */
export function isOverdue(scannedAt: string, nowMs: number): boolean {
  return hoursWaiting(scannedAt, nowMs) > BARCODE_SLA_HOURS;
}

/**
 * What a manager needs to read without opening anything: how long, what kind,
 * and — for a vendor batch — how much of it is still untagged.
 */
export function noteFor(item: PendingItem, nowMs: number): string {
  const hrs = Math.floor(hoursWaiting(item.scanned_at, nowMs));
  const age = hrs >= 48 ? `${Math.floor(hrs / 24)} days` : `${hrs} hours`;
  const qty = item.quantity ?? 1;
  const what =
    item.item_kind === "vendor_goods"
      ? qty > 1
        ? `A vendor delivery of ${qty} units`
        : "A vendor delivery"
      : item.item_kind === "customer_return"
        ? "A customer return"
        : "An item";
  // The register already made the guard say why a return came back untagged;
  // repeating it here saves a manager a round trip to find out.
  const why = item.exception_reason ? ` Guard's reason: ${item.exception_reason}.` : "";
  const id = item.serial_no
    ? ` Serial ${item.serial_no}.`
    : item.so_number
      ? ` Order ${item.so_number}.`
      : "";
  return (
    `${what} was logged at the gate ${age} ago and still has no barcode assigned.${id}${why} ` +
    `Assign the barcode and scan it against this entry; the deadline is ${BARCODE_SLA_HOURS} hours from the gate entry.`
  );
}

/**
 * Raise one variance per gate item still untagged past the deadline.
 *
 * Upserts on the engine's natural key so a re-run refreshes rather than
 * duplicating, and a manager's close is never reopened (status and
 * first_seen_at are deliberately absent, as in upsertVariances).
 *
 * Keyed to the day the item ARRIVED, not the run day. Keyed to the run day it
 * would be re-raised as a brand-new row every night and the backlog would read
 * as fresh work forever; on the arrival day it ages honestly and the digest's
 * ageing section does the rest.
 *
 * Best-effort: a failure here must never fail the run.
 */
export async function raiseBarcodeOverdue(
  db: DB,
  runId: string,
  runDate: string,
  warnings: string[],
  nowMs: number = Date.now()
): Promise<number> {
  try {
    const cities = gateAppCities(runDate);
    if (cities.size === 0) return 0;

    // Exactly the shape migration 0023's partial index was built for.
    const res = await db
      .from("gate_scans")
      .select(
        "id, city, serial_no, so_number, ticket_id, item_kind, quantity, exception_reason, scanned_at, business_date"
      )
      .eq("barcode_pending", true)
      .eq("status", "recorded")
      .in("city", [...cities]);
    if (res.error || !res.data?.length) return 0;

    const overdue = (res.data as unknown as PendingItem[]).filter((r) =>
      isOverdue(r.scanned_at, nowMs)
    );
    if (!overdue.length) return 0;

    const meta = VARIANCE_META[VARIANCE.BARCODE_OVERDUE];
    const now = new Date().toISOString();
    const payload = overdue.map((it) => ({
      run_id: runId,
      business_date: it.business_date,
      city: it.city as City,
      // The scan id is the unit here: there is no barcode yet, which is the
      // whole point, so nothing else is stable across re-runs.
      barcode: it.id,
      // The serial is what a person can act on — it is printed on the unit and
      // it is what Odoo keys the eventual barcode to.
      barcode_display: it.serial_no ?? it.so_number ?? it.id.slice(0, 8),
      direction: "IN",
      variance_name: VARIANCE.BARCODE_OVERDUE,
      note: noteFor(it, nowMs),
      variance_source: varianceSource(VARIANCE.BARCODE_OVERDUE, "IN"),
      priority: "High",
      bucket: meta.bucket,
      responsible: meta.responsible,
      so_number: it.so_number,
      ticket_id: it.ticket_id,
      date: it.business_date,
      last_seen_at: now,
      // Only the gate knows this item exists at all — that is precisely the
      // problem it reports. Four crosses would read as "three books missed
      // this unit", which is not what the row is about.
      present_p: true,
      reported_p: true,
      present_s: false,
      present_d: false,
      present_o: false,
      reported_s: false,
      reported_d: false,
      reported_o: false,
    }));

    const { error } = await db
      .from("variances")
      .upsert(payload, { onConflict: "business_date,city,direction,barcode,variance_name" });
    if (error) return 0;

    warnings.push(
      `${payload.length} item${payload.length === 1 ? "" : "s"} received without a barcode and still unassigned after ${BARCODE_SLA_HOURS} hours`
    );
    return payload.length;
  } catch {
    return 0;
  }
}
