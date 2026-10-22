// The four books, named once.
//
// Asked for on 15 Sep 2026: one vocabulary across the screens and the emails.
// Before this the same source was "Gate Register" in a variance name, "Physical"
// on a badge, "Gate register" on the scoreboard and "the guard" in an email —
// four words for one book, and a reader had to learn all four to follow a row
// from a dashboard to an inbox.
//
// PRESENTATION ONLY. The stored codes (`Physical`, `Sheet`, `DT`, `Odoo` in
// variances.variance_source, and the source codes inside the engine) are
// untouched: they are what every filter and every query matches on.
//
// So: change the word, never the code. (Variance NAMES are a different matter —
// those were renamed in the rows as well on 22 Oct 2026, because the owner reads
// them and a stored string he cannot understand is not an asset.)

import type { VarianceSource } from "../db/schema";

/**
 * What each book is called, everywhere a person reads it.
 *
 * THE OWNER'S OWN WORDS, 22 Oct 2026: "Use 'Guard' and 'DT'", and the four
 * sources given as "Odoo/Guard/DT/MS". These replace the spelled-out names
 * chosen on 15 Sep ("Guard Check", "Delivery Tracker", "Manual Sheet"), which
 * were written for a reader who had never seen the tool and are not what the
 * warehouse says out loud. One vocabulary is still the rule; these are now the
 * words it uses.
 *
 * MS is the movement sheet — the ops Google sheet. "The floor" is Guard and MS
 * together, for the rules that accept either of them.
 */
export const SOURCE_NAME = {
  odoo: "Odoo",
  sheet: "MS",
  dt: "DT",
  gate: "Guard",
} as const;

/**
 * The stored `variance_source` code → its name.
 *
 * "Cross" is not one of the four books: it is raised when the sources conflict
 * with each other rather than one of them being silent, so it is named for what
 * it is rather than given a book's name.
 */
export const SOURCE_LABEL: Record<VarianceSource, string> = {
  Odoo: SOURCE_NAME.odoo,
  Sheet: SOURCE_NAME.sheet,
  DT: SOURCE_NAME.dt,
  Physical: SOURCE_NAME.gate,
  Cross: "Cross-check",
};

export const sourceLabel = (s: VarianceSource | null | undefined): string =>
  (s && SOURCE_LABEL[s]) || "—";
