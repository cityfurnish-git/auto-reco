"use client";

// Barcode lookup — the floating button bottom-right and its side panel.
//
// Replaced "Ask AI" on 23 Oct 2026 (owner: one job only — a barcode's history
// when looked up). Same spot, no model: type or paste a barcode, get every day
// it moved, which books saw it, anything raised about it, and the gate's time.
// Reads /api/barcode-history, which is RLS-scoped, so a manager sees their own
// city's history only.
//
// Two lessons from the launcher it replaces:
//   - It decided whether to portal with `typeof document`, so the server and
//     the first client render disagreed and React threw a hydration error on
//     every page. Mounting is read through useSyncExternalStore instead.
//   - It floated over the last table row with nothing to stop it. The shell
//     now pads the page foot by the button's height.

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";

interface Movement {
  business_date: string;
  city: string;
  direction: "IN" | "OUT";
  barcode_display: string | null;
  present_p: boolean; present_s: boolean; present_d: boolean; present_o: boolean;
  reported_p: boolean; reported_s: boolean; reported_d: boolean; reported_o: boolean;
  outcome: "CLEAN" | "INFO" | "REAL" | "SUPPRESSED";
  variance_names: string[] | null;
  product: string | null;
  customer: string | null;
  so_number: string | null;
  ticket_id: string | null;
  job_type: string | null;
}
interface Flag {
  business_date: string;
  city: string;
  direction: string;
  variance_name: string;
  bucket: string | null;
  status: string;
  closure_reason: string | null;
  closure_note: string | null;
}
interface Scan {
  business_date: string;
  direction: string;
  scanned_at: string;
  status: string;
}
interface History {
  /** A spelling a source wrote — never the canonical fold. */
  display: string;
  movements: Movement[];
  flags: Flag[];
  scans: Scan[];
  gateError: string | null;
  truncated: boolean;
}

const noop = () => () => {};
const BOOKS = [
  { key: "p", label: "Guard" },
  { key: "s", label: "MS" },
  { key: "d", label: "DT" },
  { key: "o", label: "Odoo" },
] as const;

export function BarcodeLookupLauncher() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [open, setOpen] = useState(false);
  if (!mounted) return null;
  return createPortal(
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // z-90: under modals (100+), toasts (130) and the bulk action bar (105).
        className={`fixed bottom-6 right-6 z-[90] flex items-center gap-2 rounded-full bg-accent text-on-accent
          shadow-lg px-4 h-12 font-medium text-sm transition-all duration-200 hover:brightness-110
          motion-reduce:transition-none ${open ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        aria-label="Look up a barcode's history"
        aria-expanded={open}
        aria-controls="barcode-lookup"
      >
        <Icon name="scan" size={20} />
        <span className="hidden sm:inline">Barcode lookup</span>
      </button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>,
    document.body
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function look(e?: React.FormEvent) {
    e?.preventDefault();
    const code = q.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/barcode-history?barcode=${encodeURIComponent(code)}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setData(j as History);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/30" onClick={onClose} aria-hidden />
      <aside
        id="barcode-lookup"
        role="dialog"
        aria-label="Barcode lookup"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="fixed right-0 top-0 bottom-0 z-[96] w-full sm:w-[460px] bg-surface-page shadow-2xl flex flex-col"
      >
        <div className="px-5 pt-5 pb-4 bg-surface-card border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-headline text-lg text-text-primary flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent grid place-items-center">
                <Icon name="scan" size={18} />
              </span>
              Barcode lookup
            </h2>
            <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
              <Icon name="close" size={20} />
            </button>
          </div>
          <form onSubmit={look} className="flex gap-2">
            <input
              ref={input}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type or paste a barcode"
              className="input-clean flex-1 font-mono uppercase"
              aria-label="Barcode"
            />
            <button type="submit" className="btn btn-primary" disabled={loading || !q.trim()}>
              {loading ? "…" : "Look up"}
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : !data ? (
            <p className="text-sm text-text-muted">
              Every day the unit moved, which books saw it, anything raised about it, and when it crossed the gate. History is kept from 22 July 2026.
            </p>
          ) : (
            <Timeline data={data} />
          )}
        </div>
      </aside>
    </>
  );
}

function Timeline({ data }: { data: History }) {
  // One entry per business date and direction; flags and gate times attach
  // to the movement they belong to, and anything without a movement (a flag
  // whose ledger row predates 22 Jul) still gets its own entry.
  const entries = useMemo(() => {
    const key = (d: string, dir: string) => `${d}|${dir}`;
    const map = new Map<string, { date: string; dir: string; city: string; move?: Movement; flags: Flag[]; scans: Scan[] }>();
    const get = (d: string, dir: string, city: string) => {
      const k = key(d, dir);
      if (!map.has(k)) map.set(k, { date: d, dir, city, flags: [], scans: [] });
      return map.get(k)!;
    };
    for (const m of data.movements) get(m.business_date, m.direction, m.city).move = m;
    for (const f of data.flags) get(f.business_date, f.direction === "CROSS" ? "OUT" : f.direction, f.city).flags.push(f);
    for (const s of data.scans) {
      const e = map.get(key(s.business_date, s.direction.toUpperCase()));
      if (e) e.scans.push(s);
    }
    return [...map.values()].sort((a, b) => (a.date === b.date ? a.dir.localeCompare(b.dir) : b.date.localeCompare(a.date)));
  }, [data]);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No record of <b className="font-mono text-text-primary">{data.display}</b> in any book since 22 July 2026. Check the spelling — or it may belong to another city.
      </p>
    );
  }
  const latest = data.movements[0];
  return (
    <div className="space-y-4">
      <div className="soft-card p-4">
        <div className="font-mono font-bold text-text-primary">{data.display}</div>
        {latest?.product && <div className="text-sm text-text-secondary mt-0.5">{latest.product}</div>}
        <div className="text-xs text-text-muted mt-1">
          {data.movements.length} movement{data.movements.length === 1 ? "" : "s"} · {data.flags.length} item{data.flags.length === 1 ? "" : "s"} raised
          {data.truncated && " · showing the latest only"}
        </div>
        {data.gateError && <div className="text-xs text-status-warning mt-1">Gate times could not be read.</div>}
      </div>

      <ol className="relative border-l-2 border-accent-soft ml-2 space-y-4">
        {entries.map((e) => (
          <li key={`${e.date}|${e.dir}`} className="pl-5 relative">
            <span
              className={`absolute -left-[7px] top-4 w-3 h-3 rounded-full ring-4 ring-surface-page ${
                e.flags.some((f) => f.bucket === "REAL" && f.status !== "closed")
                  ? "bg-danger"
                  : e.flags.length
                    ? "bg-status-warning"
                    : "bg-success"
              }`}
            />
            <div className="soft-card p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary">
                  {fmtDate(e.date)} · <span className={e.dir === "IN" ? "text-success" : "text-accent"}>{e.dir === "IN" ? "Came in" : "Went out"}</span>
                </span>
                <span className="text-xs text-text-muted">{titleCase(e.city)}</span>
              </div>
              {e.move && (
                <>
                  <div className="flex gap-1.5">
                    {BOOKS.map((b) => {
                      const saw = e.move![`present_${b.key}`];
                      const filed = e.move![`reported_${b.key}`];
                      return (
                        <span
                          key={b.key}
                          title={saw ? `${b.label} has it` : filed ? `${b.label} has no record` : `${b.label} did not report that day`}
                          className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            saw ? "bg-success-soft text-success" : filed ? "bg-danger-soft text-danger" : "bg-surface-elevated text-text-disabled"
                          }`}
                        >
                          {saw ? "✓" : filed ? "✕" : "–"} {b.label}
                        </span>
                      );
                    })}
                  </div>
                  {(e.move.customer || e.move.so_number) && (
                    <div className="text-xs text-text-secondary">
                      {e.move.customer && <b className="text-text-primary">{e.move.customer}</b>}
                      {e.move.customer && e.move.so_number && " · "}
                      {e.move.so_number}
                    </div>
                  )}
                </>
              )}
              {e.scans.length > 0 && (
                <div className="text-xs text-text-muted">
                  Gate: {e.scans.map((s) => fmtTime(s.scanned_at)).join(", ")}
                </div>
              )}
              {e.flags.map((f, i) => (
                <div key={i} className="text-xs rounded-lg bg-surface-elevated px-2.5 py-1.5">
                  <b className="text-text-primary">{f.variance_name}</b>
                  <span className="text-text-muted">
                    {" "}· {f.status === "closed" ? `closed${f.closure_reason ? ` — ${f.closure_reason}` : ""}` : f.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
              {e.move && e.flags.length === 0 && e.move.outcome === "CLEAN" && (
                // "All books agree" only when no reporting book is missing it:
                // a clean outcome can still carry a ✕ (Odoo posted the next
                // day; DT has no job for a receipt), and saying "agree" beside
                // a red cross contradicts the line above it.
                BOOKS.some((b) => e.move![`reported_${b.key}`] && !e.move![`present_${b.key}`]) ? (
                  <div className="text-xs text-text-muted">Nothing raised — the gap is an expected one</div>
                ) : (
                  <div className="text-xs text-success">All books agree — nothing raised</div>
                )
              )}
              {e.move && e.flags.length === 0 && e.move.outcome === "SUPPRESSED" && (
                <div className="text-xs text-text-muted">Not raised — a known, explained pattern (e.g. a paired order transfer or a failed delivery&apos;s return)</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
