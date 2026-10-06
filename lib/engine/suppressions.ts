// Section 7 — Suppression fixes. These run BEFORE variance classification and
// catch operationally-normal situations that would otherwise look like fake
// variances. Returns the set of suppressed keys plus the DT-all-pending set
// (which also suppresses duplicate-scan variances) and the silent-OCR set
// (which must never appear anywhere in the output — Section 7/12).

import { blank, isRepair, normalizeSO } from "./util";
import { allPendingOrNotDone, hasDone } from "./views";
import { ALL_REPORTED } from "./types";
import type { BarcodeView, ReportedSources } from "./types";

export interface SuppressionResult {
  suppressed: Set<string>; // `${direction}::${canonical}` — remove all variances
  dtAllPending: Set<string>; // subset — also suppresses duplicate variances
  silentOcr: Set<string>; // never output at all (Section 7 Silent OCR/SO-Match)
}

const key = (v: BarcodeView) => `${v.direction}::${v.canonical}`;

function productPrefixMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const pa = a.trim().toLowerCase().split(/\s+/)[0];
  const pb = b.trim().toLowerCase().split(/\s+/)[0];
  if (!pa || !pb) return false;
  return pa === pb || pa.startsWith(pb) || pb.startsWith(pa);
}

export function computeSuppressions(
  inViews: Map<string, BarcodeView>,
  outViews: Map<string, BarcodeView>,
  reported: ReportedSources = ALL_REPORTED
): SuppressionResult {
  const suppressed = new Set<string>();
  const dtAllPending = new Set<string>();
  const silentOcr = new Set<string>();

  // Physical SO/ticket → [{canonical, product}] index for Silent OCR match.
  const physIndex = new Map<string, Array<{ canonical: string; product: string | null }>>();
  const indexPhysical = (views: Map<string, BarcodeView>) => {
    for (const v of Array.from(views.values())) {
      if (!v.P.present) continue;
      for (const id of [normalizeSO(v.soNumber), v.ticketId?.toUpperCase() ?? null]) {
        if (!id) continue;
        const list = physIndex.get(id) ?? [];
        list.push({ canonical: v.canonical, product: v.product });
        physIndex.set(id, list);
      }
    }
  };
  indexPhysical(inViews);
  indexPhysical(outViews);

  const evalDirection = (
    views: Map<string, BarcodeView>,
    opposite: Map<string, BarcodeView>,
    direction: "IN" | "OUT"
  ) => {
    for (const v of Array.from(views.values())) {
      const k = key(v);
      const opp = opposite.get(v.canonical);

      // DT All-Pending: every DT entry pending/not_done → suppress everything.
      if (allPendingOrNotDone(v.D)) {
        suppressed.add(k);
        dtAllPending.add(k);
        continue;
      }

      // Failed Delivery Return Suppression (IN).
      if (direction === "IN") {
        const sheetReceived = hasDone(v.S);
        const dtPending =
          v.D.present && !hasDone(v.D) &&
          v.D.statuses.some((s) => s === "pending" || s === "not_done");
        const oppDtPending =
          !!opp && opp.D.present && !hasDone(opp.D);
        if (sheetReceived && !v.P.present && dtPending && !v.O.present && oppDtPending) {
          suppressed.add(k);
          continue;
        }

        // WH Received-Back Undelivered Suppression (IN).
        const physOrSheetDone = hasDone(v.P) || hasDone(v.S);
        const dtAbsentOrNotDone = !v.D.present || !hasDone(v.D);
        if (physOrSheetDone && dtAbsentOrNotDone && !v.O.present && oppDtPending) {
          suppressed.add(k);
          continue;
        }

        // Inward DT quantity-aggregation Suppression (IN). A PO receipt of N
        // identical units is sometimes logged in the Delivery Tracker as a single
        // quantity instead of N barcodes, so the units show in Ops Sheet + Odoo
        // but are absent from DT. That is a DT data-entry convention, not a stock
        // gap — suppress the resulting "DT missing" INFO variance (rung 10 "Odoo
        // Update Pending — Movement Confirmed", or no-guard rung 6b "DT Missing —
        // Ops & Odoo Agree") when Sheet AND Odoo both confirm and the guard either
        // has the unit or is unreported. When the guard reported but is missing
        // this unit, the gap is a genuine REAL "Gate Log Missing" (rung 6) and is
        // deliberately left to fire.
        if (v.S.present && v.O.present && !v.D.present && (v.P.present || !reported.P)) {
          suppressed.add(k);
          continue;
        }
      }

      // Internal Repair Movement Suppression (OUT).
      if (direction === "OUT") {
        if (
          v.O.present &&
          isRepair(v.jobType) &&
          blank(v.ticketId) &&
          blank(v.customer) &&
          blank(v.soNumber)
        ) {
          suppressed.add(k);
          continue;
        }
      }

      // SILENT OCR/SO-MATCH — RETIRED 6 OCT 2026 (owner).
      //
      // It suppressed a unit missing from the guard book when the same sale
      // order or ticket appeared there under a DIFFERENT barcode for the same
      // product, on the assumption that a guard had mis-written the code. That
      // held while the guard book was a photographed handwritten register.
      //
      // It does not hold now. The register is retired, so the only guard book
      // left is Delhi's gate app, where the barcode is read from a QR code by a
      // scanner. A scanner does not mis-write a barcode, so in the one city
      // this could still fire, its premise is false — and what it would hide is
      // a genuine mismatch between two units on the same order.
      //
      // It was also the only rule in the engine whose output was invisible by
      // design: suppressed, never recorded, nowhere to audit. Removing it costs
      // nothing on live data and removes a rule nobody could check.
      //
      // The set and its readers in run.ts are kept deliberately. They now never
      // match, and leaving them is what makes bringing the rule back for a
      // register city a one-block change rather than an archaeology exercise.
    }
  };

  evalDirection(inViews, outViews, "IN");
  evalDirection(outViews, inViews, "OUT");

  return { suppressed, dtAllPending, silentOcr };
}
