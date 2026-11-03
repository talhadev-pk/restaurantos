// Server-only: settings, audit log, error plumbing.
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export class ServiceError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof ServiceError) {
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  }
  console.error("[api-error]", e);
  const msg = e instanceof Error ? e.message : "Internal server error";
  return NextResponse.json({ error: msg }, { status: 500 });
}

export type Actor = { id?: number; name: string } | null;

// ---------- Settings ----------
export async function getSetting(key: string, fallback = ""): Promise<string> {
  const rows = await db.select().from(s.settings).where(eq(s.settings.key, key));
  return rows[0]?.value ?? fallback;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(s.settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(s.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value } });
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  displayName: "Talha",
  ownerEmail: "talhamalikawan@example.com",
  restaurantName: "Ember & Oak Bistro",
  currencySymbol: "$",
  allowNegativeStock: "false",
  simSpeed: "1",
  simArrivalSec: "12",
};

// ---------- Audit ----------
export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: number | null,
  details: Record<string, unknown> = {},
) {
  try {
    await db.insert(s.auditLogs).values({
      userId: actor?.id ?? null,
      userName: actor?.name ?? "system",
      action,
      entity,
      entityId,
      details,
    });
  } catch (e) {
    console.error("[audit]", e);
  }
}
