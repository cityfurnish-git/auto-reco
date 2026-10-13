// Two ways to read the Delivery Tracker, behind one interface.
//
// WHY THERE ARE TWO (13 Oct 2026). The connector talked straight to the
// Tracker's MongoDB from the day it was written. On 2 October that stopped:
// every run since logs `connect ETIMEDOUT 52.140.171.219:27017`, and a raw TCP
// probe shows the packets silently dropped rather than refused — the signature
// of an IP allow-list, not a dead server. The Tracker's own app kept working
// throughout, because it connects a different way. Eleven days of
// reconciliation ran against Odoo alone before anyone noticed, which is its own
// lesson about the nightly digest being dead.
//
// Metabase is already connected to that same database ("Delivery Tracker
// MongoDB", id 6) and reads it fine, so it is the way back in that needs
// nobody's permission. scripts/metabase-mongo.mjs proved the mechanism months
// ago and was never wired into the connector; this is that wiring.
//
// THE DIRECT PATH IS KEPT, not deleted. It is faster, it has no row cap, and
// the allow-list is worth fixing anyway — DT_TRANSPORT=mongo switches back the
// moment it is.
//
// WHAT METABASE CHANGES, and each of these is a trap:
//
//   ROW CAP. /api/dataset stops at 2,000 rows and says so with `rows_truncated`.
//   A day is normally far below that (366 deliveries and 296 attempted jobs on
//   10 Oct), but "normally" is not a guarantee and a silent 2,000-row ceiling
//   would reconcile the day against part of the Tracker while looking complete.
//   So every aggregate pages, and a page that comes back truncated AND unpaged
//   throws rather than returns.
//
//   SHAPES, NOT DOCUMENTS. Metabase answers with columns and tuples, so rows
//   are rebuilt into documents here. Our pipelines end in a flat $project,
//   which is what makes that safe.
//
//   NO DRIVER TYPES. A Date must travel as {$date}, an ObjectId as {$oid};
//   JSON.stringify would otherwise send a Date as a bare ISO string that Mongo
//   compares as text and matches nothing — a filter that silently returns zero
//   rows, which is the worst failure this file could have.
//
//   NO distinct(). It is not an aggregation stage, so it becomes $group.

import { MongoClient } from "mongodb";

export interface DtTransport {
  readonly kind: "mongo" | "metabase";
  /** Distinct values of `field`, as something safe to put in an `$in`. */
  distinctIds(collection: string, field: string, match: Record<string, unknown>): Promise<unknown[]>;
  aggregate(collection: string, pipeline: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

/** Metabase's own ceiling. Paged around; never assumed to be enough. */
export const METABASE_ROW_CAP = 2000;
/** Refuses to page for ever if a pipeline is wider than anyone expected. */
export const MAX_PAGES = 40;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * JS values to MongoDB Extended JSON, for the trip through Metabase.
 *
 * Only Dates need rewriting; everything else is already JSON. An ObjectId from
 * the driver would too, but on this path ids arrive as {$oid} already (see
 * distinctIds) and pass straight through.
 */
export function toExtendedJson(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(toExtendedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toExtendedJson(v)])
    );
  }
  return value;
}

function metabaseTransport(): DtTransport {
  const base = (process.env.METABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.METABASE_API_KEY;
  const dbId = Number(process.env.METABASE_DT_DB_ID ?? 6);
  if (!base || !key) throw new Error("DT via Metabase needs METABASE_URL and METABASE_API_KEY.");

  async function run(collection: string, pipeline: unknown[]) {
    const res = await fetch(`${base}/api/dataset`, {
      method: "POST",
      headers: { "x-api-key": key!, "Content-Type": "application/json" },
      body: JSON.stringify({
        database: dbId,
        type: "native",
        native: { collection, query: JSON.stringify(toExtendedJson(pipeline)) },
      }),
    });
    const json = await res.json();
    if (json?.status === "failed" || json?.error) {
      throw new Error(`DT via Metabase: ${String(json.error ?? json.error_type ?? "query failed").slice(0, 300)}`);
    }
    const cols: string[] = (json?.data?.cols ?? []).map((c: { name: string }) => c.name);
    const rows: unknown[][] = json?.data?.rows ?? [];
    return {
      docs: rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))),
      truncated: !!json?.data?.rows_truncated,
    };
  }

  /** Page a pipeline past the row cap, $skip at a time. */
  async function paged(collection: string, pipeline: unknown[]) {
    const out: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { docs } = await run(collection, [
        ...pipeline,
        { $skip: page * METABASE_ROW_CAP },
        { $limit: METABASE_ROW_CAP },
      ]);
      out.push(...docs);
      // A short page is the end of the data. A full one might not be, so ask
      // again — one wasted round trip on an exact multiple is the right price
      // for never guessing.
      if (docs.length < METABASE_ROW_CAP) return out;
    }
    throw new Error(
      `DT via Metabase: ${collection} still returning rows after ${MAX_PAGES} pages ` +
        `(${MAX_PAGES * METABASE_ROW_CAP} rows). Refusing to continue rather than reconcile a partial day.`
    );
  }

  return {
    kind: "metabase",
    async distinctIds(collection, field, match) {
      const docs = await paged(collection, [{ $match: match }, { $group: { _id: `$${field}` } }]);
      return docs
        .map((d) => d._id)
        .filter((v) => v != null)
        // Back into something an $in on an ObjectId column will match. A value
        // that is not an id shape is left alone rather than coerced.
        .map((v) => (typeof v === "string" && OBJECT_ID.test(v) ? { $oid: v } : v));
    },
    async aggregate(collection, pipeline) {
      return paged(collection, pipeline);
    },
    async close() {},
  };
}

function mongoTransport(uri: string, dbName: string): DtTransport {
  const client = new MongoClient(uri);
  const ready = client.connect();
  return {
    kind: "mongo",
    async distinctIds(collection, field, match) {
      const db = (await ready).db(dbName);
      return db.collection(collection).distinct(field, match);
    },
    async aggregate(collection, pipeline) {
      const db = (await ready).db(dbName);
      return (await db
        .collection(collection)
        .aggregate(pipeline as Record<string, unknown>[])
        .toArray()) as Record<string, unknown>[];
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}

/**
 * Which road to take.
 *
 * THE DIRECT CONNECTION REMAINS THE DEFAULT, and that is the whole point of
 * this paragraph. Metabase CAN read a Delivery Tracker database, and this
 * transport works — but measured on 13 Oct 2026 it is NOT THE SAME DATABASE
 * the connector has always read:
 *
 *   * the parent collection the connector names does not exist there at all
 *     (the trips collection does, which is what made it look plausible);
 *   * against `deliveries`, the nearest equivalent, the volumes match almost
 *     exactly — 438 units against 440 on 29 Sep, 441 against 449 on 1 Oct —
 *     but only 73% and 68% of them are THE SAME UNITS. Each side holds about
 *     a hundred the other does not.
 *
 * Matching totals over different contents is the most dangerous shape a data
 * source can have: every count on the dashboard would look right. So Metabase
 * is opt-in by DT_TRANSPORT=metabase and nothing selects it on its own, until
 * somebody confirms which database Metabase's connection actually points at.
 *
 * Deliberately NOT "try direct, fall back" either: the direct failure is a
 * thirty-second connect timeout, and spending half of a sixty-second function
 * budget rediscovering that is how a working run turns into a partial one.
 */
export function dtTransport(): DtTransport {
  const pinned = (process.env.DT_TRANSPORT ?? "").trim().toLowerCase();
  const uri = process.env.DT_MONGODB_URI;
  const dbName = process.env.DT_MONGODB_DB ?? "cityfurnish";

  if (pinned === "mongo") {
    if (!uri) throw new Error("DT_TRANSPORT=mongo needs DT_MONGODB_URI.");
    return mongoTransport(uri, dbName);
  }
  if (pinned === "metabase") return metabaseTransport();

  if (uri) return mongoTransport(uri, dbName);
  throw new Error("DT not configured (set DT_MONGODB_URI, or DT_TRANSPORT=metabase once its database is confirmed).");
}
