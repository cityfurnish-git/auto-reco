// Order transfers — which ones need a person, and which are complete paperwork.
//
// Decided 23 Oct 2026 (owner: "chase only when the IN/OUT customer pair is
// incomplete"). In Odoo a transfer is written as TWO lines a minute apart: the
// unit comes IN from the old customer on the old order, and goes OUT on the new
// order whose Reference# is "OT-…". Nothing crosses the gate either way.
//
// Measured against live Odoo for the 30 days to 23 Oct 2026:
//   - 198 transfer OUT lines. 155 had the old customer's IN within 10 minutes,
//     27 more within a day, 9 later, 7 none. Pair within a day = 182 (92%).
//   - The IN half carries the OLD order, not the OT tag, so the engine never
//     knew it belonged to a transfer: it reconciled as an Odoo-only receipt and
//     raised 97 open "Only Odoo has it, and it was typed today" chase items.
//   - 61 lines were IN on an OT order — the NEW customer handing the unit back.
//     That is a real pickup: Guard, MS or DT saw 48 of them. Raising it as an
//     OT CASE took a physical movement out of the four-way check.
//
// So: only the OUT on an OT order is the transfer. Paired with an IN of the
// same unit within a day, both halves are paperwork and nothing is raised.
// Unpaired, it is the one case where only a person can say what happened.

import { canonicalize } from "./barcode";
import type { SourceRow } from "./types";

/** How far apart the two halves may be posted. 27 of the 182 pairs above were
 *  more than ten minutes apart but inside a day; 9 more were later still, and
 *  those stay on the chase list rather than widen this — a day is already
 *  enough for an unrelated return of the same unit to slip in. */
export const PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The OUT on an OT order. An IN on an OT order is a return, not a transfer. */
export function isTransferOut(r: SourceRow): boolean {
  return r.source === "ODOO" && r.direction === "OUT" && !!r.orderTransferRef;
}

function timeOf(r: SourceRow): number | null {
  for (const v of [r.movementDate, r.createdOn]) {
    if (v == null || v === "") continue;
    const t = typeof v === "number" ? v : Date.parse(String(v));
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export interface TransferPairing {
  /** Transfer OUT lines with no IN half — each becomes an OT CASE. */
  unpaired: SourceRow[];
  /** Transfer OUT lines whose IN half was found. */
  paired: SourceRow[];
  /** IN halves to take out of the reconciliation: paperwork, no floor record. */
  dropInLegs: Set<SourceRow>;
}

/**
 * @param odooRows every Odoo row pulled for the city (before the posting window)
 * @param floorRows Guard / MS / DT rows for the city
 */
export function pairOrderTransfers(odooRows: SourceRow[], floorRows: SourceRow[]): TransferPairing {
  const floorIn = new Set(
    floorRows.filter((r) => r.direction === "IN").map((r) => canonicalize(r.barcode))
  );
  const inLegs = new Map<string, SourceRow[]>();
  for (const r of odooRows) {
    if (r.direction !== "IN" || r.orderTransferRef) continue;
    const k = canonicalize(r.barcode);
    (inLegs.get(k) ?? inLegs.set(k, []).get(k)!).push(r);
  }

  const out: TransferPairing = { unpaired: [], paired: [], dropInLegs: new Set() };
  const used = new Set<SourceRow>();
  for (const ot of odooRows.filter(isTransferOut)) {
    const t = timeOf(ot);
    let best: SourceRow | null = null;
    let bestGap = Infinity;
    for (const cand of inLegs.get(canonicalize(ot.barcode)) ?? []) {
      if (used.has(cand)) continue;
      const c = timeOf(cand);
      if (t == null || c == null) continue;
      const gap = Math.abs(c - t);
      if (gap <= PAIR_WINDOW_MS && gap < bestGap) {
        best = cand;
        bestGap = gap;
      }
    }
    if (!best) {
      out.unpaired.push(ot);
      continue;
    }
    used.add(best);
    out.paired.push(ot);
    // A floor book that saw the unit come in makes that IN a real return the
    // transfer followed — it stays in the check like any other receipt.
    if (!floorIn.has(canonicalize(best.barcode))) out.dropInLegs.add(best);
  }
  return out;
}
