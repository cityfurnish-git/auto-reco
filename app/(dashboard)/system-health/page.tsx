"use client";

// System Health — real activity feed from /api/system-health: source ingestion
// health, plus a chronological timeline of reconciliation runs, guard uploads,
// and digest email sends (what happened, and when).

import { useMemo } from "react";
import { ErrorState } from "@/components/error-state";
import { useSystemHealth } from "@/lib/hooks/use-system-health";
import { PageHeader } from "@/components/kit/layout";
import { Icon, type IconName } from "@/components/icon";

const SOURCE_LABEL: Record<string, string> = {
  ODOO: "Odoo (ERP)",
  SHEET: "Movement Sheet",
  DT: "Delivery Tracker",
  PHYSICAL: "Guard Register OCR",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

type EventKind = "reconcile" | "upload" | "email" | "ingest_fail";
interface TimelineEvent {
  ts: string;
  kind: EventKind;
  icon: IconName;
  title: string;
  detail: string;
  tone: "success" | "danger" | "warning" | "muted";
}

const TONE_CLS: Record<TimelineEvent["tone"], string> = {
  success: "text-success",
  danger: "text-danger",
  warning: "text-status-warning",
  muted: "text-text-muted",
};

export default function SystemHealthPage() {
  const { data, loading, error, refetch } = useSystemHealth();

  const events = useMemo<TimelineEvent[]>(() => {
    if (!data) return [];
    const ev: TimelineEvent[] = [];

    for (const r of data.runs) {
      const tone =
        r.status === "success" ? "success" : r.status === "failed" ? "danger" : r.status === "partial" ? "warning" : "muted";
      ev.push({
        ts: r.completed_at ?? r.created_at,
        kind: "reconcile",
        icon: "history",
        title: `Reconciliation ${r.status} · ${r.business_date}`,
        detail: `${r.trigger}${r.triggered_by ? ` by ${r.triggered_by}` : ""} — ${r.real_count} REAL of ${r.total} variances`,
        tone,
      });
    }
    for (const u of data.uploads) {
      const tone = u.status === "processed" ? "success" : u.status === "failed" ? "danger" : "muted";
      ev.push({
        ts: u.created_at,
        kind: "upload",
        icon: "cloud_upload",
        title: `Guard register uploaded · ${u.city}`,
        detail: `${u.file_name} — ${u.status}${u.rows_parsed ? `, ${u.rows_parsed} rows` : ""}${u.error ? ` · ${u.error}` : ""}`,
        tone,
      });
    }
    for (const m of data.emails) {
      const tone = m.status === "sent" ? "success" : m.status === "failed" ? "danger" : "muted";
      ev.push({
        ts: m.created_at,
        kind: "email",
        icon: "send",
        title: `Digest email ${m.status}${m.kind === "test" ? " (test)" : ""}`,
        detail: `${m.recipients?.length ?? 0} recipient(s)${m.business_date ? ` · ${m.business_date}` : ""}${m.error ? ` · ${m.error}` : ""}`,
        tone,
      });
    }
    for (const i of data.ingestion) {
      if (i.status !== "FAILED") continue; // successes are summarised in Source Health
      ev.push({
        ts: i.finished_at ?? i.created_at,
        kind: "ingest_fail",
        icon: "error",
        title: `${SOURCE_LABEL[i.source] ?? i.source} ingestion failed`,
        detail: i.message ?? "connector error",
        tone: "danger",
      });
    }
    return ev.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, 40);
  }, [data]);

  const anyFailed =
    (data?.sourceHealth.some((s) => s.status === "FAILED") ?? false) ||
    (data?.runs[0]?.status === "failed");

  return (
    <div className="p-container-margin space-y-6">
      <PageHeader
        icon="health_and_safety"
        title="System Health"
        subtitle="Live pipeline activity — ingestion, reconciliation runs, uploads, and email sends."
        right={
          <button onClick={refetch} className="btn btn-secondary">
            <Icon name="refresh" size={18} />
            Refresh
          </button>
        }
      />

      {error && <ErrorState what="system health" detail={error} onRetry={refetch} />}

      {/* Overall status banner */}
      <div className={`card p-4 flex items-center gap-3 ${anyFailed ? "bg-danger-soft border border-danger/20" : "bg-success-soft border border-success/20"}`}>
        <Icon name={anyFailed ? "error" : "check_circle"} size={22} className={anyFailed ? "text-danger" : "text-success"} />
        <p className="text-sm font-semibold text-text-primary">
          {loading ? "Checking pipeline…" : anyFailed ? "Attention — a source or the last run reported a failure." : "All sources and the latest run are healthy."}
        </p>
      </div>

      {/* Source health cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {(data?.sourceHealth ?? []).map((s) => {
          const ok = s.status === "OK";
          const unknown = s.status === "UNKNOWN";
          return (
            <div key={s.source} className="soft-card p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="flex items-center gap-2.5 font-headline text-sm font-bold text-text-primary">
                  <span
                    className={`w-9 h-9 rounded-xl grid place-items-center ${
                      ok ? "bg-success-soft text-success" : unknown ? "bg-surface-elevated text-text-muted" : "bg-danger-soft text-danger"
                    }`}
                  >
                    <Icon name={ok ? "check_circle" : unknown ? "help" : "error"} size={18} />
                  </span>
                  {SOURCE_LABEL[s.source] ?? s.source}
                </span>
                <span className={ok ? "badge badge-done" : unknown ? "badge badge-suppressed" : "badge badge-high"}>
                  {unknown ? "No data" : s.status}
                </span>
              </div>
              <p className="text-xs text-text-muted">Last sync: {fmt(s.lastAt)}</p>
              <p className="text-xs text-text-muted">
                {s.rows === null ? "—" : `${s.rows} rows`}
                {s.durationMs != null ? ` · ${(s.durationMs / 1000).toFixed(1)}s` : ""}
              </p>
            </div>
          );
        })}
      </section>

      {/* Activity timeline */}
      <section className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-surface-elevated">
          <h4 className="font-headline text-lg text-text-primary">Activity Timeline</h4>
        </div>
        {events.length === 0 ? (
          <div className="p-10 text-center text-text-muted text-sm">
            {loading
              ? "Loading…"
              : error
                ? "Activity could not be read — see above."
                : "No activity recorded yet."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e, i) => (
              <li key={i} className="flex items-start gap-3 px-6 py-3">
                <div className={`mt-0.5 shrink-0 ${TONE_CLS[e.tone]}`}>
                  <Icon name={e.icon} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-text-primary truncate">{e.title}</p>
                    <span className="text-xs text-text-muted shrink-0 whitespace-nowrap">{fmt(e.ts)}</span>
                  </div>
                  <p className="text-xs text-text-muted break-words">{e.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The daily schedule. Rewritten 23 Oct 2026: it still said 16:30 and
          16:45 and described the 15:00 business day, both retired. Times are
          from vercel.json (11:30 / 12:30 UTC) and the pg_cron jobs. */}
      <section className="card p-6">
        <h4 className="font-headline text-lg text-text-primary mb-1">Schedule (IST)</h4>
        <p className="text-xs text-text-muted mb-4">
          Each run judges <b className="text-text-secondary">yesterday</b>, as a calendar day
          (midnight to midnight). Holding a day back gives late Odoo postings time to land.
        </p>
        <ol className="relative border-l-2 border-accent-soft ml-2 space-y-4">
          {[
            ["15:45", "Clean-up", "Old audit rows with nothing to do are closed"],
            ["15:50", "Re-check", "The last six days are run again so late entries fold in"],
            ["17:00", "Main run", "Yesterday, all four books, every city"],
            ["18:00", "Digest email", "The day just judged, to the team"],
          ].map(([time, title, detail]) => (
            <li key={time} className="pl-5 relative">
              <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-accent ring-4 ring-surface-card" />
              <p className="text-sm text-text-primary">
                <b className="tabular-nums">{time}</b> · {title}
              </p>
              <p className="text-xs text-text-muted">{detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
