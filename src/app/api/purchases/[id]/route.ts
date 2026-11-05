import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth("purchasing.manage");
    const id = Number((await ctx.params).id);
    const body = await req.json();
    const action = String(body.action ?? "");

    const updated = await db.transaction(async (tx) => {
      const [po] = await tx.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, id));
      if (!po) throw new ServiceError("Purchase order not found.", 404);

      if (action === "approve") {
        if (po.status !== "draft") throw new ServiceError("Only draft orders can be approved.", 409);
        const [row] = await tx.update(s.purchaseOrders).set({ status: "approved" }).where(eq(s.purchaseOrders.id, id)).returning();
        return row;
      }
      if (action === "cancel") {
        if (po.status === "received" || po.status === "partially_received") {
          throw new ServiceError("Cannot cancel a purchase order that has received goods.", 409);
        }
        const [row] = await tx.update(s.purchaseOrders).set({ status: "cancelled" }).where(eq(s.purchaseOrders.id, id)).returning();
        return row;
      }
      if (action === "receive") {
        if (!["approved", "partially_received"].includes(po.status)) {
          throw new ServiceError("Approve the purchase order before receiving goods.", 409);
        }
        const lines = await tx.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.orderId, id));
        const received: { itemId: number; qty: number }[] = body.received ?? [];
        const byItem = new Map(received.map((r) => [r.itemId, r.qty]));
        for (const line of lines) {
          const qty = byItem.get(line.id);
          if (qty === undefined) continue;
          if (!(qty >= 0)) throw new ServiceError("Received quantity cannot be negative.");
          const newReceived = Math.round((line.receivedQty + qty) * 1000) / 1000;
          if (newReceived > line.quantity + 1e-9) {
            throw new ServiceError(`Cannot receive more than ordered for a line (ordered ${line.quantity}).`, 422);
          }
          if (qty === 0) continue;
          await tx.update(s.purchaseOrderItems).set({ receivedQty: newReceived }).where(eq(s.purchaseOrderItems.id, line.id));
          const [ing] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, line.ingredientId));
          if (ing) {
            await tx.update(s.ingredients)
              .set({ stockQty: Math.round((ing.stockQty + qty) * 1000) / 1000, unitCostCents: line.unitCostCents })
              .where(eq(s.ingredients.id, ing.id));
            await tx.insert(s.stockMovements).values({
              ingredientId: ing.id, type: "purchase", quantity: qty,
              unitCostCents: line.unitCostCents, referenceType: "purchase_order", referenceId: id,
              note: `PO #${id} goods received`,
            });
          }
        }
        const refreshed = await tx.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.orderId, id));
        const allIn = refreshed.every((l) => l.receivedQty >= l.quantity - 1e-9);
        const anyIn = refreshed.some((l) => l.receivedQty > 0);
        const status = allIn ? "received" : anyIn ? "partially_received" : po.status;
        const [row] = await tx.update(s.purchaseOrders)
          .set({ status, ...(status === "received" ? { receivedAt: new Date() } : {}) })
          .where(eq(s.purchaseOrders.id, id))
          .returning();
        return row;
      }
      throw new ServiceError("Unknown purchase order action.");
    });
    await audit(user, action, "purchase_order", id);
    return NextResponse.json({ purchaseOrder: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
