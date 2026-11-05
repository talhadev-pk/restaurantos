import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

const WINDOW_MS = 2 * 60 * 60 * 1000; // 2h conflict window

export async function GET() {
  try {
    await requireAuth();
    const rows = await db
      .select({
        r: s.reservations,
        tableName: s.restaurantTables.name,
        capacity: s.restaurantTables.capacity,
        customerName: s.customers.name,
      })
      .from(s.reservations)
      .innerJoin(s.restaurantTables, eq(s.reservations.tableId, s.restaurantTables.id))
      .leftJoin(s.customers, eq(s.reservations.customerId, s.customers.id))
      .orderBy(desc(s.reservations.reservedFor))
      .limit(200);
    return NextResponse.json({ reservations: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("reservations.manage");
    const body = await req.json();
    const tableId = Number(body.tableId);
    const when = new Date(body.reservedFor);
    const partySize = Number(body.partySize);
    if (!tableId || isNaN(when.getTime())) throw new ServiceError("A table and a valid date/time are required.");
    if (!(partySize > 0 && partySize <= 20)) throw new ServiceError("Party size must be between 1 and 20.");

    const created = await db.transaction(async (tx) => {
      const [table] = await tx.select().from(s.restaurantTables).where(eq(s.restaurantTables.id, tableId));
      if (!table) throw new ServiceError("Table not found.", 404);
      if (partySize > table.capacity) throw new ServiceError(`Table ${table.name} seats ${table.capacity} — party of ${partySize} won't fit.`, 422);
      // Conflict prevention within ±2h for active reservations
      const clash = await tx.all(sql`
        SELECT id, reserved_for FROM reservations
        WHERE table_id = ${tableId} AND status IN ('booked','seated')
          AND reserved_for BETWEEN ${when.getTime() - WINDOW_MS} AND ${when.getTime() + WINDOW_MS}
        LIMIT 1
      `);
      if (clash.length) {
        throw new ServiceError("This table already has a reservation within two hours of that time.", 409);
      }
      const [row] = await tx.insert(s.reservations).values({
        customerId: body.customerId ?? null,
        customerName: String(body.customerName ?? ""),
        tableId,
        reservedFor: when,
        partySize,
        notes: String(body.notes ?? "").slice(0, 300),
      }).returning();
      if (when.getTime() < Date.now() + WINDOW_MS && table.status === "available") {
        await tx.update(s.restaurantTables).set({ status: "reserved" }).where(eq(s.restaurantTables.id, tableId));
      }
      return row;
    });
    await audit(user, "create", "reservation", created.id, { tableId, reservedFor: when });
    return NextResponse.json({ reservation: created });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth("reservations.manage");
    const id = Number(new URL(req.url).searchParams.get("id"));
    const body = await req.json();
    const action = String(body.action ?? "");
    const [res] = await db.select().from(s.reservations).where(eq(s.reservations.id, id));
    if (!res) throw new ServiceError("Reservation not found.", 404);
    if (!["booked"].includes(res.status) && ["seat", "cancel", "no_show"].includes(action)) {
      throw new ServiceError(`Cannot ${action.replace("_", " ")} a reservation with status "${res.status}".`, 409);
    }
    const statusMap: Record<string, string> = { seat: "seated", complete: "completed", cancel: "cancelled", no_show: "no_show" };
    const next = statusMap[action];
    if (!next) throw new ServiceError("Unknown reservation action.");
    await db.transaction(async (tx) => {
      await tx.update(s.reservations).set({ status: next }).where(eq(s.reservations.id, id));
      if (action === "seat") {
        await tx.update(s.restaurantTables).set({ status: "occupied" }).where(eq(s.restaurantTables.id, res.tableId));
      }
      if (["cancel", "no_show", "complete"].includes(action)) {
        const otherActive = await tx
          .select({ id: s.reservations.id })
          .from(s.reservations)
          .where(and(eq(s.reservations.tableId, res.tableId), inArray(s.reservations.status, ["booked", "seated"]), sql`${s.reservations.id} != ${id}`))
          .limit(1);
        const openOrders = await tx
          .select({ id: s.orders.id })
          .from(s.orders)
          .where(and(eq(s.orders.tableId, res.tableId), inArray(s.orders.status, ["pending", "confirmed", "preparing", "ready", "served"])))
          .limit(1);
        if (!otherActive.length && !openOrders.length) {
          await tx.update(s.restaurantTables).set({ status: "available", note: "" }).where(eq(s.restaurantTables.id, res.tableId));
        }
      }
    });
    await audit(user, action, "reservation", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
