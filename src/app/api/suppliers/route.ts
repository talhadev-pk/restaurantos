import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const rows = await db.select().from(s.suppliers).orderBy(asc(s.suppliers.name));
    return NextResponse.json({ suppliers: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("purchasing.manage");
    const body = await req.json();
    if (!body.name?.trim()) throw new ServiceError("Supplier name is required.");
    const [row] = await db.insert(s.suppliers).values({
      name: body.name.trim(),
      contactName: String(body.contactName ?? ""),
      email: String(body.email ?? ""),
      phone: String(body.phone ?? ""),
    }).returning();
    await audit(user, "create", "supplier", row.id, { name: row.name });
    return NextResponse.json({ supplier: row });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth("purchasing.manage");
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    const body = await req.json();
    const [row] = await db.update(s.suppliers).set({
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.contactName !== undefined && { contactName: String(body.contactName) }),
      ...(body.email !== undefined && { email: String(body.email) }),
      ...(body.phone !== undefined && { phone: String(body.phone) }),
      ...(body.active !== undefined && { active: Boolean(body.active) }),
    }).where(eq(s.suppliers.id, id)).returning();
    await audit(user, "update", "supplier", id, body);
    return NextResponse.json({ supplier: row });
  } catch (e) {
    return errorResponse(e);
  }
}
