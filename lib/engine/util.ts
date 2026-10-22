// Shared normalizers for statuses, job types, and SO numbers.

import type { NormStatus } from "./types";
import { wordClass } from "./ocr-noise";

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Fold each platform's status vocabulary into one of five buckets. Spaces and
// hyphens collapse to "_" first, so "Out for Delivery" → "out_for_delivery",
// "Re-attempt" → "re_attempt". Odoo/DT/Guard hard-set "done"; the ops sheet's
// free-text "Physical Status" is the one that carries real delivery outcomes,
// so the not_done/pending vocabularies are deliberately broad — a term that
// falls through to "unknown" is silently ignored by the failed-delivery rule
// (which keys on "not_done") and the pending/DT-sync suppressions.
export function normalizeStatus(raw: string | undefined | null): NormStatus {
  if (!raw) return "unknown";
  const s = raw.toString().trim().toLowerCase().replace(/[\s-]+/g, "_");
  // THE SHEET'S OWN SPELLINGS. Delhi's ops sheet writes "Delievered", "Not
  // Delievered", "Not Delievred" and "Not Deivered" alongside the correct forms
  // (every distinct value in September 2026). Only the correct spelling was
  // known, so on 16 Sep 22 "Not Delievered" rows read as UNKNOWN — kept and
  // counted as if the delivery had happened, where the same rows spelt
  // correctly on the 14th were rightly left out. Any spelling of "delivered"
  // now reads as one.
  const deliveredLike = (w: string) => /^d[ei]{1,3}l?[ie]{0,3}ve?r?e?d$/.test(w);
  if (s.startsWith("not_") && deliveredLike(s.slice(4))) return "not_done";
  if (deliveredLike(s)) return "done";
  if (
    [
      // the movement physically completed
      "done", "complete", "completed", "closed",
      "delivered", "received", "picked", "pickup", "picked_up", "pick_up",
      "collected", "handover", "handed_over", "dispatched",
    ].includes(s)
  )
    return "done";
  if (
    [
      // in progress — not yet resolved either way
      "pending", "in_transit", "transit", "in_progress", "ongoing", "processing",
      "scheduled", "rescheduled", "reattempt", "re_attempt", "reattempted",
      "assigned", "out_for_delivery", "ofd", "on_the_way", "on_hold", "hold",
      "delivery_pending", "not_attempted",
    ].includes(s)
  )
    return "pending";
  if (
    [
      "not_done", "notdone", "failed", "absent", "missing", "cancelled", "canceled",
      // Ops-sheet "Physical Status" for a failed delivery/pickup — for an
      // outbound leg these mean the unit is coming back and its return must be
      // logged inward (drives the Failed-Delivery rule).
      "not_delivered", "undelivered", "not_received", "not_picked",
      "rto", "return_to_origin", "returned", "return", "rejected", "refused",
      "denied", "declined", "not_reachable", "cnr", "customer_not_available",
      "customer_not_responding", "lost",
    ].includes(s)
  )
    return "not_done";
  if (["non_match", "nonmatch", "mismatch", "wrong", "wrong_scan"].includes(s))
    return "non_match";
  return "unknown";
}

// Uppercased job type; blank → null.
//
// AND ONE SPELLING FOLDED, because the movement sheet's Ops Type is typed by
// hand and one transposition outnumbers the correct spelling. Measured on
// October 2026's sheet rows: "PO Inward" in five casings (295 + 208 + 44 + 10 +
// 5), "PO Inwards" twice — and "Po Inwrad" 244 times. isVendorJob() tested the
// exact string, so a quarter of every month's vendor receipts missed the
// vendor-receipt rule and were chased as missing DT jobs: 151 chase items in
// Delhi in October alone, all of them a letter swap rather than a lost unit.
//
// Folded HERE rather than only in isVendorJob so the stored value is clean too
// — the Ops Type column on the dashboard was splitting one job into two.
export function normalizeJobType(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.toString().trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  return /^PO_INW(AR|RA)DS?$/.test(s) ? "PO_INWARD" : s;
}

export function isRepair(jobType: string | null): boolean {
  return jobType === "REPAIR";
}

export function isReplace(jobType: string | null): boolean {
  return jobType === "REPLACE";
}

export function isNewRental(jobType: string | null): boolean {
  return jobType === "NEW_RENTAL" || jobType === "NEWRENTAL";
}

// Replace-as-Repair equivalence (Section 7): REPAIR or REPLACE.
export function isRepairEquivalent(jobType: string | null): boolean {
  return isRepair(jobType) || isReplace(jobType);
}

export function normalizeSO(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.toString().trim().toUpperCase().replace(/\s+/g, "");
  return s || null;
}

export function blank(v: string | undefined | null): boolean {
  return !v || v.toString().trim() === "";
}

// A row whose Ops Type / job type marks it a non-rental consumable/material,
// not barcode-tracked stock — the ops sheet logs these as line items with an
// SO of "NA". Observed families on the real sheets: "Spare Parts" (toilet
// cleaner, copper pipe, cable wire), "Consumbles"/"Consumables" (barcode roll,
// carbon roll), "Refurb Material" (cooling coil). They must surface as a
// Spare/Consumable INFO row, not a REAL "no trail" variance, even when the
// barcode text itself doesn't say "spare". CONSUM matches the common
// misspelling; REFURB+MAT avoids catching a refurbished rental *unit*.
/**
 * PO_INWARD is how every source's "PO inward" / vendor job type is normalised.
 *
 * STILL TOLERANT OF THE MISSPELLINGS normalizeJobType now folds, because rows
 * stored before that fix keep the spelling they were written with — 240 of
 * Delhi's October rows say PO_INWRAD — and a re-check of an old day must grade
 * them the same way as a fresh one.
 */
export function isVendorJob(jobType: string | null | undefined): boolean {
  const j = (jobType ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  // Not every "PO_…": "PO Payment" is a money job, not a receipt.
  return /^PO_INW(AR|RA)DS?$/.test(j) || j.includes("VENDOR");
}

export function isSpareJobType(jobType: string | undefined | null): boolean {
  if (!jobType) return false;
  const s = jobType.toString().toUpperCase();
  // Also tested through the OCR word-class (digits mapped back to the letters
  // they were misread from), so a register ops column that came through as
  // "5PARE" or "C0NSUM" still diverts to the count lane instead of the ladder.
  const w = wordClass(s);
  return (
    s.includes("SPARE") || w.includes("SPARE") ||
    s.includes("CONSUM") || w.includes("CONSUM") ||
    (s.includes("REFURB") && s.includes("MAT"))
  );
}
