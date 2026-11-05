// Local-first database layer: a SQLite file in the project root via libsql.
// No external database server is required — the schema is created automatically
// on first boot, and demo data is seeded by src/instrumentation.ts.
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "./ddl";

const g = globalThis as typeof globalThis & {
  __rosSqliteClient?: Client;
  __rosDbReady?: Promise<void>;
};

const rawUrl = process.env.DATABASE_URL ?? "file:local.db";
if (rawUrl.startsWith("postgres")) {
  throw new Error(
    "RestaurantOS runs on a local SQLite file. Set DATABASE_URL=file:local.db (or delete it — that is the default).",
  );
}

export const sqliteClient: Client =
  g.__rosSqliteClient ?? createClient({ url: rawUrl.startsWith("file:") || rawUrl.startsWith("libsql:") ? rawUrl : `file:${rawUrl}` });

if (process.env.NODE_ENV !== "production") {
  g.__rosSqliteClient = sqliteClient;
}

/** Creates all tables/indexes idempotently. Awaited by the boot hook; safe everywhere. */
export const dbReady: Promise<void> =
  g.__rosDbReady ??
  (async () => {
    try {
      await sqliteClient.executeMultiple(SCHEMA_DDL);
      await sqliteClient.execute("PRAGMA journal_mode=WAL;");
      await sqliteClient.execute("PRAGMA foreign_keys=ON;");
    } catch (e) {
      // A read-only filesystem (e.g. some serverless builds) only matters there;
      // the local dev/start runtime always has a writable project directory.
      console.warn("[db] schema init warning:", e instanceof Error ? e.message : e);
    }
  })();

if (process.env.NODE_ENV !== "production") {
  g.__rosDbReady = dbReady;
}

export const db = drizzle(sqliteClient);
