// The movement sheet's Ops Type is typed by hand, and one transposition
// outnumbers the correct spelling.
//
// Measured on October 2026's sheet rows: "PO Inward" across five casings,
// "PO Inwards" twice, and "Po Inwrad" 244 times. isVendorJob tested the exact
// string, so those 244 never reached the vendor-receipt rule — in Delhi that
// put 151 vendor receipts on the chase list as missing DT jobs, every one of
// them a letter swap rather than a lost unit.

import { describe, expect, it } from "vitest";
import { isVendorJob, normalizeJobType } from "../../lib/engine/util";

describe("normalizeJobType folds the PO inward spellings", () => {
  it("folds every spelling the sheet actually holds", () => {
    for (const raw of ["PO Inward", "Po Inward", "po Inward", "PO inward", "PO INWARD", "PO Inwards", "Po Inwrad", "po inwrad"])
      expect(normalizeJobType(raw), raw).toBe("PO_INWARD");
  });

  // A MONEY JOB IS NOT A RECEIPT, which is why this folds one word and not the
  // whole "PO_…" family.
  it("leaves other PO jobs alone", () => {
    expect(normalizeJobType("PO Payment")).toBe("PO_PAYMENT");
    expect(normalizeJobType("PO Return")).toBe("PO_RETURN");
  });

  it("still uppercases and underscores everything else", () => {
    expect(normalizeJobType("pickup and refund")).toBe("PICKUP_AND_REFUND");
    expect(normalizeJobType("  new-rental ")).toBe("NEW_RENTAL");
    expect(normalizeJobType("")).toBeNull();
    expect(normalizeJobType(null)).toBeNull();
  });
});

describe("isVendorJob", () => {
  // ROWS STORED BEFORE THE FOLD KEEP THEIR SPELLING, so a re-check of an old
  // day has to grade them the same way as a fresh one.
  it("recognises the misspellings already in the database", () => {
    for (const j of ["PO_INWARD", "PO_INWRAD", "PO_INWARDS", "PO_INWRADS"])
      expect(isVendorJob(j), j).toBe(true);
  });

  it("recognises a vendor job by word", () => {
    expect(isVendorJob("VENDOR_RECEIPT")).toBe(true);
  });

  it("does not treat a PO payment as a receipt", () => {
    expect(isVendorJob("PO_PAYMENT")).toBe(false);
    expect(isVendorJob("NEW_RENTAL")).toBe(false);
    expect(isVendorJob(null)).toBe(false);
  });
});
