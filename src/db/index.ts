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
// Some platforms inject a postgres DATABASE_URL automatically — never crash on
// it. RestaurantOS is local-first: anything that isn't a local/sqlite URL falls
// back to the project-root database file.
const url = rawUrl.startsWith("file:") || rawUrl.startsWith("libsql:///") || rawUrl.startsWith("libsql:")
  ? rawUrl
  : rawUrl.startsWith("postgres")
    ? "file:local.db"
    : `file:${rawUrl}`;
if (rawUrl.startsWith("postgres")) {
  console.warn("[db] DATABASE_URL points to PostgreSQL; RestaurantOS uses a local SQLite file — falling back to local.db");
}

export const sqliteClient: Client =
  g.__rosSqliteClient ?? createClient({ url });

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
