// Reconcile pipeline — the scheduled entry point.
//   auth (CRON_SECRET) → pull 4 sources → store raw → run engine → upsert
//   variances (closures preserved) → log ingestion → finalize run → prune.
//
// Excluded from middleware auth via the `api/cron` matcher exclusion; this route
// enforces its own bearer-token check. Node runtime (uses the mongodb driver).
// Handles GET (Vercel Cron) and POST (manual / external scheduler / curl).

import { NextResponse, type NextRequest } from "next/server";
import { jsonRoute } from "@/lib/api/json-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { DISABLED_BODY, cronAuthorized, scheduledJobsDisabled } from "@/lib/reconcile/cron-guard";
import { runReconcilePipeline } from "@/lib/reconcile/pipeline";
import { reconcileTargetDate } from "@/lib/reconcile/cron-dates";
import { addDays } from "@/lib/engine/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby ceiling; raise to 300 on Vercel Pro.

// The run closes the business day that SHUT an hour ago, not today — a day's
// books aren't complete while it is still open (ops sheet filled through the
// evening, DT scans trickling in, ~half of Odoo postings landing next day).
// See lib/reconcile/cron-dates.ts for the full cadence; the digest for this run
// goes out 15 minutes later, at 16:45 IST, via /api/cron/email-digest.

// Leave this much of the 60s ceiling unused before starting the re-check pass.
//
// Measured on live run rows: a single pass is p50 36s, p90 53s, and two passes
// therefore do not reliably fit. Three of nine recent days show only ONE cron
// run, and one row from 2026-07-20 is still stranded at status='running' — the
// signature of a platform kill, which loses the response AND leaves that row
// stranded forever (prune_expired only sweeps 'failed').
//
// This guard does not make the second pass fit. It converts an invisible kill
// into a visible, honest skip.

async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Authorised FIRST, so an unauthenticated caller never learns which
  // deployment owns the schedule.
  if (scheduledJobsDisabled()) return NextResponse.json(DISABLED_BODY);
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json(
      { error: "Supabase not configured (need URL + SERVICE_ROLE key)." },
      { status: 500 }
    );
  }

  const explicitDate = req.nextUrl.searchParams.get("date");
  const runDate = explicitDate || reconcileTargetDate();
  const trigger = req.method === "POST" ? "manual" : "cron";
  // Opt out of the OCR step on a targeted re-run. The pg_cron ageing sweep
  // (migration 0018) re-reconciles D-2 .. D-7 every afternoon, and a register
  // still unprocessed days later has failed repeatedly — 10 uploads x 55s of
  // Azure polling inside a 60s function is a tail risk with no upside. Same
  // reasoning the scheduled second pass below already applies to itself.
  //
  // Ignored without an explicit ?date=: the primary pass MUST do its OCR, and a
  // stray query param should never be able to quietly disable it.
  const skipOcr = !!explicitDate && req.nextUrl.searchParams.get("skipOcr") !== null;
  // THE definition of "this is the untouched scheduled pass", which is what the
  // run's recorded role turns on.
  const scheduled = req.method === "GET" && !explicitDate;
  const db = createAdminClient();

  // The whole pipeline lives in lib/reconcile/pipeline.ts (shared with the
  // admin-triggered /api/reconcile route). The digest is NOT sent here — it
  // goes out 15 minutes later via /api/cron/email-digest.
  const startedAt = Date.now();
  const result = await runReconcilePipeline(db, {
    runDate,
    trigger,
    skipOcr,
    role: scheduled ? "primary" : "adhoc",
  });

  // THE SECOND-PASS RE-CHECK MOVED to the digest cron on 28 Sep 2026, with the
  // reasoning that governs it — why it re-runs two days back, why a third pass
  // does not fit, why it skips OCR. It sat here, second in line inside one
  // 60-second function, and was dropped whenever the primary pass ran long:
  // on 25 Sep the primary took 48s against its 40s budget, so the day that
  // most needed re-judging (Wednesday, whose books arrive on Friday after the
  // Thursday week-off) was exactly the one it skipped. The digest is a separate
  // invocation with its own minute, and its own work is done by the time it
  // starts. See app/api/cron/email-digest/route.ts.
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = jsonRoute("cron/reconcile", async (req: NextRequest) => {
  return handle(req);
});
export const POST = jsonRoute("cron/reconcile", async (req: NextRequest) => {
  return handle(req);
});
