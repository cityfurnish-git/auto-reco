// Migration 0051 renames 36,647 stored rows to the plain names. It is hand-
// written SQL and the names live in TypeScript, so the two can drift silently —
// and a target that is one character off the constant does not fail: it writes
// a name no filter, phrase or label knows, on every row it touches.
//
// This reads the migration and checks it against the code.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VARIANCE } from "../../lib/engine/variance-names";
import { variancePhrase } from "../../lib/ui/variance-phrases";
import { searchAliases } from "../../lib/ui/variance-labels";

const SQL = readFileSync("supabase/migrations/0051_plain_variance_names.sql", "utf8");

/** Every `set variance_name = '…'` target, un-escaped. */
const targets = [...SQL.matchAll(/set variance_name = '((?:[^']|'')*)'/g)].map((m) =>
  m[1].replace(/''/g, "'")
);
/** Every `variance_name = '…'` the statements match ON, which are the old names. */
const sources = [...SQL.matchAll(/variance_name = '((?:[^']|'')*)'\s*(?:--|\n\s*and|;)/g)].map((m) =>
  m[1].replace(/''/g, "'")
);

describe("migration 0051 against the code", () => {
  it("renames to names the engine actually produces", () => {
    const live = new Set<string>(Object.values(VARIANCE));
    const strays = [...new Set(targets)].filter((t) => !live.has(t));
    expect(strays, `not in VARIANCE: ${strays.join(" | ")}`).toEqual([]);
  });

  it("covers every name the engine produces", () => {
    // A constant with no rename statement leaves its rows on the old spelling.
    const renamed = new Set(targets);
    const missed = Object.values(VARIANCE).filter((n) => !renamed.has(n));
    expect(missed, `no rename for: ${missed.join(" | ")}`).toEqual([]);
  });

  it("renames each name exactly once", () => {
    // Two statements writing the same target means one of the old spellings is
    // wrong, or the same rows are touched twice.
    const seen = new Map<string, number>();
    for (const t of targets) seen.set(t, (seen.get(t) ?? 0) + 1);
    // Nine targets are written twice ON PURPOSE: a pre-0010 spelling folded onto
    // the same new name as its successor. Those statements carry the NOT EXISTS
    // guard, so count the guarded ones and expect exactly that many doubles.
    const guarded = (SQL.match(/not exists \(/g) ?? []).length;
    const doubled = [...seen.values()].filter((n) => n === 2).length;
    expect(doubled).toBe(guarded);
    expect([...seen.values()].every((n) => n <= 2)).toBe(true);
  });

  // THE ROW THE MIGRATION CANNOT REACH still has to read. Every old spelling it
  // matches on stays mapped in the phrase bridge, so a row written mid-rollout
  // or restored from a backup shows a sentence rather than a blank.
  it("leaves every old spelling readable", () => {
    const unreadable = [...new Set(sources)].filter((s) => !variancePhrase(s));
    expect(unreadable, `no phrase for: ${unreadable.join(" | ")}`).toEqual([]);
  });

  it("wraps the whole thing in one transaction", () => {
    expect(SQL).toMatch(/^\s*(--[^\n]*\n|\n)*begin;/);
    expect(SQL).toContain("commit;");
  });
});

describe("an old name still finds its rows", () => {
  // The promise made when the history was renamed: a name off an older
  // screenshot, email or CSV export still finds the row, which now stores the
  // new spelling. Without this the honest answer the screen gives is "no
  // results", which reads as "that variance never happened".
  it("maps a pre-rename spelling to the name now stored", () => {
    expect(searchAliases("Gate Register Only")).toEqual([VARIANCE.GATE_ONLY]);
    expect(searchAliases("ODD HOUR")).toEqual([VARIANCE.ODD_HOUR_TRIP]);
    expect(searchAliases("Posted Next Day")).toEqual([VARIANCE.ODOO_POSTED_NEXT_DAY]);
  });

  it("maps the spellings that predate migration 0010 as well", () => {
    expect(searchAliases("Fake Scan Risk")).toEqual([VARIANCE.DT_ONLY]);
    expect(searchAliases("Sheet-Only Dispatch")).toEqual([VARIANCE.SHEET_ONLY]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(searchAliases("  gate register only  ")).toEqual([VARIANCE.GATE_ONLY]);
  });

  // A SHORT STRING MUST NOT DRAG IN HALF THE TABLE. "ops" appears in a dozen
  // old names; a two-letter fragment would turn a barcode search into a
  // name search.
  it("stays quiet on a fragment too short to mean anything", () => {
    expect(searchAliases("op")).toEqual([]);
    expect(searchAliases("")).toEqual([]);
  });

  it("returns nothing for text no old name contains", () => {
    expect(searchAliases("FUM3XJ22086103")).toEqual([]);
  });
});
