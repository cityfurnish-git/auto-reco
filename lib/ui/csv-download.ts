// CSV for the dashboard tables that are NOT a list of variances.
//
// lib/ui/variance-csv.ts already covers VarianceDB rows for both dashboards'
// Export button; this is its counterpart for the modals whose rows are their
// own shape — source-of-truth units, anchored movements, counted items. The two
// share csvCell() below so there is ONE answer to how a cell is escaped.
//
// Written 13 Oct 2026, when the owner asked for export on all of them. The gate
// register's trip download already had this logic; a second copy appeared with
// the source-of-truth modals, and a third through sixth would have followed. The
// guards below are the kind that are quietly dropped when a file is copied, and
// each of them is load-bearing.
//
// A LEADING APOSTROPHE ON ANYTHING FORMULA-SHAPED. A barcode, a job type or a
// customer's name can begin with `=`, `+`, `-` or `@`, and Excel and Sheets
// both EXECUTE those on open — a spreadsheet of warehouse data is exactly the
// file someone forwards, so the cell is prefixed and reads as text.
//
// THE BOM IS NOT DECORATION. Without it Excel on Windows opens a UTF-8 file as
// the local code page, and every customer name with a non-ASCII character comes
// back mangled. Three bytes buy a file that survives being forwarded.
//
// CRLF, because Excel's older importers split on it and leave a stray carriage
// return in the last column otherwise.

/** One column: its header, and how to read it off a row. */
export interface CsvColumn<T> {
  label: string;
  of: (row: T) => string | number | null | undefined;
}

/** Escape one value: formula guard first, then CSV quoting. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows and columns to a CSV body, BOM included. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  return (
    "﻿" +
    [
      columns.map((c) => csvCell(c.label)).join(","),
      ...rows.map((r) => columns.map((c) => csvCell(c.of(r))).join(",")),
    ].join("\r\n")
  );
}

/**
 * Build a filename that still says what the file is a month later, sitting in a
 * downloads folder beside five others pulled from the same screen.
 *
 * Every part is slugged, blanks are dropped, and the date goes last so a
 * directory sorted by name groups the same export across days together.
 */
export function csvFilename(...parts: (string | null | undefined)[]): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    ["auto-reco", ...parts.filter((p): p is string => !!p && !!p.trim()).map(slug)]
      .filter(Boolean)
      .join("-") + ".csv"
  );
}

/**
 * Hand the browser a CSV of these rows.
 *
 * Returns false when there is nothing to write, so a caller can keep its button
 * disabled on the same condition rather than producing a file with only a
 * header row in it.
 */
export function downloadTable<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  nameParts: (string | null | undefined)[]
): boolean {
  if (typeof document === "undefined" || rows.length === 0) return false;
  const url = URL.createObjectURL(new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFilename(...nameParts);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late: Safari has been seen to start the download asynchronously and
  // get an empty file when the object URL is freed in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
