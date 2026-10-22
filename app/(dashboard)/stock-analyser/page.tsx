// Stock Analyser route. Server component so the session resolves before render;
// the client half receives an already-typed user, matching dashboard/page.tsx.
//
// Admin-only, and listed in middleware.ts's ADMIN_ONLY_PATHS. Unlike the pending
// list, this page is inherently cross-city: it reads per-run snapshots and the
// movement ledger for every warehouse at once, and a manager's slice of a global
// run's coverage would be actively misleading rather than merely partial.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { istDate, recheckTargetDate } from "@/lib/reconcile/cron-dates";
import StockAnalyserClient from "./stock-analyser-client";

export default async function StockAnalyserPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  // Open on the day the re-check pass most recently re-ran — the newest date that
  // can actually HAVE two checks. Opening on yesterday would show "only checked
  // once" every single time.
  //
  // NO CALENDAR HERE ON PURPOSE. recheckTargetDate takes one, and the digest
  // cron passes it because the date it re-runs has to be right. This is the
  // date a PICKER opens on, so a day either side costs a click and not a wrong
  // answer — not worth a database read on every page render.
  return <StockAnalyserClient today={istDate()} defaultDate={recheckTargetDate()} />;
}
