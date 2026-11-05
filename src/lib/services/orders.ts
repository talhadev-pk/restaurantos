// Server-only: the transactional business core of RestaurantOS.
// Every order — manual POS or simulation-generated — flows through these
// functions so pricing, tax, inventory, payment and table logic stay unified.
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Actor, ServiceError, audit, getSetting } from "../system";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------- helpers ----------
async function generateOrderNumber(tx: Tx): Promise<string> {
  const [{ c }] = await tx.select({ c: sql<number>`count(*)` }).from(s.orders);
  const rand = Math.floor(100 + Math.random() * 900);
  return `ROS-${1000 + Number(c) + 1}-${rand}`;
}

export interface OrderItemInput {
  productId: number;
  quantity: number;
  modifierIds?: number[];
  instructions?: string;
}
export interface CreateOrderInput {
  type: "dine_in" | "takeaway" | "delivery";
  tableId?: number | null;
  customerId?: number | null;
  items: OrderItemInput[];
  discountCents?: number;
  notes?: string;
  autoConfirm?: boolean;
  source?: "manual" | "simulation";
  simulationSessionId?: number | null;
}

interface PricedItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  modifiers: { name: string; priceDeltaCents: number }[];
  instructions: string;
  lineSubtotalCents: number;
  lineTaxCents: number;
}

async function priceItems(tx: Tx, items: OrderItemInput[]) {
  if (!items.length) throw new ServiceError("An order needs at least one item.");
  const productIds = [...new Set(items.map((i) => i.productId))];
  const prods = await tx.select().from(s.products).where(inArray(s.products.id, productIds));
  const prodMap = new Map(prods.map((p) => [p.id, p]));
  const mods = await tx
    .select()
    .from(s.productModifiers)
    .where(inArray(s.productModifiers.productId, productIds));
  const modsById = new Map(mods.map((m) => [m.id, m]));

  const priced: PricedItem[] = [];
  for (const item of items) {
    const p = prodMap.get(item.productId);
    if (!p) throw new ServiceError(`Product #${item.productId} does not exist.`);
    if (!p.available) throw new ServiceError(`"${p.name}" is currently unavailable.`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      throw new ServiceError(`Invalid quantity for "${p.name}".`);
    }
    const selectedMods = (item.modifierIds ?? []).map((id) => {
      const m = modsById.get(id);
      if (!m || m.productId !== p.id) throw new ServiceError(`Invalid modifier for "${p.name}".`);
      return { name: m.name, priceDeltaCents: m.priceDeltaCents };
    });
    const unit = p.priceCents + selectedMods.reduce((a, m) => a + m.priceDeltaCents, 0);
    const lineSubtotal = unit * item.quantity;
    priced.push({
      productId: p.id,
      productName: p.name,
      quantity: item.quantity,
      unitPriceCents: unit,
      taxRateBp: p.taxRateBp,
      modifiers: selectedMods,
      instructions: (item.instructions ?? "").slice(0, 200),
      lineSubtotalCents: lineSubtotal,
      lineTaxCents: Math.round((lineSubtotal * p.taxRateBp) / 10000),
    });
  }
  return priced;
}

/** Ingredient quantities required to fulfill an order (from recipes). */
async function computeRequirements(tx: Tx, orderId: number) {
  const items = await tx.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId));
  const productIds = [...new Set(items.filter((i) => i.productId).map((i) => i.productId as number))];
  if (!productIds.length) return new Map<number, number>();
  const recs = await tx.select().from(s.recipes).where(inArray(s.recipes.productId, productIds));
  const recByProduct = new Map(recs.map((r) => [r.productId, r.id]));
  const recIds = recs.map((r) => r.id);
  const ris = recIds.length
    ? await tx.select().from(s.recipeIngredients).where(inArray(s.recipeIngredients.recipeId, recIds))
    : [];
  const riByRecipe = new Map<number, typeof ris>();
  for (const ri of ris) {
    const arr = riByRecipe.get(ri.recipeId) ?? [];
    arr.push(ri);
    riByRecipe.set(ri.recipeId, arr);
  }
  const required = new Map<number, number>();
  for (const item of items) {
    if (!item.productId) continue;
    const recId = recByProduct.get(item.productId);
    if (!recId) continue; // product without a recipe consumes nothing
    for (const ri of riByRecipe.get(recId) ?? []) {
      required.set(ri.ingredientId, (required.get(ri.ingredientId) ?? 0) + ri.quantity * item.quantity);
    }
  }
  return required;
}

/** Deduct ingredient stock for an order. Throws (rolling back the tx) if stock is insufficient. */
async function deductInventory(tx: Tx, orderId: number, source: string, allowNegative: boolean) {
  const required = await computeRequirements(tx, orderId);
  let cogs = 0;
  for (const [ingredientId, qty] of required) {
    const [ing] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, ingredientId));
    if (!ing) continue;
    const next = Math.round((ing.stockQty - qty) * 1000) / 1000;
    if (next < 0 && !allowNegative) {
      throw new ServiceError(
        `Insufficient stock for "${ing.name}": need ${qty} ${ing.unit}, only ${ing.stockQty} ${ing.unit} available.`,
        422,
        { ingredientId, required: qty, available: ing.stockQty },
      );
    }
    cogs += Math.round(qty * ing.unitCostCents);
    await tx.update(s.ingredients).set({ stockQty: next }).where(eq(s.ingredients.id, ingredientId));
    await tx.insert(s.stockMovements).values({
      ingredientId,
      type: "consumption",
      quantity: qty,
      unitCostCents: ing.unitCostCents,
      referenceType: "order",
      referenceId: orderId,
      source,
      note: `Order consumption`,
    });
  }
  return cogs;
}

async function restoreInventory(tx: Tx, orderId: number) {
  const moves = await tx
    .select()
    .from(s.stockMovements)
    .where(
      and(
        eq(s.stockMovements.referenceType, "order"),
        eq(s.stockMovements.referenceId, orderId),
        eq(s.stockMovements.type, "consumption"),
      ),
    );
  for (const m of moves) {
    const [ing] = await tx.select().from(s.ingredients).where(eq(s.ingredients.id, m.ingredientId));
    if (!ing) continue;
    await tx
      .update(s.ingredients)
      .set({ stockQty: Math.round((ing.stockQty + m.quantity) * 1000) / 1000 })
      .where(eq(s.ingredients.id, ing.id));
    await tx.insert(s.stockMovements).values({
      ingredientId: m.ingredientId,
      type: "refund_restore",
      quantity: m.quantity,
      unitCostCents: m.unitCostCents ?? undefined,
      referenceType: "order",
      referenceId: orderId,
      note: "Restored on refund",
    });
  }
}

async function freeTableIfIdle(tx: Tx, tableId: number | null, nextStatus: "available" | "cleaning") {
  if (!tableId) return;
  const active = await tx
    .select({ id: s.orders.id })
    .from(s.orders)
    .where(
      and(
        eq(s.orders.tableId, tableId),
        inArray(s.orders.status, ["pending", "confirmed", "preparing", "ready", "served"]),
      ),
    )
    .limit(1);
  if (!active.length) {
    await tx.update(s.restaurantTables).set({ status: nextStatus }).where(eq(s.restaurantTables.id, tableId));
  }
}

// ---------- public API ----------
export async function createOrder(actor: Actor, input: CreateOrderInput) {
  const allowNegative = (await getSetting("allowNegativeStock", "false")) === "true";
  const order = await db.transaction(async (tx) => {
    const priced = await priceItems(tx, input.items);
    const subtotal = priced.reduce((a, i) => a + i.lineSubtotalCents, 0);
    const tax = priced.reduce((a, i) => a + i.lineTaxCents, 0);
    const discount = Math.min(Math.max(0, input.discountCents ?? 0), subtotal);
    const total = Math.max(0, subtotal - discount) + tax;

    let tableId: number | null = null;
    if (input.type === "dine_in") {
      if (!input.tableId) throw new ServiceError("Dine-in orders require a table.");
      const table = await tx
        .select()
        .from(s.restaurantTables)
        .where(eq(s.restaurantTables.id, input.tableId))
        .limit(1);
      const t = table[0];
      if (!t || !t.active) throw new ServiceError("Selected table does not exist.");
      if (t.status === "occupied" || t.status === "cleaning") {
        throw new ServiceError(`Table ${t.name} is ${t.status}. Choose another table.`, 409);
      }
      tableId = t.id;
      await tx.update(s.restaurantTables).set({ status: "occupied" }).where(eq(s.restaurantTables.id, t.id));
    }

    const [row] = await tx
      .insert(s.orders)
      .values({
        orderNumber: await generateOrderNumber(tx),
        type: input.type,
        status: input.autoConfirm ? "confirmed" : "pending",
        tableId,
        customerId: input.customerId ?? null,
        subtotalCents: subtotal,
        taxCents: tax,
        discountCents: discount,
        totalCents: total,
        source: input.source ?? "manual",
        simulationSessionId: input.simulationSessionId ?? null,
        notes: (input.notes ?? "").slice(0, 300),
      })
      .returning();
    await tx.insert(s.orderItems).values(priced.map((p) => ({ ...p, orderId: row.id })));
    return { row, priced };
  });
  // Pre-flight inventory feasibility warning happens at completion; block obvious impossibles early
  // only when negative stock isn't allowed and recipes exist.
  if (!allowNegative) {
    // (non-blocking) – feasibility is enforced transactionally at completion time.
  }
  await audit(actor, "create", "order", order.row.id, {
    orderNumber: order.row.orderNumber,
    totalCents: order.row.totalCents,
    source: order.row.source,
  });
  return order.row;
}

export type TransitionAction =
  | "confirm"
  | "start_prepare"
  | "ready"
  | "serve"
  | "complete"
  | "cancel"
  | "refund";

const NEXT: Record<string, Record<string, string>> = {
  pending: { confirm: "confirmed", cancel: "cancelled" },
  confirmed: { start_prepare: "preparing", cancel: "cancelled" },
  preparing: { ready: "ready", cancel: "cancelled" },
  ready: { serve: "served", complete: "completed", cancel: "cancelled" },
  served: { complete: "completed" },
};

export async function transitionOrder(
  actor: Actor,
  orderId: number,
  action: TransitionAction,
  payload: { paymentMethod?: string; reason?: string } = {},
) {
  const allowNegative = (await getSetting("allowNegativeStock", "false")) === "true";
  const result = await db.transaction(async (tx) => {
    // SQLite serializes writers in-process; re-read inside the transaction for idempotency.
    const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, orderId));
    if (!order) throw new ServiceError("Order not found.", 404);

    if (action === "refund") {
      if (order.status !== "completed") throw new ServiceError("Only completed orders can be refunded.");
      const [existingRefund] = await tx.select().from(s.refunds).where(eq(s.refunds.orderId, orderId)).limit(1);
      if (existingRefund) throw new ServiceError("This order has already been refunded.", 409);
      if (order.inventoryDeducted) await restoreInventory(tx, orderId);
      const [refund] = await tx
        .insert(s.refunds)
        .values({
          orderId,
          amountCents: order.totalCents,
          reason: payload.reason ?? "Customer refund",
          inventoryRestored: order.inventoryDeducted,
        })
        .returning();
      await tx.update(s.orders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(s.orders.id, orderId));
      return { order: { ...order, status: "cancelled" }, refund };
    }

    const target = NEXT[order.status]?.[action];
    if (!target) {
      throw new ServiceError(`Cannot ${action.replace("_", " ")} an order with status "${order.status}".`, 409);
    }

    const patch: Partial<typeof s.orders.$inferInsert> = { status: target, updatedAt: new Date() };

    if (target === "completed") {
      if (!order.inventoryDeducted) {
        const cogs = await deductInventory(tx, orderId, order.source, allowNegative);
        patch.inventoryDeducted = true;
        patch.cogsCents = cogs;
      }
      patch.completedAt = new Date();
      // Payment — unique(orderId) makes double-charging impossible.
      await tx
        .insert(s.payments)
        .values({
          orderId,
          amountCents: order.totalCents,
          method: payload.paymentMethod ?? "cash",
        })
        .onConflictDoNothing();
      // Customer stats (once per completion; completion itself is idempotent)
      if (order.customerId) {
        await tx
          .update(s.customers)
          .set({
            visits: sql`${s.customers.visits} + 1`,
            totalSpentCents: sql`${s.customers.totalSpentCents} + ${order.totalCents}`,
            loyaltyPoints: sql`${s.customers.loyaltyPoints} + ${Math.floor(order.totalCents / 1000)}`,
          })
          .where(eq(s.customers.id, order.customerId));
      }
    }

    await tx.update(s.orders).set(patch).where(eq(s.orders.id, orderId));

    if (target === "completed") await freeTableIfIdle(tx, order.tableId, "cleaning");
    if (target === "cancelled") await freeTableIfIdle(tx, order.tableId, "available");

    return { order: { ...order, ...patch } };
  });
  await audit(actor, action, "order", orderId, {
    from: result.order.orderNumber,
    to: result.order.status,
  });
  return result.order;
}
