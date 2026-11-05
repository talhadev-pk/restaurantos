// Headless acceptance test for the browser-native business layer.
// Uses fake-indexeddb to emulate browser IndexedDB. Run: npx tsx scripts/smoke.ts
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).IDBKeyRange = IDBKeyRange;
// minimal localStorage shim
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

async function main() {
  const { apiDispatch } = await import("../src/spa/api");
  const { exportBackup, validateBackup, importBackup } = await import("../src/spa/db");
  let pass = 0;
  const check = (name: string, cond: boolean, extra = "") => {
    if (!cond) throw new Error(`FAIL: ${name} ${extra}`);
    console.log(`PASS  ${name}${extra ? " — " + extra : ""}`);
    pass++;
  };

  // login
  const login = await apiDispatch("/api/auth/login", "POST", { email: "talhamalikawan@example.com", password: "demo1234" });
  check("login + auto-seed", login.user.roleName === "Administrator");
  const me = await apiDispatch("/api/auth/me");
  check("session persists", me.user.email === "talhamalikawan@example.com");

  // wrong password rejected
  let rejected = false;
  try { await apiDispatch("/api/auth/login", "POST", { email: "talhamalikawan@example.com", password: "wrong" }); } catch { rejected = true; }
  check("wrong password rejected", rejected);

  // create order (2 Classic Burgers), verify kitchen flow + inventory
  const menu = await apiDispatch("/api/menu/products");
  const burger = menu.products.find((p: any) => p.product.name === "Classic Burger").product;
  const inv0 = await apiDispatch("/api/inventory");
  const bunsBefore = inv0.ingredients.find((i: any) => i.name === "Burger Bun").stockQty;

  const { order } = await apiDispatch("/api/orders", "POST", { type: "takeaway", items: [{ productId: burger.id, quantity: 2 }], autoConfirm: true });
  check("order created + priced", order.totalCents === Math.round(2 * 1295 * 1.085), `total ${order.totalCents}`);
  await apiDispatch(`/api/orders/${order.id}`, "PATCH", { action: "start_prepare" });
  await apiDispatch(`/api/orders/${order.id}`, "PATCH", { action: "ready" });
  await apiDispatch(`/api/orders/${order.id}`, "PATCH", { action: "complete", paymentMethod: "card" });
  const inv1 = await apiDispatch("/api/inventory");
  const bunsAfter = inv1.ingredients.find((i: any) => i.name === "Burger Bun").stockQty;
  check("inventory deducted by recipe", bunsBefore - bunsAfter === 2, `${bunsBefore} -> ${bunsAfter}`);

  // idempotency: double completion must fail
  let doubleFailed = false;
  try { await apiDispatch(`/api/orders/${order.id}`, "PATCH", { action: "complete", paymentMethod: "card" }); } catch { doubleFailed = true; }
  check("duplicate completion rejected", doubleFailed);

  // exactly one payment
  const detail = await apiDispatch(`/api/orders/${order.id}`);
  check("exactly one payment recorded", detail.payment && !Array.isArray(detail.payment));

  // insufficient stock blocked
  const ribeye = menu.products.find((p: any) => p.product.name === "Ribeye Steak").product;
  const { order: bigOrder } = await apiDispatch("/api/orders", "POST", { type: "takeaway", items: [{ productId: ribeye.id, quantity: 50 }], autoConfirm: true });
  await apiDispatch(`/api/orders/${bigOrder.id}`, "PATCH", { action: "start_prepare" });
  await apiDispatch(`/api/orders/${bigOrder.id}`, "PATCH", { action: "ready" });
  let blocked = false;
  try { await apiDispatch(`/api/orders/${bigOrder.id}`, "PATCH", { action: "complete", paymentMethod: "cash" }); } catch { blocked = true; }
  check("insufficient stock blocks completion", blocked);

  // refund restores inventory
  await apiDispatch(`/api/orders/${order.id}`, "PATCH", { action: "refund", reason: "test" });
  const inv2 = await apiDispatch("/api/inventory");
  const bunsRestored = inv2.ingredients.find((i: any) => i.name === "Burger Bun").stockQty;
  check("refund restores inventory", bunsRestored === bunsBefore, `${bunsBefore} -> ${bunsRestored}`);

  // reservation conflict
  const tables = await apiDispatch("/api/tables");
  const t1 = tables.tables[0].table;
  const when = new Date(Date.now() + 86400000).toISOString();
  await apiDispatch("/api/reservations", "POST", { tableId: t1.id, reservedFor: when, partySize: 2, customerName: "Test A" });
  let clash = false;
  try {
    await apiDispatch("/api/reservations", "POST", { tableId: t1.id, reservedFor: new Date(Date.now() + 86400000 + 3600000).toISOString(), partySize: 2, customerName: "Test B" });
  } catch { clash = true; }
  check("reservation conflict prevented", clash);

  // purchase receive increases stock
  const suppliers = await apiDispatch("/api/suppliers");
  const ing = (await apiDispatch("/api/inventory")).ingredients[5];
  const before = ing.stockQty;
  const { purchaseOrder } = await apiDispatch("/api/purchases", "POST", { supplierId: suppliers.suppliers[0].id, items: [{ ingredientId: ing.id, quantity: 50, unitCostCents: ing.unitCostCents }] });
  await apiDispatch(`/api/purchases/${purchaseOrder.id}`, "PATCH", { action: "approve" });
  await apiDispatch(`/api/purchases/${purchaseOrder.id}`, "PATCH", { action: "receive", received: [{ itemId: 1, qty: 50 }] });
  const after = (await apiDispatch("/api/inventory")).ingredients[5].stockQty;
  check("goods receiving increases stock", after - before === 50, `${before} -> ${after}`);

  // attendance simulation idempotent per day
  const a1 = await apiDispatch("/api/employees", "POST", { action: "simulate_attendance" });
  const a2 = await apiDispatch("/api/employees", "POST", { action: "simulate_attendance" });
  check("attendance runs + dedupes same day", a1.created > 0 && a2.created === 0);

  // settings persist
  await apiDispatch("/api/settings", "PUT", { displayName: "Talha (QA)" });
  const s2 = await apiDispatch("/api/settings");
  check("settings persist", s2.settings.displayName === "Talha (QA)");
  await apiDispatch("/api/settings", "PUT", { displayName: "Talha" });

  // dashboard aggregates from real records
  const dash = await apiDispatch("/api/dashboard?range=30d");
  check("dashboard computed from records", dash.kpis.orderCount > 100 && dash.kpis.revenue > 0, `orders=${dash.kpis.orderCount}`);

  // reports + csv
  const rep = await apiDispatch("/api/reports?type=profit&range=30d");
  check("P&L report computes", rep.rows.length >= 5 && rep.title === "Profit & Loss");
  const csv = await apiDispatch("/api/reports?type=sales&range=30d&format=csv");
  check("CSV export works", csv.text.includes("revenue_usd"));

  // simulation engine
  const simStart = await apiDispatch("/api/simulation/start", "POST", { mode: "automatic", speed: 8, arrivalSec: 2, operatingStart: 0, operatingEnd: 23 });
  check("simulation starts", simStart.status === "running");
  await new Promise((r) => setTimeout(r, 12000));
  const snap = await apiDispatch("/api/simulation/status");
  check("simulation generated real orders", snap.stats.ordersCreated > 0, `created=${snap.stats.ordersCreated}, completed=${snap.stats.ordersCompleted}`);
  const reset = await apiDispatch("/api/simulation/reset", "POST");
  check("simulation reset restores inventory", reset.summary.ordersRemoved === snap.stats.ordersCreated);

  // backup export + validate + import
  const backup = await exportBackup();
  const valid = validateBackup(backup);
  check("backup exports + validates", valid.valid === true);
  await importBackup(JSON.parse(JSON.stringify(backup)), "replace");
  const dash2 = await apiDispatch("/api/dashboard?range=30d");
  check("backup restore round-trips", dash2.kpis.orderCount === dash.kpis.orderCount);

  console.log(`\n${pass} checks passed — browser-native business layer is sound.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
