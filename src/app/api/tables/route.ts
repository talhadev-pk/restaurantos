import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const rows = await db
      .select({
        table: s.restaurantTables,
        activeOrderId: s.orders.id,
        activeOrderNumber: s.orders.orderNumber,
        activeOrderTotal: s.orders.totalCents,
        activeOrderStatus: s.orders.status,
        activeOrderCreatedAt: s.orders.createdAt,
      })
      .from(s.restaurantTables)
      .leftJoin(
        s.orders,
        and(
          eq(s.orders.tableId, s.restaurantTables.id),
          inArray(s.orders.status, ["pending", "confirmed", "preparing", "ready", "served"]),
        ),
      )
      .orderBy(asc(s.restaurantTables.name), asc(s.orders.id));
    // collapse: keep the earliest active order per table
    const map = new Map<number, (typeof rows)[number]>();
    for (const r of rows) if (!map.has(r.table.id)) map.set(r.table.id, r);
    return NextResponse.json({ tables: [...map.values()] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("tables.manage");
    const body = await req.json();
    if (!body.name?.trim()) throw new ServiceError("Table name is required.");
    if (!(body.capacity > 0 && body.capacity <= 20)) throw new ServiceError("Capacity must be between 1 and 20.");
    const [row] = await db
      .insert(s.restaurantTables)
      .values({
        name: body.name.trim(),
        capacity: Math.round(body.capacity),
        posX: Number(body.posX ?? 0),
        posY: Number(body.posY ?? 0),
      })
      .returning();
    await audit(user, "create", "table", row.id, { name: row.name });
    return NextResponse.json({ table: row });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth("tables.manage");
    const body = await req.json();
    const id = Number(body.id);
    if (!id) throw new ServiceError("Missing table id.");
    const action = String(body.action ?? "update");

    if (action === "status") {
      const next = String(body.status);
      if (!["available", "occupied", "reserved", "cleaning"].includes(next)) throw new ServiceError("Invalid status.");
      const [t] = await db
        .update(s.restaurantTables)
        .set({ status: next, ...(next === "available" ? { note: "" } : {}) })
        .where(eq(s.restaurantTables.id, id))
        .returning();
      await audit(user, "status", "table", id, { status: next });
      return NextResponse.json({ table: t });
    }

    if (action === "transfer") {
      const toId = Number(body.toTableId);
      const [from, to] = await Promise.all([
        db.select().from(s.restaurantTables).where(eq(s.restaurantTables.id, id)).limit(1),
        db.select().from(s.restaurantTables).where(eq(s.restaurantTables.id, toId)).limit(1),
      ]);
      if (!from[0] || !to[0]) throw new ServiceError("Table not found.", 404);
      if (to[0].status !== "available") throw new ServiceError(`Table ${to[0].name} is not available.`, 409);
      await db.transaction(async (tx) => {
        await tx
          .update(s.orders)
          .set({ tableId: toId, updatedAt: new Date() })
          .where(and(eq(s.orders.tableId, id), inArray(s.orders.status, ["pending", "confirmed", "preparing", "ready", "served"])));
        await tx.update(s.restaurantTables).set({ status: "occupied" }).where(eq(s.restaurantTables.id, toId));
        await tx.update(s.restaurantTables).set({ status: "available" }).where(eq(s.restaurantTables.id, id));
      });
      await audit(user, "transfer", "table", id, { toTableId: toId });
      return NextResponse.json({ ok: true });
    }

    if (action === "combine" || action === "separate") {
      const ids: number[] = body.tableIds ?? [id];
      if (!ids.length) throw new ServiceError("Select tables to combine.");
      if (action === "combine") {
        const names = await db.select().from(s.restaurantTables).where(inArray(s.restaurantTables.id, ids));
        for (const t of names) {
          if (t.status !== "available") throw new ServiceError(`Table ${t.name} is not available to combine.`, 409);
        }
        const label = `Combined: ${names.map((n) => n.name).join(" + ")}${body.partySize ? ` (party of ${body.partySize})` : ""}`;
        await db.update(s.restaurantTables).set({ status: "reserved", note: label }).where(inArray(s.restaurantTables.id, ids));
        await audit(user, "combine", "table", ids[0], { tableIds: ids });
      } else {
        await db.update(s.restaurantTables).set({ status: "available", note: "" }).where(inArray(s.restaurantTables.id, ids));
        await audit(user, "separate", "table", ids[0], { tableIds: ids });
      }
      return NextResponse.json({ ok: true });
    }

    // plain update
    const [t] = await db
      .update(s.restaurantTables)
      .set({
        ...(body.name !== undefined && { name: String(body.name).trim() }),
        ...(body.capacity !== undefined && { capacity: Math.round(body.capacity) }),
        ...(body.active !== undefined && { active: Boolean(body.active) }),
      })
      .where(eq(s.restaurantTables.id, id))
      .returning();
    await audit(user, "update", "table", id, body);
    return NextResponse.json({ table: t });
  } catch (e) {
    return errorResponse(e);
  }
}
