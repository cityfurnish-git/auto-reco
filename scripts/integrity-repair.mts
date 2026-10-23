// One-off repair for the 23 Oct 2026 integrity audit. Dry run by default.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/integrity-repair.mts            # what it would change
//   npx tsx scripts/integrity-repair.mts --apply    # back up, then change
//
// Every change is what the FIXED code does on its own to a row it re-judges,
// applied to rows outside the re-check window that it will never re-judge:
//   cleared-on-chase-list  back to INFO / Info (0051's regrade undone)
//   stale-ticks            ticks and reported flags from the latest ledger
//   stale-chase  CLEAN     resolved late: INFO, the cleared note, fresh ticks
//   stale-chase  SUPPRESSED, and a second name beside "Delivery failed":
//                          CLOSED with a reason — never deleted, so the
//                          trail stays (the live code would hard-delete them)
//   grading                priority from chasePriority (books that reported)
//
// Before --apply writes anything, every row it will touch is saved in full
// to ../reports/integrity-backup-<timestamp>.json (outside the repository —
// rows carry customer names).
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { checkRows, ledgerKey, readDate, type IntegrityRow, type LedgerFlags } from "../lib/integrity/checks";
import { chasePriority } from "../lib/engine/buckets";
import { RESOLVED_LATE_NOTE } from "../lib/engine/resolution";
import { VARIANCE } from "../lib/engine/variance-names";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const NOW = new Date().toISOString();
const CLOSE_NOTE = (why: string) => `Integrity repair 23 Oct 2026: ${why}`;

type Patch = Record<string, unknown>;
const patches = new Map<string, { patch: Patch; why: string }>();
const merge = (id: string, patch: Patch, why: string) => {
  const cur = patches.get(id);
  patches.set(id, { patch: { ...(cur?.patch ?? {}), ...patch }, why: cur ? `${cur.why}; ${why}` : why });
};
const ticks = (L: LedgerFlags, r: IntegrityRow & { ledgerReported?: Record<string, boolean> }) => ({
  present_p: L.present.P, present_s: L.present.S, present_d: L.present.D, present_o: L.present.O,
  ...(r.ledgerReported ?? {}),
});

// Reported flags live on the ledger too; read them alongside.
async function ledgerReported(date: string): Promise<Map<string, Record<string, boolean>>> {
  const out = new Map<string, Record<string, boolean>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("movement_events")
      .select("business_date, city, direction, barcode, reported_p, reported_s, reported_d, reported_o")
      .eq("business_date", date).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const e of data ?? []) out.set(ledgerKey(e), {
      reported_p: !!e.reported_p, reported_s: !!e.reported_s, reported_d: !!e.reported_d, reported_o: !!e.reported_o,
    });
    if (!data || data.length < 1000) break;
  }
  return out;
}

const dates = new Set<string>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("variances").select("business_date").in("status", ["open", "in_progress"])
    .order("business_date").range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) dates.add(r.business_date as string);
  if (!data || data.length < 1000) break;
}

for (const d of [...dates].sort()) {
  const { rows, ledger } = await readDate(db, d);
  const rep = await ledgerReported(d);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const f of checkRows(rows, ledger)) {
    for (const id of f.ids) {
      const r = byId.get(id)!;
      const L = ledger.get(ledgerKey(r));
      const withRep = { ...r, ledgerReported: rep.get(ledgerKey(r)) };
      switch (f.rule) {
        case "cleared-on-chase-list":
          merge(id, { bucket: "INFO", priority: "Info" }, "cleared row back to a note");
          break;
        case "stale-ticks":
          if (L) merge(id, ticks(L, withRep), "ticks from the latest records");
          break;
        case "stale-chase":
          if (L?.outcome === "CLEAN") {
            merge(id, { bucket: "INFO", priority: "Info", dampened: true, note: RESOLVED_LATE_NOTE, last_seen_at: NOW, ...ticks(L, withRep) },
              "latest records clean — resolved late");
          } else if (L?.outcome === "SUPPRESSED") {
            merge(id, { status: "closed", closure_reason: "System Glitch", closed_at: NOW,
              closure_note: CLOSE_NOTE("the engine now deliberately does not raise this unit (an explained pattern), so this row was superseded.") },
              "superseded — deliberately not raised now");
          }
          break;
        case "two-names": {
          const failed = rows.some((x) => ledgerKey(x) === ledgerKey(r) && x.variance_name === VARIANCE.FAILED_DELIVERY);
          if (failed && r.variance_name !== VARIANCE.FAILED_DELIVERY) {
            merge(id, { status: "closed", closure_reason: "System Glitch", closed_at: NOW,
              closure_note: CLOSE_NOTE("the delivery failed, so this unit's only question is whether it came back — the 'Delivery failed' item carries it. This second name was superseded.") },
              "second name beside Delivery failed");
          }
          break;
        }
        case "grading": {
          const want = chasePriority(r.variance_name,
            { P: !!r.reported_p, S: !!r.reported_s, D: !!r.reported_d, O: !!r.reported_o }, r.priority as "High");
          merge(id, { bucket: want.bucket, priority: want.priority }, `graded ${want.priority} by books that reported`);
          break;
        }
      }
    }
  }
}

const tally = new Map<string, number>();
for (const { why } of patches.values()) for (const w of why.split("; ")) tally.set(w, (tally.get(w) ?? 0) + 1);
console.log(`${patches.size} rows to change${APPLY ? "" : " (dry run)"}:`);
for (const [w, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${w}`);
if (!APPLY) process.exit(0);

// Back up every row in full before the first write.
const ids = [...patches.keys()];
const backup: unknown[] = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await db.from("variances").select("*").in("id", ids.slice(i, i + 200));
  if (error) throw new Error(`backup: ${error.message}`);
  backup.push(...(data ?? []));
}
if (backup.length !== ids.length) throw new Error(`backup read ${backup.length} of ${ids.length} rows — stopping before any write`);
mkdirSync("../reports", { recursive: true });
const file = `../reports/integrity-backup-${NOW.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(backup, null, 1));
console.log(`Backed up ${backup.length} rows to ${file}`);

// Grouped by identical patch, so it is dozens of updates rather than thousands.
const groups = new Map<string, { patch: Patch; ids: string[] }>();
for (const [id, { patch }] of patches) {
  const k = JSON.stringify(patch);
  const g = groups.get(k) ?? { patch, ids: [] };
  g.ids.push(id);
  groups.set(k, g);
}
let done = 0;
for (const g of groups.values()) {
  for (let i = 0; i < g.ids.length; i += 200) {
    const chunk = g.ids.slice(i, i + 200);
    // Only rows still open — a person may have acted on one since the read.
    const { error, count } = await db.from("variances").update(g.patch, { count: "exact" })
      .in("id", chunk).in("status", ["open", "in_progress"]);
    if (error) throw new Error(`update: ${error.message} (after ${done} rows)`);
    done += count ?? 0;
  }
}
console.log(`Updated ${done} rows.`);
