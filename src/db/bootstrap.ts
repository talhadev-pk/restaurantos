// Boot-time initializer: creates demo data on a completely fresh database.
import { db, dbReady } from "./index";
import * as s from "./schema";
import { sql } from "drizzle-orm";

const g = globalThis as typeof globalThis & { __rosSeeded?: Promise<void> };

export function ensureSeeded(): Promise<void> {
  if (!g.__rosSeeded) {
    g.__rosSeeded = (async () => {
      await dbReady;
      const [{ c }] = await db.select({ c: sql<number>`count(*)` }).from(s.users);
      if (Number(c) > 0) return; // already initialized — never touch existing data
      console.log("[db] fresh database detected — seeding demo restaurant…");
      const { runSeed } = await import("./seed-core");
      await runSeed();
      console.log("[db] demo data ready. Sign in: talhamalikawan@example.com / demo1234");
    })().catch((e) => {
      console.error("[db] auto-seed failed:", e);
      g.__rosSeeded = undefined;
    });
  }
  return g.__rosSeeded;
}
