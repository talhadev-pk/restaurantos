import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { audit, errorResponse, ServiceError } from "@/lib/system";

export const dynamic = "force-dynamic";

type Entity = "categories" | "products" | "modifiers";

async function list(entity: Entity) {
  if (entity === "categories") {
    return db.select().from(s.categories).orderBy(asc(s.categories.sortOrder), asc(s.categories.name));
  }
  if (entity === "products") {
    return db
      .select({ product: s.products, categoryName: s.categories.name })
      .from(s.products)
      .leftJoin(s.categories, eq(s.products.categoryId, s.categories.id))
      .orderBy(asc(s.products.name));
  }
  return db.select().from(s.productModifiers);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  try {
    await requireAuth();
    const { entity } = await ctx.params;
    if (!["categories", "products", "modifiers"].includes(entity)) throw new ServiceError("Unknown menu entity.", 404);
    return NextResponse.json({ [entity]: await list(entity as Entity) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  try {
    const user = await requireAuth("menu.edit");
    const { entity } = await ctx.params;
    const body = await req.json();
    if (entity === "categories") {
      if (!body.name?.trim()) throw new ServiceError("Category name is required.");
      const [row] = await db
        .insert(s.categories)
        .values({ name: body.name.trim(), sortOrder: Number(body.sortOrder ?? 0), active: body.active !== false })
        .returning();
      await audit(user, "create", "category", row.id, { name: row.name });
      return NextResponse.json({ category: row });
    }
    if (entity === "products") {
      if (!body.name?.trim()) throw new ServiceError("Product name is required.");
      if (!(body.priceCents > 0)) throw new ServiceError("Product price must be greater than zero.");
      const [row] = await db
        .insert(s.products)
        .values({
          name: body.name.trim(),
          description: String(body.description ?? ""),
          categoryId: body.categoryId ?? null,
          priceCents: Math.round(body.priceCents),
          taxRateBp: Math.max(0, Math.min(30000, Math.round(body.taxRateBp ?? 850))),
          sku: body.sku ?? null,
          color: body.color ?? "amber",
          available: body.available !== false,
        })
        .returning();
      await audit(user, "create", "product", row.id, { name: row.name, priceCents: row.priceCents });
      return NextResponse.json({ product: row });
    }
    if (entity === "modifiers") {
      if (!body.productId || !body.name?.trim()) throw new ServiceError("Modifier needs a product and a name.");
      const [row] = await db
        .insert(s.productModifiers)
        .values({ productId: body.productId, name: body.name.trim(), priceDeltaCents: Math.round(body.priceDeltaCents ?? 0) })
        .returning();
      return NextResponse.json({ modifier: row });
    }
    throw new ServiceError("Unknown menu entity.", 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  try {
    const user = await requireAuth("menu.edit");
    const { entity } = await ctx.params;
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    const body = await req.json();
    if (entity === "categories") {
      const [row] = await db
        .update(s.categories)
        .set({
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.sortOrder !== undefined && { sortOrder: Number(body.sortOrder) }),
          ...(body.active !== undefined && { active: Boolean(body.active) }),
        })
        .where(eq(s.categories.id, id))
        .returning();
      await audit(user, "update", "category", id, body);
      return NextResponse.json({ category: row });
    }
    if (entity === "products") {
      const [row] = await db
        .update(s.products)
        .set({
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.description !== undefined && { description: String(body.description) }),
          ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
          ...(body.priceCents !== undefined && { priceCents: Math.round(body.priceCents) }),
          ...(body.taxRateBp !== undefined && { taxRateBp: Math.round(body.taxRateBp) }),
          ...(body.available !== undefined && { available: Boolean(body.available) }),
          ...(body.color !== undefined && { color: String(body.color) }),
          updatedAt: new Date(),
        })
        .where(eq(s.products.id, id))
        .returning();
      await audit(user, "update", "product", id, body);
      return NextResponse.json({ product: row });
    }
    if (entity === "modifiers") {
      const [row] = await db
        .update(s.productModifiers)
        .set({
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.priceDeltaCents !== undefined && { priceDeltaCents: Math.round(body.priceDeltaCents) }),
        })
        .where(eq(s.productModifiers.id, id))
        .returning();
      return NextResponse.json({ modifier: row });
    }
    throw new ServiceError("Unknown menu entity.", 404);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  try {
    const user = await requireAuth("menu.edit");
    const { entity } = await ctx.params;
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) throw new ServiceError("Missing id.");
    if (entity === "products") {
      await db.delete(s.products).where(eq(s.products.id, id));
      await audit(user, "delete", "product", id);
      return NextResponse.json({ ok: true });
    }
    if (entity === "categories") {
      await db.update(s.products).set({ categoryId: null }).where(eq(s.products.categoryId, id));
      await db.delete(s.categories).where(eq(s.categories.id, id));
      await audit(user, "delete", "category", id);
      return NextResponse.json({ ok: true });
    }
    if (entity === "modifiers") {
      await db.delete(s.productModifiers).where(eq(s.productModifiers.id, id));
      return NextResponse.json({ ok: true });
    }
    throw new ServiceError("Unknown menu entity.", 404);
  } catch (e) {
    return errorResponse(e);
  }
}
