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
    const products = await db.select().from(s.products).orderBy(asc(s.products.name));
    const recs = await db.select().from(s.recipes);
    const lines = await db
      .select({ line: s.recipeIngredients, ingredient: s.ingredients })
      .from(s.recipeIngredients)
      .innerJoin(s.ingredients, eq(s.recipeIngredients.ingredientId, s.ingredients.id));
    const byRecipe = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = byRecipe.get(l.line.recipeId) ?? [];
      arr.push(l);
      byRecipe.set(l.line.recipeId, arr);
    }
    const recByProduct = new Map(recs.map((r) => [r.productId, r]));
    const result = products.map((p) => {
      const rec = recByProduct.get(p.id);
      const recLines = rec ? byRecipe.get(rec.id) ?? [] : [];
      const costCents = recLines.reduce((a, l) => a + Math.round(l.line.quantity * l.ingredient.unitCostCents), 0);
      const grossProfitCents = p.priceCents - costCents;
      return {
        productId: p.id,
        productName: p.name,
        priceCents: p.priceCents,
        available: p.available,
        recipeId: rec?.id ?? null,
        notes: rec?.notes ?? "",
        costCents,
        grossProfitCents,
        marginPct: p.priceCents > 0 ? Math.round((grossProfitCents / p.priceCents) * 1000) / 10 : 0,
        lines: recLines.map((l) => ({
          ingredientId: l.line.ingredientId,
          ingredientName: l.ingredient.name,
          unit: l.ingredient.unit,
          quantity: l.line.quantity,
          unitCostCents: l.ingredient.unitCostCents,
          lineCostCents: Math.round(l.line.quantity * l.ingredient.unitCostCents),
        })),
      };
    });
    return NextResponse.json({ recipes: result });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth("recipes.edit");
    const body = await req.json();
    const productId = Number(body.productId);
    if (!productId) throw new ServiceError("productId is required.");
    const lines: { ingredientId: number; quantity: number }[] = body.lines ?? [];
    for (const l of lines) {
      if (!l.ingredientId || !(l.quantity > 0)) throw new ServiceError("Each recipe line needs an ingredient and a quantity > 0.");
    }
    const saved = await db.transaction(async (tx) => {
      const existing = await tx.select().from(s.recipes).where(eq(s.recipes.productId, productId)).limit(1);
      const [rec] = existing.length
        ? await tx.update(s.recipes).set({ notes: String(body.notes ?? existing[0].notes) }).where(eq(s.recipes.id, existing[0].id)).returning()
        : await tx.insert(s.recipes).values({ productId, notes: String(body.notes ?? "") }).returning();
      await tx.delete(s.recipeIngredients).where(eq(s.recipeIngredients.recipeId, rec.id));
      if (lines.length) {
        await tx.insert(s.recipeIngredients).values(
          lines.map((l) => ({ recipeId: rec.id, ingredientId: l.ingredientId, quantity: Math.round(l.quantity * 1000) / 1000 })),
        );
      }
      return rec;
    });
    await audit(user, "update", "recipe", saved.id, { productId, lines: lines.length });
    return NextResponse.json({ ok: true, recipeId: saved.id });
  } catch (e) {
    return errorResponse(e);
  }
}
