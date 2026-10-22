// "Source" on the dashboard — the book that is MISSING the entry.
//
// Owner, 22 Oct 2026: "Instead of 'owner', replace it with source
// (Odoo/Guard/DT/MS)". The filter it replaced named a TEAM; this one names a
// book, which is the thing a chaser actually goes and asks about.
//
// WHY NOT THE STORED variance_source COLUMN, which already exists and looks
// like the obvious answer: it names the book that STANDS OUT, and for the
// *_ONLY family that is the book which DID record the unit. Delhi's biggest
// October group — 482 rows where Guard and Odoo both hold the unit and MS and
// DT do not — is filed there under Guard, the one book that did its job, so
// "Source = Guard" would have answered mostly with the Guard being right.

import { describe, expect, it } from "vitest";
import { namesAccusing, SOURCE_FILTER_KEY, absenceClaim } from "../../lib/engine/absence-claim";
import { VARIANCE } from "../../lib/engine/variance-names";
import { varianceSource } from "../../lib/engine/variance-source";

describe("the four values the filter offers", () => {
  it("maps each to the book the absence table uses", () => {
    expect(SOURCE_FILTER_KEY).toEqual({ Guard: "P", MS: "S", DT: "D", Odoo: "O" });
  });

  it("offers something under every book", () => {
    for (const [label, key] of Object.entries(SOURCE_FILTER_KEY)) {
      expect(namesAccusing(key).length, `${label} has no names`).toBeGreaterThan(0);
    }
  });
});

describe("what picking a source returns", () => {
  it("includes a name only when that book is the one short", () => {
    expect(namesAccusing("P")).toContain(VARIANCE.SHEET_DT_ODOO_NO_GATE);
    expect(namesAccusing("P")).toContain(VARIANCE.OPS_ODOO_NO_GATE);
    // Guard HAS the unit in this one — it is MS and DT that are short.
    expect(namesAccusing("P")).not.toContain(VARIANCE.GATE_ODOO_NO_OPS_DT);
  });

  // THE CASE THAT MAKES THE COLUMN UNUSABLE AND THIS CORRECT. 482 rows in Delhi
  // in October, the largest single group in the system.
  it("files the biggest group under the books that are actually missing", () => {
    const name = VARIANCE.GATE_ODOO_NO_OPS_DT;
    expect(varianceSource(name)).toBe("Physical"); // the stored column: the Guard
    expect(absenceClaim(name)).toEqual(["S", "D"]); // the truth: MS and DT
    expect(namesAccusing("S")).toContain(name);
    expect(namesAccusing("D")).toContain(name);
    expect(namesAccusing("O")).not.toContain(name);
  });

  it("lists a two-books-short movement under both of them", () => {
    const name = VARIANCE.GATE_OPS_NO_DT_ODOO; // Guard and MS have it
    expect(namesAccusing("D")).toContain(name);
    expect(namesAccusing("O")).toContain(name);
    expect(namesAccusing("P")).not.toContain(name);
    expect(namesAccusing("S")).not.toContain(name);
  });

  it("lists a three-books-short movement under all three", () => {
    const name = VARIANCE.GATE_ONLY; // only the Guard saw it
    expect(namesAccusing("S")).toContain(name);
    expect(namesAccusing("D")).toContain(name);
    expect(namesAccusing("O")).toContain(name);
    expect(namesAccusing("P")).not.toContain(name);
  });

  // NOT EVERY PROBLEM IS A MISSING ENTRY. A duplicate scan, a barcode that does
  // not exist yet, a status conflict — these belong to no book, and appearing
  // under one would send somebody to ask a question that has no answer.
  it("leaves the problems that are not about a missing book out of every source", () => {
    for (const name of [VARIANCE.DUPLICATE, VARIANCE.BARCODE_OVERDUE, VARIANCE.ODD_HOUR_TRIP, VARIANCE.FIELD_MISMATCH]) {
      for (const key of ["P", "S", "D", "O"] as const) {
        expect(namesAccusing(key), `${name} under ${key}`).not.toContain(name);
      }
    }
  });
});
