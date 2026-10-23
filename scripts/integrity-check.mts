// Integrity check over EVERY open chase row — run before a push.
//
//   set -a; source .env.local; set +a; npx tsx scripts/integrity-check.mts
//
// The same rules the nightly run applies to the date it just wrote
// (lib/integrity/checks.ts), across all dates. Read-only. Exits 1 on any
// finding, so a change that leaves the stored queue contradicting the rules
// is caught before it ships rather than in a screenshot afterwards.
import { createClient } from "@supabase/supabase-js";
import { checkRows, readDate } from "../lib/integrity/checks";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const dates = new Set<string>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("variances")
    .select("business_date")
    .in("status", ["open", "in_progress"])
    .order("business_date", { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) dates.add(r.business_date as string);
  if (!data || data.length < 1000) break;
}

let total = 0;
const byRule = new Map<string, { label: string; n: number; sample: string[] }>();
for (const d of [...dates].sort()) {
  const { rows, ledger } = await readDate(db, d);
  for (const f of checkRows(rows, ledger)) {
    total += f.ids.length;
    const e = byRule.get(f.rule) ?? { label: f.label, n: 0, sample: [] };
    e.n += f.ids.length;
    if (e.sample.length < 3) e.sample.push(`${d}:${f.ids[0]}`);
    byRule.set(f.rule, e);
  }
}

console.log(`Checked ${dates.size} dates of open rows.`);
if (total === 0) {
  console.log("Integrity: clean — every open row obeys every rule.");
} else {
  for (const [rule, e] of byRule) console.log(`  ${String(e.n).padStart(5)}  ${e.label}  [${rule}]  e.g. ${e.sample.join(", ")}`);
  console.log(`Integrity: ${total} finding(s).`);
  process.exit(1);
}
