// Local dispatcher: the app's UI calls apiFetch("/api/...") exactly as if a
// backend existed — but every request is resolved in-browser against IndexedDB.
import { db, getSettings, saveSettings, getSetting, nowIso, SESSION_KEY } from "./db";
import {
  ServiceError, createOrder, transitionOrder, verifyUser, hasPerm, audit,
} from "./services";
import { seedIfEmpty } from "./seed";
import { engine } from "./engine";
import { dayKey, resolveRange } from "@/lib/ranges";

let booted = false;
export async function ensureBooted() {
  if (!booted) {
    booted = true;
    await seedIfEmpty();
  }
}

// ---------- session ----------
function sessionEmail(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

export async function currentUser() {
  const email = sessionEmail();
  if (!email) return null;
  const user = await db.users.where("email").equals(email).first();
  if (!user || !user.active) return null;
  const role = await db.roles.get(user.roleId);
  return { id: user.id, name: user.name, email: user.email, roleName: role?.name ?? "User", permissions: role?.permissions ?? [] };
}

async function requireAuth(perm?: string) {
  const u = await currentUser();
  if (!u) throw new ServiceError("You must be signed in to perform this action.", 401);
  if (perm && !hasPerm(u, perm)) throw new ServiceError(`Your role (${u.roleName}) is not allowed to perform this action.`, 403);
  return u;
}

// ---------- helpers ----------
const OPEN_STATUSES = ["pending", "confirmed", "preparing", "ready", "served"];
const inRange = (isoStr: string | null, from: Date, to: Date) => {
  if (!isoStr) return false;
  const t = new Date(isoStr).getTime();
  return t >= from.getTime() && t <= to.getTime();
};
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

function segmentOf(c: any) {
  if (c.visits >= 8 || c.totalSpentCents >= 40000) return "vip";
  if (c.visits >= 3 || c.totalSpentCents >= 12000) return "regular";
  return "new";
}

// ---------- dashboard ----------
async function dashboard(sp: URLSearchParams) {
  const { from, to, label } = resolveRange(sp);
  const orders = await db.orders.toArray();
  const completed = orders.filter((o) => o.status === "completed" && inRange(o.completedAt, from, to));
  const refundRows = (await db.refunds.toArray()).filter((r) => inRange(r.createdAt, from, to));
  const expenses = (await db.expenses.toArray()).filter((e) => inRange(e.incurredAt, from, to));
  const refundTotal = sum(refundRows.map((r) => r.amountCents));
  const revenue = sum(completed.map((o) => o.totalCents)) - refundTotal;
  const cogs = sum(completed.map((o) => o.cogsCents));
  const grossProfit = revenue - cogs;
  const expenseTotal = sum(expenses.map((e) => e.amountCents));

  const trendMap = new Map<string, { revenue: number; orders: number }>();
  for (const o of completed) {
    const k = dayKey(new Date(o.completedAt));
    const cur = trendMap.get(k) ?? { revenue: 0, orders: 0 };
    cur.revenue += o.totalCents; cur.orders += 1;
    trendMap.set(k, cur);
  }
  const trend = [...trendMap.entries()].sort().map(([date, v]) => ({ date, ...v }));

  const items = await db.orderItems.where("orderId").anyOf(completed.map((o) => o.id)).toArray();
  const byProduct = new Map<string, { qty: number; revenue: number }>();
  for (const it of items) {
    const cur = byProduct.get(it.productName) ?? { qty: 0, revenue: 0 };
    cur.qty += it.quantity; cur.revenue += it.quantity * it.unitPriceCents;
    byProduct.set(it.productName, cur);
  }
  const topItems = [...byProduct.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 6);

  const statusDist: Record<string, number> = {};
  for (const o of orders) statusDist[o.status] = (statusDist[o.status] ?? 0) + 1;

  const payments = (await db.payments.orderBy("id").reverse().limit(8).toArray());
  const recentTransactions = await Promise.all(payments.map(async (p) => {
    const o = await db.orders.get(p.orderId);
    return { id: p.id, orderNumber: o?.orderNumber ?? "—", amountCents: p.amountCents, method: p.method, createdAt: p.createdAt, source: o?.source ?? "manual" };
  }));

  const customers = await db.customers.toArray();
  const customersNew = customers.filter((c) => inRange(c.createdAt, from, to)).length;

  const ingredients = (await db.ingredients.toArray()).filter((i) => i.active);
  const lowStock = ingredients.filter((i) => i.stockQty <= i.minStock)
    .map((i) => ({ id: i.id, name: i.name, stockQty: i.stockQty, minStock: i.minStock, unit: i.unit }));
  const valuation = sum(ingredients.map((i) => Math.round(i.stockQty * i.unitCostCents)));

  const recentOrders = await Promise.all(
    (await db.orders.orderBy("id").reverse().limit(10).toArray()).map(async (o) => ({
      id: o.id, orderNumber: o.orderNumber, type: o.type, status: o.status,
      totalCents: o.totalCents, source: o.source, createdAt: o.createdAt,
      customerName: o.customerId ? (await db.customers.get(o.customerId))?.name ?? null : null,
    })),
  );

  const simEvents = await db.simEvents.orderBy("id").reverse().limit(6).toArray();

  return {
    rangeLabel: label,
    kpis: {
      revenue, orderCount: completed.length,
      avgOrderValue: completed.length ? Math.round(revenue / completed.length) : 0,
      cogs, grossProfit, expenses: expenseTotal, netProfit: grossProfit - expenseTotal,
      taxCollected: sum(completed.map((o) => o.taxCents)),
      discounts: sum(completed.map((o) => o.discountCents)),
      refunds: refundTotal, inventoryValuation: valuation,
    },
    trend, topItems, statusDist, recentTransactions, recentOrders, lowStock,
    customers: { new: customersNew, total: customers.length },
    sim: { status: engine.status, stats: engine.stats, sessionId: engine.sessionId, events: simEvents },
  };
}

// ---------- reports ----------
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

const usd = (cents: number) => (cents / 100).toFixed(2);

async function report(sp: URLSearchParams) {
  const type = sp.get("type") ?? "sales";
  const { from, to, label } = resolveRange(sp);
  let title = type;
  let rows: Record<string, unknown>[] = [];
  const orders = await db.orders.toArray();
  const completed = orders.filter((o) => o.status === "completed" && inRange(o.completedAt, from, to));

  if (type === "sales") {
    title = "Daily Sales";
    const byDay = new Map<string, any>();
    for (const o of completed) {
      const k = dayKey(new Date(o.completedAt));
      const cur = byDay.get(k) ?? { revenue: 0, orders: 0, tax: 0, cogs: 0, discounts: 0 };
      cur.revenue += o.totalCents; cur.orders++; cur.tax += o.taxCents; cur.cogs += o.cogsCents; cur.discounts += o.discountCents;
      byDay.set(k, cur);
    }
    rows = [...byDay.entries()].sort().map(([date, v]) => ({
      date, orders: v.orders, revenue_usd: usd(v.revenue), tax_usd: usd(v.tax),
      discounts_usd: usd(v.discounts), cogs_usd: usd(v.cogs), gross_profit_usd: usd(v.revenue - v.cogs),
    }));
  } else if (type === "products" || type === "categories") {
    const items = await db.orderItems.where("orderId").anyOf(completed.map((o) => o.id)).toArray();
    const byKey = new Map<string, { qty: number; revenue: number }>();
    for (const it of items) {
      let key = it.productName;
      if (type === "categories") {
        const p = it.productId ? await db.products.get(it.productId) : null;
        const c = p?.categoryId ? await db.categories.get(p.categoryId) : null;
        key = c?.name ?? "Uncategorised";
      }
      const cur = byKey.get(key) ?? { qty: 0, revenue: 0 };
      cur.qty += it.quantity; cur.revenue += it.quantity * it.unitPriceCents;
      byKey.set(key, cur);
    }
    const col = type === "products" ? "product" : "category";
    title = type === "products" ? "Product Performance" : "Category Performance";
    rows = [...byKey.entries()].map(([k, v]) => ({ [col]: k, qty: v.qty, revenue_usd: usd(v.revenue) }))
      .sort((a: any, b: any) => Number(b.revenue_usd) - Number(a.revenue_usd));
  } else if (type === "inventory" || type === "wastage") {
    const moves = (await db.stockMovements.toArray()).filter((m) =>
      inRange(m.createdAt, from, to) && m.type === (type === "inventory" ? "consumption" : "waste"));
    if (type === "inventory") {
      title = "Inventory Consumption";
      const byIng = new Map<number, number>();
      for (const m of moves) byIng.set(m.ingredientId, (byIng.get(m.ingredientId) ?? 0) + m.quantity);
      rows = [];
      for (const [ingId, qty] of byIng) {
        const ing = await db.ingredients.get(ingId);
        rows.push({ ingredient: ing?.name ?? `#${ingId}`, consumed: Math.round(qty * 100) / 100, unit: ing?.unit ?? "" });
      }
      rows.sort((a: any, b: any) => b.consumed - a.consumed);
    } else {
      title = "Wastage";
      rows = [];
      for (const m of moves.sort((a, b) => b.id - a.id)) {
        const ing = await db.ingredients.get(m.ingredientId);
        rows.push({
          ingredient: ing?.name ?? "—", unit: ing?.unit ?? "", quantity: m.quantity, note: m.note,
          when: new Date(m.createdAt).toLocaleString(), cost_usd: usd(Math.round(m.quantity * (m.unitCostCents ?? 0))),
        });
      }
    }
  } else if (type === "purchases") {
    title = "Supplier Purchases";
    const pos = (await db.purchaseOrders.toArray()).filter((p) => inRange(p.createdAt, from, to)).sort((a, b) => b.id - a.id);
    rows = await Promise.all(pos.map(async (p) => ({
      po: p.id, supplier: (await db.suppliers.get(p.supplierId))?.name ?? "—", status: p.status,
      total_usd: usd(p.totalCostCents), created: p.createdAt.slice(0, 10),
    })));
  } else if (type === "customers") {
    title = "Customer Activity";
    rows = (await db.customers.orderBy("totalSpentCents").reverse().limit(100).toArray()).map((c) => ({
      customer: c.name, visits: c.visits, spent_usd: usd(c.totalSpentCents),
      loyalty_points: c.loyaltyPoints, virtual: c.isVirtual ? "yes" : "no",
    }));
  } else if (type === "employees") {
    title = "Employee Activity";
    const emps = await db.employees.toArray();
    rows = await Promise.all(emps.map(async (e) => {
      const att = await db.attendance.where("employeeId").equals(e.id).toArray();
      const inR = att.filter((a) => a.workDate >= dayKey(from) && a.workDate <= dayKey(to));
      return {
        employee: e.name, position: e.position,
        present_days: inR.filter((a) => a.status === "present").length,
        late_days: inR.filter((a) => a.status === "late").length,
        absent_days: inR.filter((a) => a.status === "absent").length,
      };
    }));
  } else if (type === "profit") {
    title = "Profit & Loss";
    const revenue = sum(completed.map((o) => o.totalCents));
    const cogs = sum(completed.map((o) => o.cogsCents));
    const exps = (await db.expenses.toArray()).filter((e) => inRange(e.incurredAt, from, to));
    const refunds = sum((await db.refunds.toArray()).filter((r) => inRange(r.createdAt, from, to)).map((r) => r.amountCents));
    const byCat = new Map<string, number>();
    for (const e of exps) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountCents);
    rows = [
      { line: "Revenue (net sales)", amount_usd: usd(revenue) },
      { line: "Refunds", amount_usd: usd(-refunds) },
      { line: "Cost of goods sold", amount_usd: usd(-cogs) },
      { line: "Gross profit", amount_usd: usd(revenue - refunds - cogs) },
      ...[...byCat.entries()].map(([cat, amt]) => ({ line: `Expense: ${cat}`, amount_usd: usd(-amt) })),
      { line: "Net profit", amount_usd: usd(revenue - refunds - cogs - sum(exps.map((e) => e.amountCents))) },
    ];
  } else if (type === "tax") {
    title = "Tax Summary";
    const items = await db.orderItems.where("orderId").anyOf(completed.map((o) => o.id)).toArray();
    const byRate = new Map<number, { taxable: number; tax: number }>();
    for (const it of items) {
      const cur = byRate.get(it.taxRateBp) ?? { taxable: 0, tax: 0 };
      const line = it.quantity * it.unitPriceCents;
      cur.taxable += line; cur.tax += Math.round((line * it.taxRateBp) / 10000);
      byRate.set(it.taxRateBp, cur);
    }
    rows = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([bp, v]) => ({
      tax_rate_pct: bp / 100, taxable_usd: usd(v.taxable), tax_usd: usd(v.tax),
    }));
  } else {
    throw new ServiceError("Unknown report type.");
  }
  return { title, rangeLabel: label, rows };
}

// ---------- dispatcher ----------
export async function apiDispatch(path: string, method = "GET", body?: any): Promise<any> {
  await ensureBooted();
  const url = new URL(`http://local${path}`);
  const p = url.pathname;
  const sp = url.searchParams;
  const seg = p.split("/").filter(Boolean);

  try {
    // ----- auth -----
    if (p === "/api/auth/login" && method === "POST") {
      const user = await verifyUser(String(body?.email ?? ""), String(body?.password ?? ""));
      localStorage.setItem(SESSION_KEY, user.email);
      await audit({ name: user.name }, "login", "user", user.id);
      return { user };
    }
    if (p === "/api/auth/logout" && method === "POST") {
      localStorage.removeItem(SESSION_KEY);
      return { ok: true };
    }
    if (p === "/api/auth/me" && method === "GET") {
      const user = await currentUser();
      if (!user) throw new ServiceError("Not authenticated.", 401);
      return { user, settings: getSettings() };
    }

    // ----- settings -----
    if (p === "/api/settings" && method === "GET") {
      await requireAuth();
      return { settings: getSettings(), editableKeys: Object.keys(getSettings()) };
    }
    if (p === "/api/settings" && method === "PUT") {
      const user = await requireAuth("settings.edit");
      if (body.ownerEmail !== undefined && body.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.ownerEmail)) {
        throw new ServiceError("Please provide a valid email address.");
      }
      if (body.displayName !== undefined && !String(body.displayName).trim()) {
        throw new ServiceError("Display name cannot be empty.");
      }
      saveSettings(body);
      await audit(user, "update", "settings", null, body);
      return { settings: getSettings() };
    }

    // ----- dashboard -----
    if (p === "/api/dashboard") {
      await requireAuth();
      return await dashboard(sp);
    }

    // ----- orders -----
    if (p === "/api/orders" && method === "GET") {
      await requireAuth();
      const { from, to } = resolveRange(sp);
      const status = sp.get("status");
      const source = sp.get("source");
      const open = sp.get("open") === "true";
      const limit = Math.min(200, Number(sp.get("limit") ?? 100));
      let rows = (await db.orders.orderBy("id").reverse().toArray());
      rows = open
        ? rows.filter((o) => OPEN_STATUSES.includes(o.status))
        : rows.filter((o) => inRange(o.createdAt, from, to));
      if (status) rows = rows.filter((o) => o.status === status);
      if (source) rows = rows.filter((o) => o.source === source);
      rows = rows.slice(0, limit);
      const out = await Promise.all(rows.map(async (o) => ({
        order: o,
        tableName: o.tableId ? (await db.restaurantTables.get(o.tableId))?.name ?? null : null,
        customerName: o.customerId ? (await db.customers.get(o.customerId))?.name ?? null : null,
        itemCount: await db.orderItems.where("orderId").equals(o.id).count(),
      })));
      return { orders: out };
    }
    if (p === "/api/orders" && method === "POST") {
      const user = await requireAuth("pos.use");
      if (!["dine_in", "takeaway", "delivery"].includes(body.type)) throw new ServiceError("Invalid order type.");
      const order = await createOrder(user.name, body);
      return { order };
    }
    if (seg[1] === "orders" && seg.length === 3) {
      const id = Number(seg[2]);
      if (method === "GET") {
        await requireAuth();
        const order = await db.orders.get(id);
        if (!order) throw new ServiceError("Order not found.", 404);
        return {
          order, items: await db.orderItems.where("orderId").equals(id).toArray(),
          payment: (await db.payments.where("orderId").equals(id).first()) ?? null,
          refunds: await db.refunds.where("orderId").equals(id).toArray(),
          tableName: order.tableId ? (await db.restaurantTables.get(order.tableId))?.name ?? null : null,
          customerName: order.customerId ? (await db.customers.get(order.customerId))?.name ?? null : null,
        };
      }
      if (method === "PATCH") {
        const user = await requireAuth();
        const action = String(body.action);
        if (!["confirm", "start_prepare", "ready", "serve", "complete", "cancel", "refund"].includes(action)) {
          throw new ServiceError("Invalid order action.");
        }
        const order = await transitionOrder(user.name, id, action, body);
        return { order };
      }
    }

    // ----- tables -----
    if (p === "/api/tables" && method === "GET") {
      await requireAuth();
      const tables = await db.restaurantTables.orderBy("name").toArray();
      const rows = await Promise.all(tables.map(async (t) => {
        const active = (await db.orders.where("tableId").equals(t.id)
          .filter((o) => OPEN_STATUSES.includes(o.status)).toArray()).sort((a, b) => a.id - b.id)[0];
        return {
          table: t,
          activeOrderId: active?.id ?? null, activeOrderNumber: active?.orderNumber ?? null,
          activeOrderTotal: active?.totalCents ?? null, activeOrderStatus: active?.status ?? null,
          activeOrderCreatedAt: active?.createdAt ?? null,
        };
      }));
      return { tables: rows };
    }
    if (p === "/api/tables" && method === "POST") {
      const user = await requireAuth("tables.manage");
      if (!body.name?.trim()) throw new ServiceError("Table name is required.");
      if (!(body.capacity > 0 && body.capacity <= 20)) throw new ServiceError("Capacity must be between 1 and 20.");
      const exists = await db.restaurantTables.where("name").equals(body.name.trim()).first();
      if (exists) throw new ServiceError("A table with that name already exists.", 409);
      const id = await db.restaurantTables.add({
        name: body.name.trim(), capacity: Math.round(body.capacity), status: "available", note: "",
        posX: Number(body.posX ?? 0), posY: Number(body.posY ?? 0), branchId: 1, active: true,
      });
      await audit(user, "create", "table", id as number, { name: body.name });
      return { table: await db.restaurantTables.get(id as number) };
    }
    if (p === "/api/tables" && method === "PATCH") {
      const user = await requireAuth("tables.manage");
      const id = Number(body.id);
      const t = await db.restaurantTables.get(id);
      if (!t) throw new ServiceError("Table not found.", 404);
      const action = String(body.action ?? "update");
      if (action === "status") {
        if (!["available", "occupied", "reserved", "cleaning"].includes(body.status)) throw new ServiceError("Invalid status.");
        await db.restaurantTables.update(id, { status: body.status, ...(body.status === "available" ? { note: "" } : {}) });
        await audit(user, "status", "table", id, { status: body.status });
        return { table: await db.restaurantTables.get(id) };
      }
      if (action === "transfer") {
        const toId = Number(body.toTableId);
        const to = await db.restaurantTables.get(toId);
        if (!to) throw new ServiceError("Table not found.", 404);
        if (to.status !== "available") throw new ServiceError(`Table ${to.name} is not available.`, 409);
        await db.transaction("rw", [db.orders, db.restaurantTables], async () => {
          await db.orders.where("tableId").equals(id)
            .filter((o) => OPEN_STATUSES.includes(o.status)).modify({ tableId: toId, updatedAt: nowIso() });
          await db.restaurantTables.update(toId, { status: "occupied" });
          await db.restaurantTables.update(id, { status: "available" });
        });
        await audit(user, "transfer", "table", id, { toTableId: toId });
        return { ok: true };
      }
      if (action === "combine" || action === "separate") {
        const ids: number[] = body.tableIds ?? [id];
        if (action === "combine") {
          const list = await db.restaurantTables.where("id").anyOf(ids).toArray();
          for (const tb of list) if (tb.status !== "available") throw new ServiceError(`Table ${tb.name} is not available to combine.`, 409);
          const label = `Combined: ${list.map((n) => n.name).join(" + ")}${body.partySize ? ` (party of ${body.partySize})` : ""}`;
          await db.restaurantTables.where("id").anyOf(ids).modify({ status: "reserved", note: label });
        } else {
          await db.restaurantTables.where("id").anyOf(ids).modify({ status: "available", note: "" });
        }
        await audit(user, action, "table", ids[0], { tableIds: ids });
        return { ok: true };
      }
      await db.restaurantTables.update(id, {
        ...(body.name !== undefined && { name: String(body.name).trim() }),
        ...(body.capacity !== undefined && { capacity: Math.round(body.capacity) }),
        ...(body.active !== undefined && { active: Boolean(body.active) }),
      });
      return { table: await db.restaurantTables.get(id) };
    }

    // ----- menu -----
    if (seg[1] === "menu" && seg.length === 3) {
      const entity = seg[2];
      const id = Number(sp.get("id"));
      if (method === "GET") {
        await requireAuth();
        if (entity === "categories") return { categories: await db.categories.orderBy("sortOrder").toArray() };
        if (entity === "modifiers") return { modifiers: await db.modifiers.toArray() };
        const products = await db.products.orderBy("name").toArray();
        const out = await Promise.all(products.map(async (pr) => ({
          product: pr, categoryName: pr.categoryId ? (await db.categories.get(pr.categoryId))?.name ?? null : null,
        })));
        return { products: out };
      }
      const user = await requireAuth("menu.edit");
      if (method === "POST") {
        if (entity === "categories") {
          if (!body.name?.trim()) throw new ServiceError("Category name is required.");
          const newId = await db.categories.add({ name: body.name.trim(), sortOrder: Number(body.sortOrder ?? 0), active: body.active !== false });
          await audit(user, "create", "category", newId as number, {});
          return { category: await db.categories.get(newId as number) };
        }
        if (entity === "modifiers") {
          if (!body.productId || !body.name?.trim()) throw new ServiceError("Modifier needs a product and a name.");
          const newId = await db.modifiers.add({ productId: body.productId, name: body.name.trim(), priceDeltaCents: Math.round(body.priceDeltaCents ?? 0) });
          return { modifier: await db.modifiers.get(newId as number) };
        }
        if (!body.name?.trim()) throw new ServiceError("Product name is required.");
        if (!(body.priceCents > 0)) throw new ServiceError("Product price must be greater than zero.");
        const newId = await db.products.add({
          name: body.name.trim(), description: String(body.description ?? ""), categoryId: body.categoryId ?? null,
          priceCents: Math.round(body.priceCents), taxRateBp: Math.max(0, Math.min(30000, Math.round(body.taxRateBp ?? 850))),
          sku: null, color: body.color ?? "amber", available: body.available !== false, branchId: 1,
          createdAt: nowIso(), updatedAt: nowIso(),
        });
        await audit(user, "create", "product", newId as number, { name: body.name });
        return { product: await db.products.get(newId as number) };
      }
      if (method === "PATCH") {
        if (entity === "categories") {
          await db.categories.update(id, {
            ...(body.name !== undefined && { name: String(body.name).trim() }),
            ...(body.sortOrder !== undefined && { sortOrder: Number(body.sortOrder) }),
            ...(body.active !== undefined && { active: Boolean(body.active) }),
          });
          return { category: await db.categories.get(id) };
        }
        if (entity === "modifiers") {
          await db.modifiers.update(id, {
            ...(body.name !== undefined && { name: String(body.name).trim() }),
            ...(body.priceDeltaCents !== undefined && { priceDeltaCents: Math.round(body.priceDeltaCents) }),
          });
          return { modifier: await db.modifiers.get(id) };
        }
        await db.products.update(id, {
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.description !== undefined && { description: String(body.description) }),
          ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
          ...(body.priceCents !== undefined && { priceCents: Math.round(body.priceCents) }),
          ...(body.taxRateBp !== undefined && { taxRateBp: Math.round(body.taxRateBp) }),
          ...(body.available !== undefined && { available: Boolean(body.available) }),
          ...(body.color !== undefined && { color: String(body.color) }),
          updatedAt: nowIso(),
        });
        await audit(user, "update", "product", id, body);
        return { product: await db.products.get(id) };
      }
      if (method === "DELETE") {
        if (entity === "products") { await db.products.delete(id); await db.modifiers.where("productId").equals(id).delete(); }
        else if (entity === "modifiers") await db.modifiers.delete(id);
        else { await db.products.where("categoryId").equals(id).modify({ categoryId: null }); await db.categories.delete(id); }
        await audit(user, "delete", entity, id);
        return { ok: true };
      }
    }

    // ----- recipes -----
    if (p === "/api/recipes" && method === "GET") {
      await requireAuth();
      const products = await db.products.orderBy("name").toArray();
      const recipes = await db.recipes.toArray();
      const recByProduct = new Map(recipes.map((r) => [r.productId, r]));
      const lines = await db.recipeIngredients.toArray();
      const ingredients = await db.ingredients.toArray();
      const ingById = new Map(ingredients.map((i) => [i.id, i]));
      const result = products.map((pr) => {
        const rec = recByProduct.get(pr.id);
        const recLines = lines.filter((l) => l.recipeId === rec?.id);
        const mapped = recLines.map((l) => {
          const ing = ingById.get(l.ingredientId);
          return {
            ingredientId: l.ingredientId, ingredientName: ing?.name ?? "—", unit: ing?.unit ?? "",
            quantity: l.quantity, unitCostCents: ing?.unitCostCents ?? 0,
            lineCostCents: Math.round(l.quantity * (ing?.unitCostCents ?? 0)),
          };
        });
        const costCents = sum(mapped.map((m) => m.lineCostCents));
        const grossProfitCents = pr.priceCents - costCents;
        return {
          productId: pr.id, productName: pr.name, priceCents: pr.priceCents, available: pr.available,
          recipeId: rec?.id ?? null, notes: rec?.notes ?? "",
          costCents, grossProfitCents,
          marginPct: pr.priceCents > 0 ? Math.round((grossProfitCents / pr.priceCents) * 1000) / 10 : 0,
          lines: mapped,
        };
      });
      return { recipes: result };
    }
    if (p === "/api/recipes" && method === "PUT") {
      const user = await requireAuth("recipes.edit");
      const productId = Number(body.productId);
      if (!productId) throw new ServiceError("productId is required.");
      const lines: { ingredientId: number; quantity: number }[] = body.lines ?? [];
      for (const l of lines) if (!l.ingredientId || !(l.quantity > 0)) throw new ServiceError("Each recipe line needs an ingredient and a quantity > 0.");
      const recipeId = await db.transaction("rw", [db.recipes, db.recipeIngredients], async () => {
        let rec = await db.recipes.where("productId").equals(productId).first();
        if (rec) await db.recipes.update(rec.id, { notes: String(body.notes ?? rec.notes) });
        else rec = await db.recipes.get(await db.recipes.add({ productId, notes: String(body.notes ?? "") }) as number);
        await db.recipeIngredients.where("recipeId").equals(rec!.id).delete();
        if (lines.length) {
          await db.recipeIngredients.bulkAdd(lines.map((l) => ({ recipeId: rec!.id, ingredientId: l.ingredientId, quantity: Math.round(l.quantity * 1000) / 1000 })));
        }
        return rec!.id;
      });
      await audit(user, "update", "recipe", recipeId, { productId });
      return { ok: true, recipeId };
    }

    // ----- inventory -----
    if (p === "/api/inventory" && method === "GET") {
      await requireAuth();
      const ingredients = await db.ingredients.orderBy("name").toArray();
      const moves = (await db.stockMovements.orderBy("id").reverse().limit(40).toArray());
      const movements = await Promise.all(moves.map(async (m) => {
        const ing = await db.ingredients.get(m.ingredientId);
        return { m, ingredientName: ing?.name ?? "—", unit: ing?.unit ?? "" };
      }));
      const waste = (await db.stockMovements.where("type").equals("waste").toArray());
      return {
        ingredients: ingredients.map((i) => ({ ...i, low: i.stockQty <= i.minStock })),
        movements,
        valuation: sum(ingredients.map((i) => Math.round(i.stockQty * i.unitCostCents))),
        wasteCostCents: sum(waste.map((w) => Math.round(w.quantity * (w.unitCostCents ?? 0)))),
        allowNegativeStock: getSetting("allowNegativeStock") === "true",
      };
    }
    if (p === "/api/inventory" && method === "POST") {
      const user = await requireAuth("inventory.manage");
      const action = String(body.action ?? "");
      if (action === "create") {
        if (!body.name?.trim()) throw new ServiceError("Ingredient name is required.");
        if (!["pcs", "g", "ml"].includes(body.unit)) throw new ServiceError("Unit must be pcs, g or ml.");
        const exists = await db.ingredients.where("name").equals(body.name.trim()).first();
        if (exists) throw new ServiceError("An ingredient with that name already exists.", 409);
        const id = await db.ingredients.add({
          name: body.name.trim(), unit: body.unit,
          stockQty: Math.max(0, Number(body.stockQty ?? 0)), minStock: Math.max(0, Number(body.minStock ?? 0)),
          unitCostCents: Math.max(0, Math.round(body.unitCostCents ?? 0)), active: true, expiresAt: null,
        });
        if (Number(body.stockQty ?? 0) > 0) {
          await db.stockMovements.add({
            ingredientId: id as number, type: "adjustment", quantity: Number(body.stockQty), unitCostCents: Math.round(body.unitCostCents ?? 0),
            referenceType: "manual", referenceId: null, source: "manual", note: "Opening stock", createdAt: nowIso(),
          });
        }
        await audit(user, "create", "ingredient", id as number, {});
        return { ingredient: await db.ingredients.get(id as number) };
      }
      const ingredientId = Number(body.ingredientId);
      const qty = Number(body.quantity);
      const note = String(body.note ?? "").slice(0, 200);
      const result = await db.transaction("rw", [db.ingredients, db.stockMovements], async () => {
        const ing = await db.ingredients.get(ingredientId);
        if (!ing) throw new ServiceError("Ingredient not found.", 404);
        if (action === "adjust" || action === "restock") {
          const delta = Number(body.quantity);
          const next = Math.round((ing.stockQty + delta) * 1000) / 1000;
          if (next < 0) throw new ServiceError(`Adjustment would make "${ing.name}" negative.`, 422);
          await db.ingredients.update(ingredientId, { stockQty: next });
          await db.stockMovements.add({
            ingredientId, type: "adjustment", quantity: Math.abs(delta), unitCostCents: ing.unitCostCents,
            referenceType: "manual", referenceId: null, source: "manual",
            note: `${delta >= 0 ? "+" : "-"}${Math.abs(delta)} ${ing.unit}${note ? ` — ${note}` : ""}`, createdAt: nowIso(),
          });
          return { stockQty: next };
        }
        if (action === "waste") {
          if (!(qty > 0)) throw new ServiceError("Quantity must be greater than zero.");
          const next = Math.round((ing.stockQty - qty) * 1000) / 1000;
          if (next < 0) throw new ServiceError(`Cannot waste more than the current stock of "${ing.name}".`, 422);
          await db.ingredients.update(ingredientId, { stockQty: next });
          await db.stockMovements.add({
            ingredientId, type: "waste", quantity: qty, unitCostCents: ing.unitCostCents,
            referenceType: "manual", referenceId: null, source: "manual", note: note || "Wastage recorded", createdAt: nowIso(),
          });
          return { stockQty: next };
        }
        throw new ServiceError("Unknown inventory action.");
      });
      await audit(user, action, "ingredient", ingredientId, { quantity: qty });
      return { ok: true, ...result };
    }
    if (p === "/api/inventory" && method === "PATCH") {
      const user = await requireAuth("inventory.manage");
      const id = Number(sp.get("id"));
      await db.ingredients.update(id, {
        ...(body.name !== undefined && { name: String(body.name).trim() }),
        ...(body.minStock !== undefined && { minStock: Math.max(0, Number(body.minStock)) }),
        ...(body.unitCostCents !== undefined && { unitCostCents: Math.max(0, Math.round(body.unitCostCents)) }),
        ...(body.active !== undefined && { active: Boolean(body.active) }),
      });
      await audit(user, "update", "ingredient", id, body);
      return { ingredient: await db.ingredients.get(id) };
    }

    // ----- suppliers -----
    if (p === "/api/suppliers") {
      if (method === "GET") { await requireAuth(); return { suppliers: await db.suppliers.orderBy("name").toArray() }; }
      const user = await requireAuth("purchasing.manage");
      const id = Number(sp.get("id"));
      if (method === "POST") {
        if (!body.name?.trim()) throw new ServiceError("Supplier name is required.");
        const newId = await db.suppliers.add({
          name: body.name.trim(), contactName: String(body.contactName ?? ""),
          email: String(body.email ?? ""), phone: String(body.phone ?? ""), active: true,
        });
        await audit(user, "create", "supplier", newId as number, {});
        return { supplier: await db.suppliers.get(newId as number) };
      }
      if (method === "PATCH") {
        await db.suppliers.update(id, {
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.contactName !== undefined && { contactName: String(body.contactName) }),
          ...(body.email !== undefined && { email: String(body.email) }),
          ...(body.phone !== undefined && { phone: String(body.phone) }),
          ...(body.active !== undefined && { active: Boolean(body.active) }),
        });
        return { supplier: await db.suppliers.get(id) };
      }
    }

    // ----- purchases -----
    if (p === "/api/purchases" && method === "GET") {
      await requireAuth();
      const pos = (await db.purchaseOrders.orderBy("id").reverse().toArray());
      const out = await Promise.all(pos.map(async (po) => {
        const sup = await db.suppliers.get(po.supplierId);
        const items = await db.purchaseOrderItems.where("orderId").equals(po.id).toArray();
        const joined = await Promise.all(items.map(async (it) => {
          const ing = await db.ingredients.get(it.ingredientId);
          return { item: it, ingredientName: ing?.name ?? "—", unit: ing?.unit ?? "" };
        }));
        return { ...po, supplierName: sup?.name ?? "—", items: joined };
      }));
      return { purchaseOrders: out };
    }
    if (p === "/api/purchases" && method === "POST") {
      const user = await requireAuth("purchasing.manage");
      const items: { ingredientId: number; quantity: number; unitCostCents: number }[] = body.items ?? [];
      if (!body.supplierId) throw new ServiceError("Supplier is required.");
      if (!items.length) throw new ServiceError("A purchase order needs at least one item.");
      const total = sum(items.map((i) => Math.round(i.quantity * i.unitCostCents)));
      const poId = await db.transaction("rw", [db.purchaseOrders, db.purchaseOrderItems], async () => {
        const id = await db.purchaseOrders.add({ supplierId: Number(body.supplierId), status: "draft", totalCostCents: total, createdAt: nowIso(), receivedAt: null });
        await db.purchaseOrderItems.bulkAdd(items.map((i) => ({
          orderId: id as number, ingredientId: i.ingredientId,
          quantity: Math.round(i.quantity * 1000) / 1000, unitCostCents: Math.round(i.unitCostCents), receivedQty: 0,
        })));
        return id as number;
      });
      await audit(user, "create", "purchase_order", poId, { totalCostCents: total });
      return { purchaseOrder: await db.purchaseOrders.get(poId) };
    }
    if (seg[1] === "purchases" && seg.length === 3 && method === "PATCH") {
      const user = await requireAuth("purchasing.manage");
      const id = Number(seg[2]);
      const action = String(body.action ?? "");
      const updated = await db.transaction("rw", [db.purchaseOrders, db.purchaseOrderItems, db.ingredients, db.stockMovements], async () => {
        const po = await db.purchaseOrders.get(id);
        if (!po) throw new ServiceError("Purchase order not found.", 404);
        if (action === "approve") {
          if (po.status !== "draft") throw new ServiceError("Only draft orders can be approved.", 409);
          await db.purchaseOrders.update(id, { status: "approved" });
        } else if (action === "cancel") {
          if (["received", "partially_received"].includes(po.status)) throw new ServiceError("Cannot cancel a purchase order that has received goods.", 409);
          await db.purchaseOrders.update(id, { status: "cancelled" });
        } else if (action === "receive") {
          if (!["approved", "partially_received"].includes(po.status)) throw new ServiceError("Approve the purchase order before receiving goods.", 409);
          const lines = await db.purchaseOrderItems.where("orderId").equals(id).toArray();
          const byItem = new Map<number, number>((body.received ?? []).map((r: any) => [r.itemId, r.qty]));
          for (const line of lines) {
            const qty = byItem.get(line.id);
            if (qty === undefined || qty === 0) continue;
            if (!(qty >= 0)) throw new ServiceError("Received quantity cannot be negative.");
            const newReceived = Math.round((line.receivedQty + qty) * 1000) / 1000;
            if (newReceived > line.quantity + 1e-9) throw new ServiceError("Cannot receive more than ordered.", 422);
            await db.purchaseOrderItems.update(line.id, { receivedQty: newReceived });
            const ing = await db.ingredients.get(line.ingredientId);
            if (ing) {
              await db.ingredients.update(ing.id, { stockQty: Math.round((ing.stockQty + qty) * 1000) / 1000, unitCostCents: line.unitCostCents });
              await db.stockMovements.add({
                ingredientId: ing.id, type: "purchase", quantity: qty, unitCostCents: line.unitCostCents,
                referenceType: "purchase_order", referenceId: id, source: "manual", note: `PO #${id} goods received`, createdAt: nowIso(),
              });
            }
          }
          const refreshed = await db.purchaseOrderItems.where("orderId").equals(id).toArray();
          const allIn = refreshed.every((l) => l.receivedQty >= l.quantity - 1e-9);
          const anyIn = refreshed.some((l) => l.receivedQty > 0);
          await db.purchaseOrders.update(id, {
            status: allIn ? "received" : anyIn ? "partially_received" : po.status,
            ...(allIn ? { receivedAt: nowIso() } : {}),
          });
        } else throw new ServiceError("Unknown purchase order action.");
        return db.purchaseOrders.get(id);
      });
      await audit(user, action, "purchase_order", id);
      return { purchaseOrder: updated };
    }

    // ----- customers -----
    if (p === "/api/customers") {
      const id = Number(sp.get("id"));
      if (method === "GET") {
        await requireAuth();
        if (id) {
          const c = await db.customers.get(id);
          if (!c) throw new ServiceError("Customer not found.", 404);
          const history = (await db.orders.where("customerId").equals(id).reverse().sortBy("id")).slice(-30).reverse();
          return { customer: { ...c, segment: segmentOf(c) }, history };
        }
        const all = (await db.customers.orderBy("totalSpentCents").reverse().limit(500).toArray());
        return { customers: all.map((c) => ({ ...c, segment: segmentOf(c) })) };
      }
      const user = await requireAuth("customers.manage");
      if (method === "POST") {
        if (!body.name?.trim()) throw new ServiceError("Customer name is required.");
        const newId = await db.customers.add({
          name: body.name.trim(), phone: String(body.phone ?? ""), email: String(body.email ?? ""),
          segment: "new", loyaltyPoints: 0, totalSpentCents: 0, visits: 0,
          isVirtual: Boolean(body.isVirtual ?? false), createdAt: nowIso(),
        });
        await audit(user, "create", "customer", newId as number, {});
        return { customer: await db.customers.get(newId as number) };
      }
      if (method === "PATCH") {
        await db.customers.update(id, {
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.phone !== undefined && { phone: String(body.phone) }),
          ...(body.email !== undefined && { email: String(body.email) }),
          ...(body.loyaltyPoints !== undefined && { loyaltyPoints: Math.max(0, Math.round(body.loyaltyPoints)) }),
        });
        return { customer: await db.customers.get(id) };
      }
    }

    // ----- reservations -----
    const WINDOW_MS = 2 * 60 * 60 * 1000;
    if (p === "/api/reservations" && method === "GET") {
      await requireAuth();
      const res = (await db.reservations.orderBy("reservedFor").reverse().limit(200).toArray());
      const out = await Promise.all(res.map(async (r) => ({
        r,
        tableName: (await db.restaurantTables.get(r.tableId))?.name ?? "—",
        capacity: (await db.restaurantTables.get(r.tableId))?.capacity ?? 0,
        customerName: r.customerId ? (await db.customers.get(r.customerId))?.name ?? null : null,
      })));
      return { reservations: out };
    }
    if (p === "/api/reservations" && method === "POST") {
      const user = await requireAuth("reservations.manage");
      const when = new Date(body.reservedFor);
      const partySize = Number(body.partySize);
      const tableId = Number(body.tableId);
      if (!tableId || isNaN(when.getTime())) throw new ServiceError("A table and a valid date/time are required.");
      if (!(partySize > 0 && partySize <= 20)) throw new ServiceError("Party size must be between 1 and 20.");
      const created = await db.transaction("rw", [db.reservations, db.restaurantTables], async () => {
        const table = await db.restaurantTables.get(tableId);
        if (!table) throw new ServiceError("Table not found.", 404);
        if (partySize > table.capacity) throw new ServiceError(`Table ${table.name} seats ${table.capacity} — party of ${partySize} won't fit.`, 422);
        const clash = await db.reservations.where("tableId").equals(tableId)
          .filter((r) => ["booked", "seated"].includes(r.status) &&
            Math.abs(new Date(r.reservedFor).getTime() - when.getTime()) < WINDOW_MS).first();
        if (clash) throw new ServiceError("This table already has a reservation within two hours of that time.", 409);
        const id = await db.reservations.add({
          customerId: body.customerId ?? null, customerName: String(body.customerName ?? ""),
          tableId, reservedFor: when.toISOString(), partySize, status: "booked",
          notes: String(body.notes ?? "").slice(0, 300), createdAt: nowIso(),
        });
        if (when.getTime() < Date.now() + WINDOW_MS && table.status === "available") {
          await db.restaurantTables.update(tableId, { status: "reserved" });
        }
        return id as number;
      });
      await audit(user, "create", "reservation", created);
      return { reservation: await db.reservations.get(created) };
    }
    if (p === "/api/reservations" && method === "PATCH") {
      const user = await requireAuth("reservations.manage");
      const id = Number(sp.get("id"));
      const res = await db.reservations.get(id);
      if (!res) throw new ServiceError("Reservation not found.", 404);
      const action = String(body.action ?? "");
      if (res.status !== "booked" && ["seat", "cancel", "no_show"].includes(action)) {
        throw new ServiceError(`Cannot ${action.replace("_", " ")} a reservation with status "${res.status}".`, 409);
      }
      const next = ({ seat: "seated", complete: "completed", cancel: "cancelled", no_show: "no_show" } as Record<string, string>)[action];
      if (!next) throw new ServiceError("Unknown reservation action.");
      await db.transaction("rw", [db.reservations, db.restaurantTables, db.orders], async () => {
        await db.reservations.update(id, { status: next });
        if (action === "seat") await db.restaurantTables.update(res.tableId, { status: "occupied" });
        if (["cancel", "no_show", "complete"].includes(action)) {
          const other = await db.reservations.where("tableId").equals(res.tableId)
            .filter((r) => r.id !== id && ["booked", "seated"].includes(r.status)).count();
          const openOrders = await db.orders.where("tableId").equals(res.tableId)
            .filter((o) => OPEN_STATUSES.includes(o.status)).count();
          if (!other && !openOrders) await db.restaurantTables.update(res.tableId, { status: "available", note: "" });
        }
      });
      await audit(user, action, "reservation", id);
      return { ok: true };
    }

    // ----- employees -----
    if (p === "/api/employees" && method === "GET") {
      await requireAuth();
      const emps = await db.employees.orderBy("name").toArray();
      const out = await Promise.all(emps.map(async (e) => ({
        ...e,
        roleName: e.roleId ? (await db.roles.get(e.roleId))?.name ?? null : null,
        attendance: (await db.attendance.where("employeeId").equals(e.id).reverse().sortBy("id")).slice(0, 14),
      })));
      return { employees: out, today: dayKey(new Date()), roles: await db.roles.toArray() };
    }
    if (p === "/api/employees" && method === "POST") {
      const user = await requireAuth("employees.manage");
      if (body.action === "simulate_attendance") {
        const workDate = body.workDate ?? dayKey(new Date());
        const emps = await db.employees.where("status").equals("active").toArray();
        let created = 0;
        for (const e of emps) {
          const existing = await db.attendance.where("[employeeId+workDate]").equals([e.id, workDate]).first();
          if (existing) continue;
          const r = Math.random();
          const status = r < 0.85 ? "present" : r < 0.93 ? "late" : "absent";
          const base = new Date(`${workDate}T08:00:00`);
          const checkIn = status === "absent" ? null : new Date(base.getTime() + Math.floor(Math.random() * (status === "late" ? 90 : 25)) * 60000).toISOString();
          const checkOut = checkIn ? new Date(new Date(checkIn).getTime() + (7 + Math.random() * 2) * 3600000).toISOString() : null;
          await db.attendance.add({ employeeId: e.id, workDate, checkIn, checkOut, status, source: "simulation" });
          await db.shifts.add({ employeeId: e.id, workDate, start: checkIn, end: checkOut, role: e.department });
          created++;
        }
        await audit(user, "simulate_attendance", "employee", null, { workDate, created });
        return { ok: true, created, workDate };
      }
      if (!body.name?.trim() || !body.position?.trim()) throw new ServiceError("Name and position are required.");
      const newId = await db.employees.add({
        name: body.name.trim(), position: body.position.trim(), department: String(body.department ?? "Operations"),
        roleId: body.roleId ?? null, hourlyRateCents: Math.max(0, Math.round(body.hourlyRateCents ?? 1500)),
        status: "active", isVirtual: body.isVirtual !== false, hiredAt: nowIso(),
      });
      await audit(user, "create", "employee", newId as number, {});
      return { employee: await db.employees.get(newId as number) };
    }
    if (p === "/api/employees" && method === "PATCH") {
      const user = await requireAuth("employees.manage");
      const id = Number(sp.get("id"));
      await db.employees.update(id, {
        ...(body.name !== undefined && { name: String(body.name).trim() }),
        ...(body.position !== undefined && { position: String(body.position).trim() }),
        ...(body.department !== undefined && { department: String(body.department) }),
        ...(body.roleId !== undefined && { roleId: body.roleId }),
        ...(body.hourlyRateCents !== undefined && { hourlyRateCents: Math.round(body.hourlyRateCents) }),
        ...(body.status !== undefined && { status: String(body.status) }),
      });
      await audit(user, "update", "employee", id, body);
      return { employee: await db.employees.get(id) };
    }

    // ----- expenses -----
    if (p === "/api/expenses") {
      const user = await requireAuth();
      if (method === "GET") {
        const { from, to } = resolveRange(sp);
        const rows = (await db.expenses.orderBy("incurredAt").reverse().toArray())
          .filter((e) => inRange(e.incurredAt, from, to)).slice(0, 300);
        return { expenses: rows };
      }
      if (!hasPerm(user, "finance.manage")) throw new ServiceError(`Your role (${user.roleName}) is not allowed to perform this action.`, 403);
      if (method === "POST") {
        const amountCents = Math.round(Number(body.amountCents));
        if (!(amountCents > 0)) throw new ServiceError("Amount must be greater than zero.");
        if (!body.description?.trim()) throw new ServiceError("Description is required.");
        const id = await db.expenses.add({
          category: String(body.category ?? "general"), description: body.description.trim(),
          amountCents, incurredAt: body.incurredAt ? new Date(body.incurredAt).toISOString() : nowIso(), createdAt: nowIso(),
        });
        await audit(user, "create", "expense", id as number, {});
        return { expense: await db.expenses.get(id as number) };
      }
      if (method === "DELETE") {
        const id = Number(sp.get("id"));
        await db.expenses.delete(id);
        await audit(user, "delete", "expense", id);
        return { ok: true };
      }
    }

    // ----- reports -----
    if (p === "/api/reports") {
      await requireAuth("reports.view");
      const res = await report(sp);
      if (sp.get("format") === "csv") return { text: toCsv(res.rows) };
      return res;
    }

    // ----- simulation -----
    if (seg[1] === "simulation" && seg.length === 3) {
      const action = seg[2];
      if (method === "GET") {
        await requireAuth();
        if (action === "status") { try { await (engine as any).tick?.(); } catch { } return await engine.snapshot(); }
        if (action === "logs") return { events: (await db.simEvents.orderBy("id").reverse().limit(120).toArray()) };
        if (action === "sessions") return { sessions: (await db.simSessions.orderBy("id").reverse().limit(20).toArray()) };
      }
      if (method === "POST") {
        const user = await requireAuth("simulation.control");
        if (action === "start") {
          await engine.start(["assisted", "automatic", "stress"].includes(body?.mode) ? body.mode : "automatic", {
            speed: Number(body.speed ?? engine.config.speed) || 1,
            arrivalSec: Number(body.arrivalSec ?? engine.config.arrivalSec) || 12,
            minItems: Number(body.minItems ?? engine.config.minItems) || 1,
            maxItems: Number(body.maxItems ?? engine.config.maxItems) || 4,
            operatingStart: Number(body.operatingStart ?? engine.config.operatingStart),
            operatingEnd: Number(body.operatingEnd ?? engine.config.operatingEnd),
          });
        } else if (action === "pause") await engine.pause();
        else if (action === "resume") await engine.resume();
        else if (action === "stop") await engine.stop();
        else if (action === "reset") {
          const summary = await engine.reset();
          await audit(user, "reset", "simulation", null, summary);
          return { snapshot: await engine.snapshot(), summary };
        } else if (action === "config") {
          await engine.updateConfig({
            ...(body.speed !== undefined && { speed: Number(body.speed) || 1 }),
            ...(body.arrivalSec !== undefined && { arrivalSec: Number(body.arrivalSec) || 12 }),
            ...(body.minItems !== undefined && { minItems: Math.max(1, Number(body.minItems) || 1) }),
            ...(body.maxItems !== undefined && { maxItems: Math.max(1, Number(body.maxItems) || 4) }),
            ...(body.operatingStart !== undefined && { operatingStart: Number(body.operatingStart) }),
            ...(body.operatingEnd !== undefined && { operatingEnd: Number(body.operatingEnd) }),
          });
        } else throw new ServiceError("Unknown simulation action.", 404);
        await audit(user, action, "simulation", engine.sessionId);
        return await engine.snapshot();
      }
    }

    // ----- audit -----
    if (p === "/api/audit") {
      await requireAuth("audit.view");
      return { logs: (await db.auditLogs.orderBy("id").reverse().limit(120).toArray()) };
    }

    // ----- health -----
    if (p === "/api/health") return { ok: true };

    throw new ServiceError(`Not found: ${method} ${p}`, 404);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    console.error("[api]", e);
    throw new ServiceError(e instanceof Error ? e.message : "Something went wrong");
  }
}
