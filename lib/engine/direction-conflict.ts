// Section 8 — Cross-Direction Check (Direction Conflict). A barcode that
// appears in both the IN and OUT union with the SAME normalized SO number is
// normally a same-day replacement, not a stock gap. Suppress via the
// Replace-as-Repair and Direction-Conflict Failed-Delivery fixes (Section 7);
// otherwise emit a Direction Conflict (High, direction CROSS).

import { isNewRental, isRepairEquivalent, normalizeSO } from "./util";
import { displayBarcode, hasDone, orFlags, presenceOf } from "./views";
import { VARIANCE } from "./variance-names";
import type { BarcodeView, VarianceRowOut } from "./types";

export function detectDirectionConflicts(
  inViews: Map<string, BarcodeView>,
  outViews: Map<string, BarcodeView>,
  suppressed: Set<string>
  // `reported` is stamped once by runReconciliation over the finished list.
): Omit<VarianceRowOut, "reported">[] {
  const out: Omit<VarianceRowOut, "reported">[] = [];

  // Index OUT views by normalized SO.
  const outBySo = new Map<string, BarcodeView>();
  for (const v of Array.from(outViews.values())) {
    const so = normalizeSO(v.soNumber);
    if (so) outBySo.set(so, v);
  }

  for (const inView of Array.from(inViews.values())) {
    const so = normalizeSO(inView.soNumber);
    if (!so) continue;
    const outView = outBySo.get(so);
    if (!outView) continue;
    if (outView.canonical !== inView.canonical) continue; // same physical unit

    // Skip if either leg is already fully suppressed.
    if (
      suppressed.has(`IN::${inView.canonical}`) ||
      suppressed.has(`OUT::${outView.canonical}`)
    ) {
      continue;
    }

    // BOTH LEGS MUST BE A MOVEMENT ON THIS DAY (owner, 30 Sep 2026).
    //
    // Odoo is pulled a day either side so a late posting can be matched to the
    // day the goods moved. Those neighbouring rows build views like any other,
    // and this check paired two of them: fridge FUUMPC24121005 went out on the
    // 27th (gate 10:16, sheet, tracker, Odoo — all clean) and came back on the
    // 29th (gate 21:36, Odoo 21:37). Both postings happen to be filed under the
    // 28th in the raw feed, share sale order ON-RET-GUR-81950, and were paired
    // into an urgent "same unit in and out today" for a day on which the unit
    // did not move at all — its own row shows no floor book present.
    //
    // A leg is a movement on this day if a floor book recorded it, or Odoo
    // posted it FOR this day. O.present alone is not enough: that is exactly
    // the neighbouring-day posting this guard exists to exclude.
    const movedToday = (v: BarcodeView) =>
      v.P.present || v.S.present || v.D.present || !!v.odooSameDay;
    if (!movedToday(inView) || !movedToday(outView)) continue;

    const outDone = hasDone(outView.D);
    // Read job type across BOTH legs (Section 7).
    const jobTypes = [inView.jobType, outView.jobType];
    const anyRepairEquivalent = jobTypes.some(isRepairEquivalent);
    const anyNewRentalOrReplace = jobTypes.some(
      (j) => isNewRental(j) || isRepairEquivalent(j)
    );

    // Direction-Conflict Failed-Delivery Suppression: NEW_RENTAL/REPLACE and
    // the OUT delivery did not complete → suppress. BUT if OUT is done, fire
    // anyway even for REPLACE (a completed replacement + same-SO return is a
    // genuine conflict to check).
    if (!outDone && (anyNewRentalOrReplace || anyRepairEquivalent)) {
      continue;
    }

    out.push({
      barcode: inView.canonical,
      // The inward leg's label: it is the leg whose canonical keys the row.
      barcode_display: displayBarcode(inView),
      city: inView.city,
      direction: "CROSS",
      variance_name: VARIANCE.REPLACEMENT_CONFIRM,
      priority: "High",
      bucket: "REAL",
      responsible: "warehouse_team",
      ticket_id: inView.ticketId ?? outView.ticketId,
      so_number: inView.soNumber ?? outView.soNumber,
      customer: inView.customer ?? outView.customer,
      product: inView.product ?? outView.product,
      job_type: inView.jobType ?? outView.jobType,
      date: inView.date || outView.date,
      // The UNION of both legs, not the IN leg alone. This row asserts that one
      // unit both arrived and left today, so the evidence for that claim is
      // everything either leg saw. Reading only the IN leg would print "no
      // delivery-app record" for a unit whose OUT leg is the very reason the
      // row exists. It is consistent with how the identifying fields above
      // already merge (`inView.X ?? outView.X` — either leg counts).
      //
      // Lossy by design: it cannot say WHICH leg the gate logged. A CROSS row
      // is a single "confirm this replacement" ask, not two chase items, and
      // eight more columns for one variance name is not worth the schema.
      present: orFlags(presenceOf(inView), presenceOf(outView)),
      note: `Same unit (SO ${so}) both received and dispatched today — confirm it is a genuine same-day replacement and not a double-count.`,
    });
  }

  return out;
}
