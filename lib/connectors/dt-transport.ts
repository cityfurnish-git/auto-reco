// Two ways to read the Delivery Tracker, behind one interface.
//
// WHY THERE ARE TWO (13-22 Oct 2026). The reconciliation connector talked
// straight to the Tracker's MongoDB from the day it was written. On 2 October
// that stopped: every run since logs `connect ETIMEDOUT 52.140.171.219:27017`,
// and a raw TCP probe shows the packets silently dropped rather than refused —
// the signature of an IP allow-list, not a dead server. Twenty days of
// reconciliation ran on three books instead of four before it was spotted,
// which is its own argument for fixing the nightly digest.
//
// THE OTHER ROAD WAS ALREADY IN THIS CODEBASE, which is the part worth knowing.
// lib/gate/fleet.ts, expected-dt.ts and enrich.ts have always read the Tracker
// through Metabase (runMongoPipeline, database METABASE_DT_DB_ID), and they
// kept working right through the outage — it is why gate scans still get their
// customer names. Only the reconciliation connector went direct. The codebase
// has been reading one system two ways, from two places, for months.
//
// AND THEY ARE THE SAME DATA. Checked against the gate — guards scanning real
// units, a witness independent of both — on three September days in Delhi:
//
//               gate   direct   agrees    metabase  agrees   the two agree
//   26 Sep       124      104    94 76%        97    92 74%       97 of 104
//   29 Sep       102      101    86 84%        98    87 85%       97 of 101
//   01 Oct       150      137   132 88%       126   115 77%      117 of 137
//
// An earlier comparison of mine put the two sources 30% apart and was WRONG:
// it joined on the city label, and the stored data says DELHI where the Tracker
// says Gurgaon. Every Delhi row failed to match on its name alone, and Delhi is
// about a third of daily volume — the "mismatch" was precisely that bug. What
// is left is 10-15%, which is what frozen September rows read against a live
// Tracker should look like: it rewrites its own rows as jobs are retried, which
// is why lib/reconcile/freeze.ts exists.
//
// WHAT METABASE NEEDS THAT THE DRIVER DID NOT:
//
//   A DIFFERENT COLLECTION NAME. The two roads lead to differently-named
//   collections, so the transport owns that name rather than the caller.
//
//   NO DRIVER TYPES. A Date must travel as {$date}; JSON.stringify would send a
//   bare ISO string that Mongo compares as TEXT and matches nothing — a filter
//   that silently returns zero rows, the worst failure this file could have.
//   The gate pipelines write {$date} literals by hand; here the pipelines are
//   shared with the driver path, so the conversion happens on the way out.
//
//   NO distinct(). It is not an aggregation stage, so it becomes $group.
//
// Row limits are NOT handled here: runMongoPipeline already asks Metabase for
// up to 100,000 rows. An earlier version of this file paged around a 2,000-row
// cap that only existed because it called the API without those constraints.

import { MongoClient } from "mongodb";
import { metabaseConfigured, mongoDatabaseId, runMongoPipeline } from "./metabase";

export interface DtTransport {
  readonly kind: "mongo" | "metabase";
  /** The main delivery-task collection on THIS road. They differ. */
  readonly parentCollection: string;
  /** Distinct values of `field`, as something safe to put in an `$in`. */
  distinctIds(collection: string, field: string, match: Record<string, unknown>): Promise<unknown[]>;
  aggregate(collection: string, pipeline: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * JS values to MongoDB Extended JSON, for the trip through Metabase.
 *
 * Only Dates need rewriting; everything else is already JSON. Ids arrive as
 * {$oid} from distinctIds and pass straight through.
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
  // Found, not configured — see mongoDatabaseId(). A hard-coded id is how
  // production spent weeks posting Mongo pipelines at Odoo's Postgres.
  // The standard name, and the one lib/gate/* has always used against this
  // database. Overridable for the same reason every other collection name is.
  const parent = process.env.METABASE_DT_PARENT ?? "deliveries";

  const run = async (collection: string, pipeline: unknown[]) =>
    (await runMongoPipeline(await mongoDatabaseId(), collection, toExtendedJson(pipeline) as unknown[])).rows;

  return {
    kind: "metabase",
    parentCollection: parent,
    async distinctIds(collection, field, match) {
      const docs = await run(collection, [{ $match: match }, { $group: { _id: `$${field}` } }]);
      return docs
        .map((d) => d._id)
        .filter((v) => v != null)
        // Back into something an $in on an ObjectId column matches. A value
        // that is not an id shape is left alone rather than coerced.
        .map((v) => (typeof v === "string" && OBJECT_ID.test(v) ? { $oid: v } : v));
    },
    aggregate: run,
    async close() {},
  };
}

function mongoTransport(uri: string, dbName: string): DtTransport {
  const client = new MongoClient(uri);
  const ready = client.connect();
  return {
    kind: "mongo",
    parentCollection: process.env.DT_TASKS_COLLECTION ?? "deliveries",
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
 * Metabase by default since 22 Oct 2026: the direct connection is blocked, the
 * Metabase road is what the gate half of this codebase has always used, and the
 * two were checked against the gate's own record before the default moved.
 * DT_TRANSPORT=mongo pins the old road back the day the allow-list is fixed,
 * without a deploy — it is faster and has no API in front of it, so it is worth
 * having back.
 *
 * Deliberately NOT "try direct, fall back": the direct failure is a thirty-
 * second connect timeout, and spending half of a sixty-second function budget
 * rediscovering that is how a working run turns into a partial one.
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

  if (metabaseConfigured()) return metabaseTransport();
  if (uri) return mongoTransport(uri, dbName);
  throw new Error("DT not configured (set METABASE_URL + METABASE_API_KEY, or DT_MONGODB_URI).");
}
