// The barcode lookup's story (23 Oct 2026). The first fixture is the unit the
// owner looked up — 0TJ4ED23020023, every ledger row verbatim — which read as
// "came in, came in, came in, went out, went out, went out, came in".
import { describe, expect, it } from "vitest";
import { buildStory, type FlagRow, type LedgerRow } from "../../lib/ui/barcode-story";

const row = (date: string, direction: "IN" | "OUT", books: string, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  business_date: date, city: "DELHI", direction,
  present_p: books.includes("p"), present_s: books.includes("s"), present_d: books.includes("d"), present_o: books.includes("o"),
  reported_p: false, reported_s: true, reported_d: true, reported_o: true,
  outcome: "CLEAN", product: "Premium Foam Mattress King", customer: null, so_number: null, job_type: null,
  ...extra,
});
const AK = { customer: "AKSHAYKUMAR VALJIBHAI VANZA", so_number: "ON-RET-GUR-66160" };
const SR = { so_number: "ON-RET-GUR-77589" };

const MATTRESS: LedgerRow[] = [
  row("2026-07-22", "IN", "o", AK),
  row("2026-07-23", "IN", "sdo", AK),
  row("2026-07-24", "IN", "o", AK),
  row("2026-07-24", "OUT", "do", { ...SR, customer: "SAMTA RAWAL", outcome: "INFO" }),
  row("2026-07-25", "OUT", "so", { ...SR, customer: "SAMTA RAWAL, Samta Rawal", outcome: "INFO" }),
  row("2026-07-26", "OUT", "o", { ...SR, customer: "Samta Rawal" }),
  row("2026-10-22", "IN", "sdo", { ...SR, customer: "Samta Rawal", outcome: "REAL", reported_p: true }),
];
const MATTRESS_FLAGS: FlagRow[] = [
  { business_date: "2026-10-22", city: "DELHI", direction: "IN", variance_name: "No Guard scan — the other three agree", bucket: "REAL", status: "open", closure_reason: null },
  { business_date: "2026-07-25", city: "DELHI", direction: "OUT", variance_name: "No DT job — MS and Odoo saw it", bucket: "INFO", status: "closed", closure_reason: "Aged out" },
];

describe("the owner's mattress, 0TJ4ED23020023", () => {
  const s = buildStory(MATTRESS, MATTRESS_FLAGS, []);

  it("is three movements, not seven rows", () => {
    expect(s.moves.map((m) => `${m.dir} ${m.from}`)).toEqual(["IN 2026-07-22", "OUT 2026-07-24", "IN 2026-10-22"]);
    expect(s.moves.map((m) => m.rows)).toEqual([3, 3, 1]);
  });

  it("joins every book that saw each movement", () => {
    expect(s.moves[1].saw).toEqual({ p: false, s: true, d: true, o: true });
  });

  it("finds no missing leg", () => {
    expect(s.gaps).toEqual([]);
  });

  it("concludes where the unit is and what is open", () => {
    expect(s.now).toEqual({ where: "in", city: "DELHI", since: "2026-10-22", customer: "Samta Rawal" });
    expect(s.openCount).toBe(1);
    expect(s.moves[2].open).toBe(true);
  });

  it("names the customer once, from a floor book's day", () => {
    expect(s.moves[1].customer).toBe("SAMTA RAWAL");
  });

  it("counts the days with the customer", () => {
    expect(s.daysOut.get(1)).toBe(90);
  });

  it("attaches each raised item to its own movement", () => {
    expect(s.moves[1].flags.map((f) => f.status)).toEqual(["closed"]);
    expect(s.moves[2].flags.map((f) => f.status)).toEqual(["open"]);
  });
});

describe("real holes", () => {
  it("out twice with no return between is a missing return", () => {
    const s = buildStory([row("2026-08-01", "OUT", "sdo"), row("2026-09-10", "OUT", "sdo")], [], []);
    expect(s.gaps).toEqual([{ kind: "missing-return", after: "2026-08-01", before: "2026-09-10" }]);
    expect(s.items.map((i) => i.type)).toEqual(["move", "gap", "move"]);
  });

  it("in twice with no dispatch between is a missing dispatch", () => {
    const s = buildStory([row("2026-08-01", "IN", "sdo"), row("2026-08-20", "IN", "sdo")], [], []);
    expect(s.gaps[0].kind).toBe("missing-dispatch");
  });
});

describe("echoes that would fake a loop", () => {
  it("an Odoo-only echo landing after the next movement folds back", () => {
    const s = buildStory(
      [row("2026-08-01", "IN", "sdo"), row("2026-08-02", "OUT", "sdo"), row("2026-08-03", "IN", "o")],
      [], []
    );
    expect(s.moves.map((m) => m.dir)).toEqual(["IN", "OUT"]);
    expect(s.gaps).toEqual([]);
  });

  it("a floor book's in after an out is a real return, not an echo", () => {
    const s = buildStory(
      [row("2026-08-01", "IN", "sdo"), row("2026-08-02", "OUT", "sdo"), row("2026-08-03", "IN", "s")],
      [], []
    );
    expect(s.moves.map((m) => m.dir)).toEqual(["IN", "OUT", "IN"]);
  });

  it("an empty history is no story", () => {
    expect(buildStory([], [], []).now).toBeNull();
  });
});
