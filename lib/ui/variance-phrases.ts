// The structured phrase under a variance's short name.
//
// Agreed 15 Sep 2026. Two grammars and no third:
//
//   presence   "Missing from C"                      which book has no line
//              (owner, 25 Sep 2026: name only what is MISSING. The four tick
//              columns already say who has it, and reading "Seen by A + B"
//              beside four ticks is the same fact twice.)
//   event      "What happened · detail"             something specific occurred
//
// The engine's own names grew one at a time over months and read like twenty
// separate decisions — "Gate Register Only — No Ops / DT / Odoo Record" beside
// "DT-Only — Fake Scan Risk". The information was right and the reader had to
// re-learn the format on every row.
//
// THE ARGUMENT THIS FILE WAS BUILT ON HAS CHANGED. It used to say that renaming
// the constants would leave every stored row speaking an older language, so the
// cryptic engine name stayed and this sentence was shown beside it. On 22 Oct
// 2026 the owner read those names and could not follow them, so the names
// themselves were rewritten and migration 0051 rewrote the stored rows with
// them — the thing this file existed to avoid, done deliberately and with the
// data brought along.
//
// So the entries below are keyed by VARIANCE.* now, and what remains keyed by a
// literal is a BRIDGE: the pre-rename spellings, plus seven older ones no code
// has produced for months, so a row the migration could not reach still reads
// like a current one.

import { VARIANCE } from "../engine/variance-names";
import { SOURCE_NAME as S } from "./source-names";

const PHRASE: Record<string, string> = {
  // ── Chase list ─────────────────────────────────────────────────────────
  [VARIANCE.GATE_ONLY]: `Missing from ${S.sheet} + ${S.dt} + ${S.odoo}`,
  [VARIANCE.SHEET_ONLY]: `Missing from ${S.gate} + ${S.dt} + ${S.odoo}`,
  [VARIANCE.DT_ONLY]: `Missing from ${S.gate} + ${S.sheet} + ${S.odoo}`,
  [VARIANCE.ODOO_ONLY_TODAY]: `Missing from ${S.gate} + ${S.sheet} + ${S.dt} · Entry created that day`,
  [VARIANCE.FLOOR_DT_NOT_ODOO]: `Missing from ${S.odoo}`,
  [VARIANCE.GATE_OPS_NO_DT_ODOO]: `Missing from ${S.dt} + ${S.odoo}`,
  [VARIANCE.PICKUP_ODOO_OPEN]: `${S.odoo} receipt still open`,
  [VARIANCE.WRONG_SCAN]: `Wrong unit scanned · ${S.dt}`,
  [VARIANCE.REPLACEMENT_CONFIRM]: "Same unit in and out · Confirm replacement",
  [VARIANCE.FAILED_DELIVERY]: "Failed delivery · Return not logged inward",
  [VARIANCE.ODOO_PAST_DEADLINE]: "Odoo posted late · past the deadline",
  [VARIANCE.BARCODE_OVERDUE]: "Received untagged · no barcode after 24h",
  [VARIANCE.SHEET_DT_ODOO_NO_GATE]: "Three books have it · no gate log line",
  [VARIANCE.GATE_DT_ODOO_NO_SHEET]: "Three books have it · no ops sheet line",
  [VARIANCE.ODD_HOUR_TRIP]: `Odd hour · Trip at a time the gate rarely sees`,
  [VARIANCE.OT_CASE]: `OT case · Order transfer in ${S.odoo}, map by hand`,
  [VARIANCE.SHEET_NOT_DONE_BUT_POSTED]: `${S.sheet} says not delivered · ${S.odoo} and ${S.dt} say done`,

  // ── For information ────────────────────────────────────────────────────
  [VARIANCE.OPS_ODOO_NO_GATE]: `Missing from ${S.gate}`,
  [VARIANCE.OPS_ODOO_NO_DT]: `Missing from ${S.dt}`,
  [VARIANCE.DT_ODOO_NO_SHEET]: `Missing from ${S.sheet}`,
  [VARIANCE.GATE_OPS_ODOO_NO_DT]: `Missing from ${S.dt}`,
  [VARIANCE.GATE_ODOO_NO_OPS_DT]: `Missing from ${S.sheet} + ${S.dt}`,
  [VARIANCE.OPS_DT_ODOO_PENDING]: `${S.odoo} posting pending`,
  [VARIANCE.ODOO_ONLY]: `Missing from ${S.gate} + ${S.sheet} + ${S.dt}`,
  [VARIANCE.ODOO_POSTED_NEXT_DAY]: `${S.odoo} posted late · Next day`,
  [VARIANCE.ODOO_POSTED_LATE]: `${S.odoo} posted late · Two days or more`,
  [VARIANCE.ODOO_OUT_PENDING]: `In transit · ${S.odoo} Out not validated`,
  [VARIANCE.ADJACENT_DAY]: "Logged a day either side",
  [VARIANCE.FIELD_MISMATCH]: "All four agree · Barcode text differs",
  [VARIANCE.DUPLICATE]: "Duplicate scan · Same barcode twice",

  // ── Renamed 22 Oct 2026, still on rows a migration could not reach ─────
  // The spellings above these were the stored names until migration 0051
  // rewrote them. The migration covers every row it can see; a row written by
  // an older deployment mid-rollout, or restored from a backup, would otherwise
  // read as a blank. Same phrase as its successor, so it reads like one.
  "Gate Register Only — No Ops / DT / Odoo Record": `Missing from ${S.sheet} + ${S.dt} + ${S.odoo}`,
  "Ops Sheet Only — No Gate / DT / Odoo Record": `Missing from ${S.gate} + ${S.dt} + ${S.odoo}`,
  "DT Only — No Floor or Odoo Record": `Missing from ${S.gate} + ${S.sheet} + ${S.odoo}`,
  "Odoo Entry Created Today — No Gate / Ops / DT Record": `Missing from ${S.gate} + ${S.sheet} + ${S.dt} · Entry created that day`,
  "Moved on Floor + DT — Not Posted in Odoo": `Missing from ${S.odoo}`,
  "Gate + Ops Confirm — No DT Scan or Odoo Post": `Missing from ${S.dt} + ${S.odoo}`,
  "Pickup Logged (Gate + DT) — Odoo Receipt Open": `${S.odoo} receipt still open`,
  "Wrong Barcode Scanned in DT": `Wrong unit scanned · ${S.dt}`,
  "Same Unit In + Out Today — Confirm Replacement": "Same unit in and out · Confirm replacement",
  "Failed Delivery — Return Not Logged Inward": "Failed delivery · Return not logged inward",
  "Odoo Entry Made Late — Past the Posting Deadline": "Odoo posted late · past the deadline",
  "Received Without a Barcode — Not Assigned Within 24 Hours": "Received untagged · no barcode after 24h",
  "Sheet + DT + Odoo Confirm — Missing from Gate Register": "Three books have it · no gate log line",
  "Gate + DT + Odoo Confirm — Missing from Ops Sheet": "Three books have it · no ops sheet line",
  "ODD HOUR TRIP — Movement at a Time the Gate Rarely Sees": `Odd hour · Trip at a time the gate rarely sees`,
  "OT CASE — Order Transfer in Odoo, Map Manually": `OT case · Order transfer in ${S.odoo}, map by hand`,
  "Ops Sheet Says Not Delivered — Posted Done in DT/Odoo": `${S.sheet} says not delivered · ${S.odoo} and ${S.dt} say done`,
  "Ops + Odoo Confirm — Missing from Gate Register": `Missing from ${S.gate}`,
  "Ops + Odoo Confirm — No DT Scan": `Missing from ${S.dt}`,
  "DT + Odoo Confirm — Missing from Ops Sheet": `Missing from ${S.sheet}`,
  "Gate + Ops + Odoo Confirm — DT Scan Pending": `Missing from ${S.dt}`,
  "Gate + Odoo Confirm — No Ops Sheet or DT Scan": `Missing from ${S.sheet} + ${S.dt}`,
  "Ops + DT Confirm — Odoo Posting Pending": `${S.odoo} posting pending`,
  "Odoo Posting Only — No Gate / Ops / DT Record": `Missing from ${S.gate} + ${S.sheet} + ${S.dt}`,
  "Odoo Entry Made Late — Posted Next Day": `${S.odoo} posted late · Next day`,
  "Odoo Entry Made Late — Posted a Few Days On": `${S.odoo} posted late · Two days or more`,
  "Items In Transit — Odoo Out Not Yet Validated": `In transit · ${S.odoo} Out not validated`,
  "Entry Dated Wrong Day — Unit Logged on Adjacent Day": "Logged a day either side",
  "All Sources Agree — Barcode Text Differs (OCR/Typo)": "All four agree · Barcode text differs",
  "Duplicate Scan — Same Barcode Logged Twice": "Duplicate scan · Same barcode twice",

  // ── Obsolete, still stored ─────────────────────────────────────────────
  // No current code path produces these; they are on rows from earlier versions
  // and a reader should not have to know that. Mapped onto the phrase their
  // successor uses, so an old row reads like a current one.
  "Odoo-Only Entry — No Floor Record": `Missing from ${S.gate} + ${S.sheet} + ${S.dt}`,
  "Register/DT Logged — Not in Odoo": `Missing from ${S.odoo}`,
  "DT Missing — Ops & Odoo Agree": `Missing from ${S.dt}`,
  "Ops Sheet Missing — DT & Odoo Agree": `Missing from ${S.sheet}`,
  "Sheet-Only Dispatch — No Trail": `Missing from ${S.gate} + ${S.dt} + ${S.odoo}`,
  "DT-Only — Fake Scan Risk": `Missing from ${S.gate} + ${S.sheet} + ${S.odoo}`,
  "Duplicate Scan / Multi-Source Mismatch": "Duplicate scan · Same barcode twice",
  // Found by tests/db/rename-migration.test.ts, which checks that every spelling
  // the migration touches stays readable. These two were on one row each and had
  // never been phrased — a reader opening either saw a blank second line.
  "Physical + Odoo Agree — No Register/DT": `Missing from ${S.sheet} + ${S.dt}`,
  "All-Source Field Mismatch": "All four agree · Barcode text differs",
};

/**
 * The phrase for a stored variance name, or null when there is none.
 *
 * Null rather than the raw name: a caller showing the short name above this
 * would otherwise repeat a sentence nobody wrote for that row, and a silent
 * blank is the honest answer for a name this file has not been taught.
 */
export const variancePhrase = (name: string | null | undefined): string | null =>
  // `(name && PHRASE[name]) ?? null` looks equivalent and is not: an empty name
  // short-circuits to "" and `??` passes it straight through, so the caller
  // renders an empty second line instead of none.
  name ? PHRASE[name] ?? null : null;

/** Every stored name this module knows — used by the test that keeps it whole. */
export const phrasedNames = (): string[] => Object.keys(PHRASE);
