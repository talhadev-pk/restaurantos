import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

function segmentOf(c: { visits: number; totalSpentCents: number }) {
  if (c.visits >= 8 || c.totalSpentCents >= 40000) return "vip";
  if (c.visits >= 3 || c.totalSpentCents >= 12000) return "regular";
  return "new";
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (id) {
      const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, id));
      if (!customer) throw new ServiceError("Customer not found.", 404);
      const history = await db
        .select({
          id: s.orders.id, orderNumber: s.orders.orderNumber, type: s.orders.type,
          status: s.orders.status, totalCents: s.orders.totalCents, createdAt: s.orders.createdAt,
        })
        .from(s.orders)
        .where(eq(s.orders.customerId, id))
        .orderBy(desc(s.orders.id))
        .limit(30);
      return NextResponse.json({ customer: { ...customer, segment: segmentOf(customer) }, history });
    }
    const rows = await db.select().from(s.customers).orderBy(desc(s.customers.totalSpentCents)).limit(500);
    return NextResponse.json({ customers: rows.map((c) => ({ ...c, segment: segmentOf(c) })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("customers.manage");
    const body = await req.json();
    if (!body.name?.trim()) throw new ServiceError("Customer name is required.");
    const [row] = await db.insert(s.customers).values({
      name: body.name.trim(),
      phone: String(body.phone ?? ""),
      email: String(body.email ?? ""),
      isVirtual: Boolean(body.isVirtual ?? false),
    }).returning();
    await audit(user, "create", "customer", row.id, { name: row.name });
    return NextResponse.json({ customer: row });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth("customers.manage");
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    const body = await req.json();
    const [row] = await db.update(s.customers).set({
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.phone !== undefined && { phone: String(body.phone) }),
      ...(body.email !== undefined && { email: String(body.email) }),
      ...(body.loyaltyPoints !== undefined && { loyaltyPoints: Math.max(0, Math.round(body.loyaltyPoints)) }),
    }).where(eq(s.customers.id, id)).returning();
    await audit(user, "update", "customer", id, body);
    return NextResponse.json({ customer: row });
  } catch (e) {
    return errorResponse(e);
  }
}
