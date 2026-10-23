// GET /api/barcode-history?barcode=… — one unit's whole recorded life.
//
// Replaces the "Ask AI" chat (owner, 23 Oct 2026: "only a single function —
// a barcode's history whenever looked up"). No model in the loop: the answer
// is the stored record, read exactly, so it is instant, free and cannot be
// worded wrongly. The chat also depended on a GROQ key that production no
// longer carries.
//
// Three tables, all RLS-scoped through the cookie client — a manager sees
// their own city's history and nothing else, with no check written here:
//   movement_events  every day the unit moved, which books saw it (kept since
//                    22 Jul 2026; never pruned)
//   variances        anything raised about it, and what became of it
//   gate_scans       the gate's own record, with the time it crossed
//
// gate_scans stores the barcode as SCANNED, not canonical (AP8IS7… where the
// ledger holds AP8157…), so it is matched on every spelling the other books
// recorded for this unit plus what was typed — never on the canonical alone.

import { NextResponse, type NextRequest } from "next/server";
import { jsonRoute } from "@/lib/api/json-route";
import { createClient } from "@/lib/supabase/server";
import { canonicalize } from "@/lib/engine/barcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One unit rarely moves more than a few times a month; this is months. */
const LIMIT = 400;

export const GET = jsonRoute("barcode-history", async (req: NextRequest) => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const typed = (req.nextUrl.searchParams.get("barcode") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (typed.length < 4) {
    return NextResponse.json({ error: "Type at least 4 characters of the barcode" }, { status: 400 });
  }
  const barcode = canonicalize(typed);

  const [moves, flags] = await Promise.all([
    supabase
      .from("movement_events")
      .select("business_date, city, direction, barcode_display, present_p, present_s, present_d, present_o, reported_p, reported_s, reported_d, reported_o, outcome, variance_names, suppressed_reason, product, customer, so_number, ticket_id, job_type")
      .eq("barcode", barcode)
      .order("business_date", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("variances")
      .select("business_date, city, direction, barcode_display, variance_name, bucket, status, closure_reason, closure_note, closed_at, responsible")
      .eq("barcode", barcode)
      .order("business_date", { ascending: false })
      .limit(LIMIT),
  ]);
  if (moves.error) return NextResponse.json({ error: moves.error.message }, { status: 500 });
  if (flags.error) return NextResponse.json({ error: flags.error.message }, { status: 500 });

  const spellings = new Set<string>([typed]);
  for (const r of [...(moves.data ?? []), ...(flags.data ?? [])]) {
    if (r.barcode_display) spellings.add(String(r.barcode_display).toUpperCase());
  }
  const scans = await supabase
    .from("gate_scans")
    .select("business_date, city, direction, barcode, scanned_at, status, unit_product, task_customer, task_so")
    .in("barcode", [...spellings])
    .order("scanned_at", { ascending: false })
    .limit(LIMIT);
  // The gate is the extra witness, not the spine: a failed read costs the scan
  // times and says so, it does not fail the lookup.
  const gateError = scans.error ? scans.error.message : null;

  // What a person reads: a spelling a source actually wrote, never the fold.
  const display = (moves.data?.[0]?.barcode_display as string | undefined) ?? typed;
  return NextResponse.json({
    display,
    canonical: barcode,
    movements: moves.data ?? [],
    flags: flags.data ?? [],
    scans: scans.data ?? [],
    gateError,
    truncated: (moves.data?.length ?? 0) >= LIMIT,
  });
});
