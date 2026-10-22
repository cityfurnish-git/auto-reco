// One vocabulary, kept whole.
//
// The phrases are keyed by the STORED variance name, which means the map can
// fall behind in two ways that no type checker can see: a new variance name is
// added to the engine and never phrased, or a phrase quietly reintroduces one
// of the words this change existed to retire ("Ops Sheet", "Gate Register",
// "DT"). Both produce a screen that reads like two systems, which is the state
// this replaced.

import { describe, it, expect } from "vitest";
import { VARIANCE } from "../../lib/engine/variance-names";
import { variancePhrase, phrasedNames } from "../../lib/ui/variance-phrases";
import { labelFor, UNLABELLED } from "../../lib/ui/variance-labels";
import { SOURCE_LABEL, SOURCE_NAME, sourceLabel } from "../../lib/ui/source-names";

/**
 * Names produced by no current code path, still on stored rows. Re-measured on
 * 22 Oct 2026: 38 distinct spellings across 36,647 rows, of which these nine
 * predate the names migration 0051 rewrote. They are phrased so an old row
 * reads like a current one; a rename of the constants could never do that,
 * which is the argument for the whole display-layer approach.
 */
const OBSOLETE_BUT_STORED = [
  "Odoo-Only Entry — No Floor Record",
  "Register/DT Logged — Not in Odoo",
  "DT Missing — Ops & Odoo Agree",
  "Ops Sheet Missing — DT & Odoo Agree",
  "Sheet-Only Dispatch — No Trail",
  "DT-Only — Fake Scan Risk",
  "Duplicate Scan / Multi-Source Mismatch",
  // Added 22 Oct 2026: one row each, never phrased until the rename migration's
  // own test went looking for the gap.
  "Physical + Odoo Agree — No Register/DT",
  "All-Source Field Mismatch",
];

describe("every variance a person can see has a phrase", () => {
  it("covers every name the engine produces", () => {
    const missing = Object.values(VARIANCE).filter((n) => !variancePhrase(n));
    expect(missing, `add these to lib/ui/variance-phrases.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers the names only history still holds", () => {
    const missing = OBSOLETE_BUT_STORED.filter((n) => !variancePhrase(n));
    expect(missing).toEqual([]);
  });

  it("gives an obsolete name a real heading, not Unclassified", () => {
    // Phrasing them was half the job. Until labelFor learned the same seven
    // names, every one of those rows printed "Unclassified" above a perfectly
    // good sentence — which reads as a broken tool rather than as history.
    const unlabelled = OBSOLETE_BUT_STORED.filter((n) => labelFor(n).display === UNLABELLED.display);
    expect(unlabelled, `teach RENAMED in variance-labels.ts: ${unlabelled.join(", ")}`).toEqual([]);
  });

  it("says nothing about a name it has not been taught", () => {
    // Null, not the raw name: the short name is shown above the phrase, and
    // echoing an unphrased engine name there would read as a second heading.
    expect(variancePhrase("Something Nobody Has Phrased")).toBeNull();
    expect(variancePhrase(null)).toBeNull();
    expect(variancePhrase("")).toBeNull();
  });
});

describe("the retired vocabulary never comes back", () => {
  // The words these four replaced. A phrase containing one means the screen is
  // back to naming the same book two ways.
  // Updated 22 Oct 2026: the owner asked for "Guard" and "DT", and gave the
  // four books as Odoo / Guard / DT / MS. The spelled-out names chosen on
  // 15 Sep join the retired list — they were written for a reader who had never
  // seen the tool, and are not what the warehouse says out loud.
  const RETIRED = [
    "Ops Sheet", "Ops sheet", "Gate Register", "Gate register", "Delivery app",
    "Physical", "Manual Sheet", "Delivery Tracker", "Guard Check",
  ];

  it("no phrase uses a retired word", () => {
    const offenders: string[] = [];
    for (const name of phrasedNames()) {
      const phrase = variancePhrase(name)!;
      for (const word of RETIRED) if (phrase.includes(word)) offenders.push(`${name} → ${phrase}`);
    }
    expect(offenders).toEqual([]);
  });

  // THE OWNER ASKED FOR THE ABBREVIATION. "Use 'Guard' and 'DT'" (22 Oct
  // 2026) — his team says DT out loud, so the rule that used to forbid it is
  // now the rule that requires it: no phrase may spell the tracker out.
  it("never spells the tracker out", () => {
    const offenders = phrasedNames()
      .map((n) => variancePhrase(n)!)
      .filter((ph) => /delivery tracker/i.test(ph));
    expect(offenders).toEqual([]);
  });

  it("every phrase names only the four books", () => {
    const allowed = Object.values(SOURCE_NAME);
    expect(allowed).toEqual(["Odoo", "MS", "DT", "Guard"]);
    // A phrase in the presence grammar must name at least one of them.
    for (const name of phrasedNames()) {
      const phrase = variancePhrase(name)!;
      if (!phrase.startsWith("Seen by")) continue;
      expect(allowed.some((a) => phrase.includes(a)), `${name} → ${phrase}`).toBe(true);
    }
  });
});

describe("the stored source codes each have a name", () => {
  it("names all five, including the one that is not a book", () => {
    expect(SOURCE_LABEL).toEqual({
      Odoo: "Odoo",
      Sheet: "MS",
      DT: "DT",
      Physical: "Guard",
      // Raised when the sources contradict each other rather than one being
      // silent — not a book, so not given a book's name.
      Cross: "Cross-check",
    });
  });

  it("an absent source is a dash, never a blank or the word null", () => {
    expect(sourceLabel(null)).toBe("—");
    expect(sourceLabel(undefined)).toBe("—");
  });
});
