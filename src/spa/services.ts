// RestaurantOS business core — runs entirely in the browser.
// Manual actions AND the simulation engine share these exact functions.
import { db, getSetting, nowIso } from "./db";

export class ServiceError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

// ---------- auth (PBKDF-free demo auth: salted SHA-256 via Web Crypto) ----------
export const ALL_PERMISSIONS = [
  "dashboard.view", "pos.use", "orders.manage", "kitchen.use", "tables.manage", "menu.edit",
  "recipes.edit", "inventory.manage", "purchasing.manage", "customers.manage", "reservations.manage",
  "employees.manage", "finance.manage", "reports.view", "simulation.control", "settings.edit", "audit.view",
];

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(digest);
}

export async function verifyUser(email: string, password: string) {
  const user = await db.users.where("email").equals(email.toLowerCase().trim()).first();
  if (!user || !user.active) throw new ServiceError("Invalid email or password.", 401);
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) throw new ServiceError("Invalid email or password.", 401);
  const role = await db.roles.get(user.roleId);
  return {
    id: user.id, name: user.name, email: user.email,
    roleName: role?.name ?? "User", permissions: role?.permissions ?? [],
  };
}

export function hasPerm(user: { permissions: string[] } | null | undefined, perm: string) {
  if (!user) return false;
  return user.permissions.includes("*") || user.permissions.includes(perm);
}

// ---------- audit ----------
export async function audit(actor: { name?: string } | null, action: string, entity: string, entityId: number | null, details: Record<string, unknown> = {}) {
  try {
    await db.auditLogs.add({ userName: actor?.name ?? "system", action, entity, entityId, details, createdAt: nowIso() });
  } catch { /* audit must never break business flow */ }
}

// ---------- pricing ----------
const TX_TABLES = () => [db.orders, db.orderItems, db.restaurantTables, db.products, db.modifiers, db.recipes, db.recipeIngredients, db.ingredients, db.stockMovements, db.payments, db.refunds, db.customers];

export interface OrderItemInput { productId: number; quantity: number; modifierIds?: number[]; instructions?: string }
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

async function generateOrderNumber(): Promise<string> {
  const c = await db.orders.count();
  const rand = Math.floor(100 + Math.random() * 900);
  return `ROS-${1000 + c + 1}-${rand}`;
}

export async function createOrder(actorName: string, input: CreateOrderInput) {
  if (!input.items.length) throw new ServiceError("An order needs at least one item.");
  return db.transaction("rw", [db.orders, db.orderItems, db.restaurantTables, db.products, db.modifiers], async () => {
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const prods = await db.products.where("id").anyOf(productIds).toArray();
    const prodMap = new Map(prods.map((p) => [p.id, p]));
    const mods = await db.modifiers.where("productId").anyOf(productIds).toArray();
    const modsById = new Map(mods.map((m) => [m.id, m]));

    let subtotal = 0, tax = 0;
    const priced = input.items.map((item) => {
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
      const line = unit * item.quantity;
      subtotal += line;
      tax += Math.round((line * p.taxRateBp) / 10000);
      return {
        productId: p.id, productName: p.name, quantity: item.quantity,
        unitPriceCents: unit, taxRateBp: p.taxRateBp, modifiers: selectedMods,
        instructions: (item.instructions ?? "").slice(0, 200),
      };
    });

    let tableId: number | null = null;
    if (input.type === "dine_in") {
      if (!input.tableId) throw new ServiceError("Dine-in orders require a table.");
      const t = await db.restaurantTables.get(input.tableId);
      if (!t || !t.active) throw new ServiceError("Selected table does not exist.");
      if (t.status === "occupied" || t.status === "cleaning") {
        throw new ServiceError(`Table ${t.name} is ${t.status}. Choose another table.`, 409);
      }
      tableId = t.id;
      await db.restaurantTables.update(t.id, { status: "occupied" });
    }

    const discount = Math.min(Math.max(0, input.discountCents ?? 0), subtotal);
    const total = Math.max(0, subtotal - discount) + tax;
    const id = (await db.orders.add({
      orderNumber: await generateOrderNumber(),
      type: input.type,
      status: input.autoConfirm ? "confirmed" : "pending",
      tableId, customerId: input.customerId ?? null,
      subtotalCents: subtotal, taxCents: tax, discountCents: discount, totalCents: total,
      cogsCents: 0, inventoryDeducted: false,
      source: input.source ?? "manual", simulationSessionId: input.simulationSessionId ?? null,
      notes: (input.notes ?? "").slice(0, 300),
      createdAt: nowIso(), updatedAt: nowIso(), completedAt: null,
    })) as number;
    await db.orderItems.bulkAdd(priced.map((p) => ({ ...p, orderId: id })));
    const order = await db.orders.get(id);
    queueMicrotask(() => audit({ name: actorName }, "create", "order", id, { orderNumber: order!.orderNumber, totalCents: total }));
    return order!;
  });
}

async function computeRequirements(orderId: number) {
  const items = await db.orderItems.where("orderId").equals(orderId).toArray();
  const productIds = [...new Set(items.filter((i) => i.productId).map((i) => i.productId as number))];
  if (!productIds.length) return new Map<number, number>();
  const recs = await db.recipes.where("productId").anyOf(productIds).toArray();
  const recByProduct = new Map(recs.map((r) => [r.productId, r.id]));
  const ris = await db.recipeIngredients.where("recipeId").anyOf(recs.map((r) => r.id)).toArray();
  const riByRecipe = new Map<number, any[]>();
  for (const ri of ris) {
    const arr = riByRecipe.get(ri.recipeId) ?? [];
    arr.push(ri);
    riByRecipe.set(ri.recipeId, arr);
  }
  const required = new Map<number, number>();
  for (const item of items) {
    const recId = recByProduct.get(item.productId);
    if (!recId) continue;
    for (const ri of riByRecipe.get(recId) ?? []) {
      required.set(ri.ingredientId, (required.get(ri.ingredientId) ?? 0) + ri.quantity * item.quantity);
    }
  }
  return required;
}

const NEXT: Record<string, Record<string, string>> = {
  pending: { confirm: "confirmed", cancel: "cancelled" },
  confirmed: { start_prepare: "preparing", cancel: "cancelled" },
  preparing: { ready: "ready", cancel: "cancelled" },
  ready: { serve: "served", complete: "completed", cancel: "cancelled" },
  served: { complete: "completed" },
};

export async function transitionOrder(actorName: string, orderId: number, action: string, payload: { paymentMethod?: string; reason?: string } = {}) {
  const allowNegative = getSetting("allowNegativeStock") === "true";
  return db.transaction("rw", TX_TABLES(), async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new ServiceError("Order not found.", 404);

    if (action === "refund") {
      if (order.status !== "completed") throw new ServiceError("Only completed orders can be refunded.");
      const existingRefund = await db.refunds.where("orderId").equals(orderId).first();
      if (existingRefund) throw new ServiceError("This order has already been refunded.", 409);
      if (order.inventoryDeducted) {
        const moves = await db.stockMovements.where("[referenceType+referenceId]").equals(["order", orderId]).toArray();
        for (const m of moves.filter((x) => x.type === "consumption")) {
          const ing = await db.ingredients.get(m.ingredientId);
          if (!ing) continue;
          await db.ingredients.update(ing.id, { stockQty: Math.round((ing.stockQty + m.quantity) * 1000) / 1000 });
          await db.stockMovements.add({
            ingredientId: m.ingredientId, type: "refund_restore", quantity: m.quantity,
            unitCostCents: m.unitCostCents ?? null, referenceType: "order", referenceId: orderId,
            source: "manual", note: "Restored on refund", createdAt: nowIso(),
          });
        }
      }
      await db.refunds.add({
        orderId, amountCents: order.totalCents, reason: payload.reason ?? "Customer refund",
        inventoryRestored: !!order.inventoryDeducted, createdAt: nowIso(),
      });
      await db.orders.update(orderId, { status: "cancelled", updatedAt: nowIso() });
      queueMicrotask(() => audit({ name: actorName }, "refund", "order", orderId, { amountCents: order.totalCents }));
      return { ...(await db.orders.get(orderId)) };
    }

    const target = NEXT[order.status]?.[action];
    if (!target) throw new ServiceError(`Cannot ${action.replace("_", " ")} an order with status "${order.status}".`, 409);

    const patch: Record<string, unknown> = { status: target, updatedAt: nowIso() };

    if (target === "completed" && !order.inventoryDeducted) {
      const required = await computeRequirements(orderId);
      let cogs = 0;
      for (const [ingredientId, qty] of required) {
        const ing = await db.ingredients.get(ingredientId);
        if (!ing) continue;
        const next = Math.round((ing.stockQty - qty) * 1000) / 1000;
        if (next < 0 && !allowNegative) {
          throw new ServiceError(`Insufficient stock for "${ing.name}": need ${qty} ${ing.unit}, only ${ing.stockQty} ${ing.unit} available.`, 422);
        }
        cogs += Math.round(qty * ing.unitCostCents);
        await db.ingredients.update(ingredientId, { stockQty: next });
        await db.stockMovements.add({
          ingredientId, type: "consumption", quantity: qty, unitCostCents: ing.unitCostCents,
          referenceType: "order", referenceId: orderId, source: order.source, note: "Order consumption", createdAt: nowIso(),
        });
      }
      patch.inventoryDeducted = true;
      patch.cogsCents = cogs;
    }

    if (target === "completed") {
      patch.completedAt = nowIso();
      const existingPayment = await db.payments.where("orderId").equals(orderId).first();
      if (!existingPayment) {
        await db.payments.add({ orderId, amountCents: order.totalCents, method: payload.paymentMethod ?? "cash", createdAt: nowIso() });
      }
      if (order.customerId) {
        const c = await db.customers.get(order.customerId);
        if (c) {
          await db.customers.update(c.id, {
            visits: c.visits + 1,
            totalSpentCents: c.totalSpentCents + order.totalCents,
            loyaltyPoints: c.loyaltyPoints + Math.floor(order.totalCents / 1000),
          });
        }
      }
    }

    await db.orders.update(orderId, patch);

    // free table when no active orders remain on it
    if ((target === "completed" || target === "cancelled") && order.tableId) {
      const active = await db.orders.where("tableId").equals(order.tableId)
        .filter((o) => ["pending", "confirmed", "preparing", "ready", "served"].includes(o.status)).count();
      if (!active) {
        await db.restaurantTables.update(order.tableId, { status: target === "completed" ? "cleaning" : "available" });
      }
    }
    queueMicrotask(() => audit({ name: actorName }, action, "order", orderId, { to: target }));
    return { ...order, ...patch };
  });
}
