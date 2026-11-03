import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError, getSetting } from "@/lib/system";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const ingredients = await db.select().from(s.ingredients).orderBy(asc(s.ingredients.name));
    const movements = await db.select({
      m: s.stockMovements,
      ingredientName: s.ingredients.name,
      unit: s.ingredients.unit,
    }).from(s.stockMovements)
      .innerJoin(s.ingredients, eq(s.stockMovements.ingredientId, s.ingredients.id))
      .orderBy(desc(s.stockMovements.id))
      .limit(40);
    const valuation = ingredients.reduce((a, i) => a + Math.round(i.stockQty * i.unitCostCents), 0);
    const wasteCost = await db.execute(sql`
      SELECT coalesce(sum(quantity * unit_cost_cents),0)::int AS cost
      FROM stock_movements WHERE type = 'waste'
    `);
    return NextResponse.json({
      ingredients: ingredients.map((i) => ({ ...i, low: i.stockQty <= i.minStock })),
      movements,
      valuation,
      wasteCostCents: Number((wasteCost.rows[0] as { cost: number })?.cost ?? 0),
      allowNegativeStock: (await getSetting("allowNegativeStock", "false")) === "true",
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth("inventory.manage");
    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "create") {
      if (!body.name?.trim()) throw new ServiceError("Ingredient name is required.");
      if (!["pcs", "g", "ml"].includes(body.unit)) throw new ServiceError("Unit must be pcs, g or ml.");
      const [row] = await db.insert(s.ingredients).values({
        name: body.name.trim(),
        unit: body.unit,
        stockQty: Math.max(0, Number(body.stockQty ?? 0)),
        minStock: Math.max(0, Number(body.minStock ?? 0)),
        unitCostCents: Math.max(0, Math.round(body.unitCostCents ?? 0)),
      }).returning();
      if (row.stockQty > 0) {
        await db.insert(s.stockMovements).values({
          ingredientId: row.id, type: "adjustment", quantity: row.stockQty,
          unitCostCents: row.unitCostCents, referenceType: "manual", note: "Opening stock",
        });
      }
      await audit(user, "create", "ingredient", row.id, { name: row.name });
      return NextResponse.json({ ingredient: row });
    }

    const ingredientId = Number(body.ingredientId);
    if (!ingredientId) throw new ServiceError("ingredientId is required.");
    const qty = Number(body.quantity);
    if (!(qty > 0)) throw new ServiceError("Quantity must be greater than zero.");
    const note = String(body.note ?? "").slice(0, 200);

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`);
      const [ing] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, ingredientId));
      if (!ing) throw new ServiceError("Ingredient not found.", 404);
      if (action === "adjust" || action === "restock") {
        const delta = action === "adjust" ? Number(body.quantity) : qty; // adjust may be signed
        const next = Math.round((ing.stockQty + delta) * 1000) / 1000;
        if (next < 0) throw new ServiceError(`Adjustment would make "${ing.name}" negative.`, 422);
        await tx.update(s.ingredients).set({ stockQty: next }).where(eq(s.ingredients.id, ingredientId));
        await tx.insert(s.stockMovements).values({
          ingredientId, type: "adjustment", quantity: Math.abs(delta),
          unitCostCents: ing.unitCostCents, referenceType: "manual",
          note: `${delta >= 0 ? "+" : "-"}${Math.abs(delta)} ${ing.unit}${note ? ` — ${note}` : ""}`,
        });
        return { stockQty: next };
      }
      if (action === "waste") {
        const next = Math.round((ing.stockQty - qty) * 1000) / 1000;
        if (next < 0) throw new ServiceError(`Cannot waste more than the current stock of "${ing.name}".`, 422);
        await tx.update(s.ingredients).set({ stockQty: next }).where(eq(s.ingredients.id, ingredientId));
        await tx.insert(s.stockMovements).values({
          ingredientId, type: "waste", quantity: qty,
          unitCostCents: ing.unitCostCents, referenceType: "manual", note: note || "Wastage recorded",
        });
        return { stockQty: next };
      }
      throw new ServiceError("Unknown inventory action.");
    });
    await audit(user, action, "ingredient", ingredientId, { quantity: qty, note });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth("inventory.manage");
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    const body = await req.json();
    const [row] = await db.update(s.ingredients).set({
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.unit !== undefined && { unit: String(body.unit) }),
      ...(body.minStock !== undefined && { minStock: Math.max(0, Number(body.minStock)) }),
      ...(body.unitCostCents !== undefined && { unitCostCents: Math.max(0, Math.round(body.unitCostCents)) }),
      ...(body.active !== undefined && { active: Boolean(body.active) }),
      ...(body.expiresAt !== undefined && { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }),
    }).where(eq(s.ingredients.id, id)).returning();
    await audit(user, "update", "ingredient", id, body);
    return NextResponse.json({ ingredient: row });
  } catch (e) {
    return errorResponse(e);
  }
}
