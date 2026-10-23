// Shortens the run's warning lines for the notifications box. Pure; no
// React, so it is testable and reusable (the digest could read it too).

import { CITIES, type City } from "../sample-data";

const titleCase = (x: string) => x.charAt(0) + x.slice(1).toLowerCase();

/**
 * The run's own wording, cut down to what a person acts on (owner, 23 Oct
 * 2026: "keep the text minimum and bold whatever necessary"): WHERE in bold,
 * WHAT in a few words, the count in grey. The full line stays in the tooltip.
 * Unrecognised lines pass through whole — shortening must never hide one.
 */
export function shortNotice(w: string): { who: string; what: string; extra?: string } {
  const n = (x: string) => Number(x).toLocaleString("en-IN");
  let m = w.match(/^Google Sheets:\s*([A-Z]+)\/(\w+)\s+header is missing its (\w+) column\s*—\s*(\d+) rows skipped/i);
  if (m) return { who: `${titleCase(m[1])} · ${m[2]} sheet`, what: `${m[3]} column missing`, extra: `${n(m[4])} rows skipped` };
  m = w.match(/^Google Sheets:\s*([A-Z]+)\/(\w+)\s+has no header row.*?—\s*(\d+) rows skipped/i);
  if (m) return { who: `${titleCase(m[1])} · ${m[2]} sheet`, what: "Header row missing", extra: `${n(m[3])} rows skipped` };
  m = w.match(/^(\d+) items? received without a barcode and still unassigned after 24 hours/i);
  if (m) return { who: `${n(m[1])} items`, what: "No barcode after 24 hours" };
  m = w.match(/^Gate Register:\s*([A-Z]+):\s*no gate scans/i);
  if (m) return { who: `${titleCase(m[1])} · Gate`, what: "No scans for the day" };
  m = w.match(/^Odoo ([\w -]+?) (?:lookup|lookahead) failed:.*timeout/i);
  if (m) return { who: "Odoo", what: `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} check timed out` };
  m = w.match(/^([A-Z]+):\s*(.+)$/);
  if (m && CITIES.includes(m[1] as City)) return { who: titleCase(m[1]), what: m[2] };
  return { who: "", what: w };
}

