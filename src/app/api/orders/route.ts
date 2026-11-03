import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/system";
import { createOrder, CreateOrderInput } from "@/lib/services/orders";
import { resolveRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const sp = new URL(req.url).searchParams;
    const { from, to } = resolveRange(sp);
    const status = sp.get("status");
    const source = sp.get("source");
    const openOnly = sp.get("open") === "true";
    const limit = Math.min(200, Number(sp.get("limit") ?? 100));

    const conds = [];
    if (openOnly) conds.push(sql`${s.orders.status} in ('pending','confirmed','preparing','ready','served')`);
    else conds.push(and(gte(s.orders.createdAt, from), lte(s.orders.createdAt, to)));
    if (status) conds.push(eq(s.orders.status, status));
    if (source) conds.push(eq(s.orders.source, source));

    const rows = await db
      .select({
        order: s.orders,
        tableName: s.restaurantTables.name,
        customerName: s.customers.name,
        itemCount: sql<number>`(select count(*)::int from order_items oi where oi.order_id = ${s.orders.id})`,
      })
      .from(s.orders)
      .leftJoin(s.restaurantTables, eq(s.orders.tableId, s.restaurantTables.id))
      .leftJoin(s.customers, eq(s.orders.customerId, s.customers.id))
      .where(and(...conds))
      .orderBy(desc(s.orders.id))
      .limit(limit);

    return NextResponse.json({ orders: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("pos.use");
    const body = (await req.json()) as CreateOrderInput;
    if (!["dine_in", "takeaway", "delivery"].includes(body.type)) {
      return NextResponse.json({ error: "Invalid order type." }, { status: 400 });
    }
    const order = await createOrder({ id: user.id, name: user.name }, body);
    return NextResponse.json({ order });
  } catch (e) {
    return errorResponse(e);
  }
}
