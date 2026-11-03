import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const pos = await db
      .select({ po: s.purchaseOrders, supplierName: s.suppliers.name })
      .from(s.purchaseOrders)
      .innerJoin(s.suppliers, eq(s.purchaseOrders.supplierId, s.suppliers.id))
      .orderBy(desc(s.purchaseOrders.id));
    const items = await db
      .select({ item: s.purchaseOrderItems, ingredientName: s.ingredients.name, unit: s.ingredients.unit })
      .from(s.purchaseOrderItems)
      .innerJoin(s.ingredients, eq(s.purchaseOrderItems.ingredientId, s.ingredients.id));
    const itemsByPo = new Map<number, typeof items>();
    for (const it of items) {
      const arr = itemsByPo.get(it.item.orderId) ?? [];
      arr.push(it);
      itemsByPo.set(it.item.orderId, arr);
    }
    return NextResponse.json({
      purchaseOrders: pos.map((p) => ({ ...p.po, supplierName: p.supplierName, items: itemsByPo.get(p.po.id) ?? [] })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("purchasing.manage");
    const body = await req.json();
    const supplierId = Number(body.supplierId);
    const items: { ingredientId: number; quantity: number; unitCostCents: number }[] = body.items ?? [];
    if (!supplierId) throw new ServiceError("Supplier is required.");
    if (!items.length) throw new ServiceError("A purchase order needs at least one item.");
    for (const it of items) {
      if (!it.ingredientId || !(it.quantity > 0) || !(it.unitCostCents >= 0)) {
        throw new ServiceError("Each line needs an ingredient, quantity and unit cost.");
      }
    }
    const total = items.reduce((a, i) => a + Math.round(i.quantity * i.unitCostCents), 0);
    const po = await db.transaction(async (tx) => {
      const [row] = await tx.insert(s.purchaseOrders).values({ supplierId, totalCostCents: total, status: "draft" }).returning();
      await tx.insert(s.purchaseOrderItems).values(
        items.map((i) => ({
          orderId: row.id, ingredientId: i.ingredientId,
          quantity: Math.round(i.quantity * 1000) / 1000, unitCostCents: Math.round(i.unitCostCents),
        })),
      );
      return row;
    });
    await audit(user, "create", "purchase_order", po.id, { totalCostCents: total });
    return NextResponse.json({ purchaseOrder: po });
  } catch (e) {
    return errorResponse(e);
  }
}
