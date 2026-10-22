// Single source of truth for variance names. Every place that emits, classifies,
// buckets, attributes a source to, or short-labels a variance references these
// constants, so the exact string can never drift across files — the DB stores it
// verbatim, and the email "Top Gap" labels + source-attribution map key off it.
//
// ONE WORD PER BOOK, AND THE MISSING THING FIRST (owner, 22 Oct 2026: "I still
// don't know the purpose of these filters" / "use Guard and DT").
//
//   Guard = the guard's gate app · MS = the ops movement sheet · DT = the
//   Delivery Tracker app · Odoo = Odoo. "The floor" means Guard and MS
//   together, for the rules that accept either.
//
// The old names encoded the full four-book state — "Gate + Ops + Odoo Confirm —
// DT Scan Pending" — which is precise and reads as arithmetic: you subtract
// three books from four to learn what is actually missing, and the answer sits
// at the end of the sentence. The same book was also called Ops, Ops Sheet,
// Sheet and Floor in different names, and 36 of these appeared in Delhi in
// three weeks inside a 220px dropdown that truncated them to their shared
// prefixes.
//
// THE SHAPE OF THE SENTENCE NOW CARRIES THE SEVERITY, so a reader can rank the
// list without reading the detail:
//
//   "Only X saw it"             three books short — one system claims a
//                               movement the other three never saw
//   "Not in X or Y — …"         two books short
//   "No X — the other three agree"  one book short, usually a typing lag
//   named for what it is        not an absence at all: a timing problem, a
//                               barcode problem, or a decision for a person
//
// Renamed in the stored rows too (migration 0051), so a closed row from last
// month reads the same as today's. lib/ui/variance-phrases.ts keeps the old
// spellings mapped for anything the migration cannot reach.

export const VARIANCE = {
  // ── REAL — chase list ──────────────────────────────────────────────────
  WRONG_SCAN: "Wrong barcode scanned in DT",
  FLOOR_DT_NOT_ODOO: "Not in Odoo — the floor and DT saw it",
  GATE_OPS_NO_DT_ODOO: "Not in DT or Odoo — Guard and MS saw it",
  GATE_ONLY: "Only the Guard saw it",
  SHEET_ONLY: "Only MS has it",
  PICKUP_ODOO_OPEN: "Odoo receipt still open — Guard and DT saw the pickup",
  DT_ONLY: "Only DT saw it",
  REPLACEMENT_CONFIRM: "Same unit out and back today — confirm swap",
  FAILED_DELIVERY: "Delivery failed — unit never came back in",
  SHEET_NOT_DONE_BUT_POSTED: "MS says not delivered — DT and Odoo say done",
  ODOO_ONLY_TODAY: "Only Odoo has it, and it was typed today",
  // An Odoo line whose sale order is an ORDER TRANSFER (Reference# "OT-…").
  // Cannot be matched automatically — nothing crosses the gate — so it is
  // raised on its own for the team to map by hand. Owner's call, 18 Sep 2026.
  OT_CASE: "Order transfer — needs manual mapping",
  /**
   * A trip the gate opened at an hour this warehouse does not work.
   * Raised per TRIP, not per unit — the question is about the trip — and the
   * only variance in the system not produced by the per-barcode ladder. See
   * lib/reconcile/odd-hour-trips.ts.
   */
  ODD_HOUR_TRIP: "Moved at an odd hour",
  /**
   * THREE BOOKS HAVE IT AND ONE DOES NOT (owner, 6 Oct 2026). These two were
   * split out so the three-book cases can be chased while the two-book ones
   * stay informational — the owner's rule is that three independent records
   * agreeing makes the fourth book's silence somebody's job.
   *
   * SHEET_DT_ODOO_NO_GATE was previously folded into OPS_ODOO_NO_GATE, which
   * covered BOTH the two-book and three-book shapes under one name; it could
   * not be promoted or named clearly without separating them.
   *
   * GATE_DT_ODOO_NO_SHEET had no name at all: of the fifteen ways four books
   * can disagree, it was the only one the ladder answered with silence.
   */
  /**
   * Odoo posted the movement AFTER its deadline — 3pm on the next day the
   * warehouse opens. Owner, 6 Oct 2026: a posting inside the grace period is
   * the business working normally and stays INFO; past it, the policy was
   * breached and somebody owns it. Split from the two "entry made late" names
   * rather than re-bucketing them, so the row says which of the two it is.
   */
  ODOO_PAST_DEADLINE: "Odoo posted after the deadline",
  /**
   * An item logged at the gate with no barcode, still unassigned 24 hours
   * later. Owner, 6 Oct 2026. Raised per GATE ENTRY, not per canonical barcode
   * — there is no barcode yet, which is the finding — so like ODD_HOUR_TRIP it
   * comes from outside the ladder and the stale pass skips it.
   */
  BARCODE_OVERDUE: "Arrived over 24 hours ago, still no barcode",
  SHEET_DT_ODOO_NO_GATE: "No Guard scan — the other three agree",
  GATE_DT_ODOO_NO_SHEET: "No MS line — the other three agree",

  // ── INFO — audit / posting-lag, no chase ───────────────────────────────
  // Measured 2026-07-20: 220/230 of these ALSO had a DT scan — Sheet+DT+Odoo,
  // three independent systems, all confirming; only the handwritten register
  // (via OCR) missed it. A gate-log hygiene gap, never a stock loss.
  OPS_ODOO_NO_GATE: "No Guard scan — MS and Odoo saw it",
  ADJACENT_DAY: "Logged on the wrong day",
  ODOO_ONLY: "Only Odoo has it",
  ODOO_POSTED_NEXT_DAY: "Odoo posted the next day",
  // The same fact as ODOO_POSTED_NEXT_DAY, for a posting too far out to be in
  // the ±1 pull window. Vendor PO receipts are the whole reason it exists:
  // measured 2026-08-10, EVERY ONE of 162 "PO Inward" sheet rows had its Odoo
  // receipt posted +2 or +3 days later, so the ±1 window could never match one.
  ODOO_POSTED_LATE: "Odoo posted a few days late",
  // An outward unit the GATE or DT saw leave, whose Odoo Out is reserved
  // against its sale order ("Available") but not yet validated. Decided 14 Sep
  // 2026: count that reservation as Odoo's record of the dispatch — only with
  // gate or DT corroboration — and show these apart as "Items in transit".
  ODOO_OUT_PENDING: "In transit — Odoo not yet validated",
  OPS_ODOO_NO_DT: "No DT job — MS and Odoo saw it",
  DT_ODOO_NO_SHEET: "No MS line — DT and Odoo saw it",
  GATE_OPS_ODOO_NO_DT: "No DT job — the other three agree",
  GATE_ODOO_NO_OPS_DT: "Not in MS or DT — Guard and Odoo saw it",
  OPS_DT_ODOO_PENDING: "Not in Odoo yet — MS and DT saw it",
  FIELD_MISMATCH: "All four agree — barcode typed differently",
  DUPLICATE: "Same barcode scanned twice",
} as const;

export type VarianceName = (typeof VARIANCE)[keyof typeof VARIANCE];
