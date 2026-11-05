// Browser-native simulation engine. Runs only while the app is open.
// Uses the SAME createOrder/transitionOrder services as manual operations.
import { db, nowIso } from "./db";
import { createOrder, transitionOrder } from "./services";

export type SimMode = "assisted" | "automatic" | "stress";
export type EngineStatus = "idle" | "running" | "paused";

interface EngineConfig {
  speed: number; arrivalSec: number; minItems: number; maxItems: number;
  operatingStart: number; operatingEnd: number;
}

const FIRST = ["Ava", "Liam", "Maya", "Omar", "Zoe", "Ethan", "Layla", "Noah", "Ivy", "Kai", "Sara", "Leo", "Nina", "Adam", "Ruby", "Finn", "Mila", "Owen", "Tara", "Hugo", "Erin", "Max", "Lena", "Sam"];
const LAST = ["Chen", "Patel", "Garcia", "Khan", "Smith", "Ali", "Brown", "Kim", "Lopez", "Singh", "Novak", "Silva", "Ahmed", "Reyes", "Costa", "Weber"];
const PAY_METHODS = ["cash", "card", "mobile"];
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

class SimulationEngine {
  status: EngineStatus = "idle";
  mode: SimMode = "automatic";
  sessionId: number | null = null;
  config: EngineConfig = { speed: 1, arrivalSec: 12, minItems: 1, maxItems: 4, operatingStart: 8, operatingEnd: 23 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextArrivalAt = 0;
  private prepEta = new Map<number, number>();
  private serveEta = new Map<number, number>();
  private cleaningEta = new Map<number, number>();
  private busy = false;
  stats = { ordersCreated: 0, ordersCompleted: 0, customersCreated: 0, blocked: 0 };
  lastError: string | null = null;

  async log(type: string, message: string) {
    await db.simEvents.add({ sessionId: this.sessionId, eventType: type, message, createdAt: nowIso() });
  }

  async start(mode: SimMode, config?: Partial<EngineConfig>) {
    if (this.status === "running") throw new Error("Simulation is already running.");
    this.mode = mode;
    if (config) this.config = { ...this.config, ...config };
    await db.simSessions.where("status").equals("running").modify({ status: "stopped", endedAt: nowIso() });
    this.sessionId = await db.simSessions.add({ mode, status: "running", speed: this.config.speed, config: this.config as unknown as Record<string, unknown>, startedAt: nowIso(), endedAt: null });
    this.status = "running";
    this.stats = { ordersCreated: 0, ordersCompleted: 0, customersCreated: 0, blocked: 0 };
    this.prepEta.clear(); this.serveEta.clear(); this.cleaningEta.clear();
    this.nextArrivalAt = Date.now() + (mode === "stress" ? 300 : 1500);
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 750);
    await this.log("info", `Simulation started in ${mode.toUpperCase()} mode (speed x${this.config.speed}).`);
  }

  async pause() {
    if (this.status !== "running") throw new Error("Simulation is not running.");
    this.status = "paused";
    if (this.sessionId) await db.simSessions.update(this.sessionId, { status: "paused" });
    await this.log("info", "Simulation paused.");
  }

  async resume() {
    if (this.status !== "paused") throw new Error("Simulation is not paused.");
    this.status = "running";
    this.nextArrivalAt = Date.now() + 1000;
    if (this.sessionId) await db.simSessions.update(this.sessionId, { status: "running" });
    await this.log("info", "Simulation resumed.");
  }

  async stop() {
    this.status = "idle";
    if (this.sessionId) await db.simSessions.update(this.sessionId, { status: "stopped", endedAt: nowIso() });
    await this.log("info", "Simulation stopped.");
    this.sessionId = null;
    this.prepEta.clear(); this.serveEta.clear();
  }

  async updateConfig(patch: Partial<EngineConfig>) {
    const prev = this.config.speed;
    this.config = { ...this.config, ...patch };
    if (this.sessionId && patch.speed !== undefined && patch.speed !== prev) {
      await db.simSessions.update(this.sessionId, { speed: this.config.speed });
      await this.log("info", `Simulation speed changed to x${this.config.speed}.`);
    }
  }

  async reset() {
    const wasActive = this.status !== "idle";
    if (wasActive) await this.stop();
    const summary = await db.transaction("rw", [db.stockMovements, db.ingredients, db.orders, db.orderItems, db.payments, db.refunds, db.restaurantTables, db.simEvents, db.simSessions], async () => {
      const moves = await db.stockMovements.where("type").equals("consumption").filter((m) => m.source === "simulation").toArray();
      for (const m of moves) {
        const ing = await db.ingredients.get(m.ingredientId);
        if (ing) await db.ingredients.update(ing.id, { stockQty: Math.round((ing.stockQty + m.quantity) * 1000) / 1000 });
      }
      await db.stockMovements.where("type").equals("consumption").filter((m) => m.source === "simulation").delete();
      const simOrders = await db.orders.where("source").equals("simulation").toArray();
      const ids = simOrders.map((o) => o.id);
      await db.refunds.where("orderId").anyOf(ids).delete();
      await db.payments.where("orderId").anyOf(ids).delete();
      await db.orderItems.where("orderId").anyOf(ids).delete();
      await db.orders.where("source").equals("simulation").delete();
      await db.restaurantTables.where("status").anyOf(["occupied", "cleaning"]).modify({ status: "available", note: "" });
      await db.simEvents.clear();
      await db.simSessions.where("status").equals("running").modify({ status: "stopped", endedAt: nowIso() });
      return { ordersRemoved: ids.length, inventoryRestored: moves.length };
    });
    await this.log("info", `Simulation reset: removed ${summary.ordersRemoved} orders, restored ${summary.inventoryRestored} stock movements.`);
    return summary;
  }

  private async pickCustomer(): Promise<number | null> {
    if (Math.random() < 0.35) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const id = await db.customers.add({
        name, phone: `+1-555-${String(Math.floor(1000 + Math.random() * 9000))}`, email: "", segment: "new",
        loyaltyPoints: 0, totalSpentCents: 0, visits: 0, isVirtual: true, createdAt: nowIso(),
      });
      this.stats.customersCreated++;
      await this.log("customer", `New virtual customer arrived: ${name}`);
      return id;
    }
    const all = await db.customers.toArray();
    return all.length ? pick(all).id : null;
  }

  private async spawnOrder() {
    if (!this.sessionId) return;
    const hour = new Date().getHours();
    if (hour < this.config.operatingStart || hour >= this.config.operatingEnd) return;

    const auto = this.mode === "automatic" || this.mode === "stress";
    let type: "dine_in" | "takeaway" | "delivery";
    let tableId: number | null = null;
    if (this.mode === "stress") {
      type = "takeaway";
    } else if (Math.random() < 0.55) {
      const free = await db.restaurantTables.where("status").equals("available").filter((t) => t.active).toArray();
      if (free.length) { type = "dine_in"; tableId = pick(free).id; }
      else type = Math.random() < 0.7 ? "takeaway" : "delivery";
    } else {
      type = Math.random() < 0.85 ? "takeaway" : "delivery";
    }

    const prods = await db.products.filter((p) => !!p.available).toArray();
    if (!prods.length) return;
    const count = this.config.minItems + Math.floor(Math.random() * Math.max(1, this.config.maxItems - this.config.minItems + 1));
    const items = Array.from({ length: count }, () => ({ productId: pick(prods).id, quantity: 1 + Math.floor(Math.random() * 2) }));
    const customerId = await this.pickCustomer();

    try {
      const order = await createOrder("simulation", {
        type, tableId, customerId, items, autoConfirm: true, source: "simulation", simulationSessionId: this.sessionId,
      });
      this.stats.ordersCreated++;
      await this.log("order", `Order ${order.orderNumber} created (${type}, ${count} item${count > 1 ? "s" : ""}).`);
      if (auto) {
        await transitionOrder("simulation", order.id, "start_prepare");
        const prepMs = this.mode === "stress" ? 3000 : 12000 + count * 5000;
        this.prepEta.set(order.id, Date.now() + prepMs / this.config.speed);
        await this.log("kitchen", `Order ${order.orderNumber} sent to the virtual kitchen.`);
      }
    } catch (e) {
      this.stats.blocked++;
      this.lastError = e instanceof Error ? e.message : String(e);
      await this.log("warn", `Order blocked: ${this.lastError}`);
    }
  }

  private async progressKitchen() {
    const now = Date.now();
    for (const [orderId, eta] of this.prepEta) {
      if (now >= eta) {
        try {
          await transitionOrder("simulation", orderId, "ready");
          this.serveEta.set(orderId, now + 9000 / this.config.speed);
          await this.log("kitchen", `An order is ready for service.`);
        } catch { /* moved externally */ }
        this.prepEta.delete(orderId);
      }
    }
    for (const [orderId, eta] of this.serveEta) {
      if (now >= eta) {
        try {
          await transitionOrder("simulation", orderId, "complete", { paymentMethod: pick(PAY_METHODS) });
          this.stats.ordersCompleted++;
          await this.log("payment", `Order completed and paid.`);
        } catch (e) {
          this.stats.blocked++;
          this.lastError = e instanceof Error ? e.message : String(e);
          await this.log("warn", `Completion blocked: ${this.lastError}`);
        }
        this.serveEta.delete(orderId);
      }
    }
  }

  private async progressCleaning() {
    const now = Date.now();
    const tables = await db.restaurantTables.where("status").equals("cleaning").toArray();
    for (const t of tables) {
      const eta = this.cleaningEta.get(t.id) ?? now + 6000 / this.config.speed;
      this.cleaningEta.set(t.id, eta);
      if (now >= eta) {
        await db.restaurantTables.update(t.id, { status: "available" });
        this.cleaningEta.delete(t.id);
      }
    }
  }

  private async tick() {
    if (this.status !== "running" || this.busy) return;
    this.busy = true;
    try {
      const auto = this.mode === "automatic" || this.mode === "stress";
      if (Date.now() >= this.nextArrivalAt) {
        if (this.mode === "stress") {
          const active = await db.orders.where("status").anyOf(["confirmed", "preparing", "ready"]).count();
          if (active < 40) for (let i = 0; i < 4; i++) await this.spawnOrder();
        } else {
          await this.spawnOrder();
        }
        const jitter = 0.5 + Math.random();
        this.nextArrivalAt = Date.now() + ((this.mode === "stress" ? 1500 : this.config.arrivalSec * 1000) * jitter) / this.config.speed;
      }
      if (auto) await this.progressKitchen();
      await this.progressCleaning();
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error("[sim-engine]", e);
    } finally {
      this.busy = false;
    }
  }

  async snapshot() {
    const events = (await db.simEvents.orderBy("id").reverse().limit(40).toArray()).reverse();
    const activeByStatus: Record<string, number> = {};
    if (this.sessionId) {
      const sessionOrders = await db.orders.where("simulationSessionId").equals(this.sessionId).toArray();
      for (const o of sessionOrders) activeByStatus[o.status] = (activeByStatus[o.status] ?? 0) + 1;
    }
    return {
      status: this.status, mode: this.mode, sessionId: this.sessionId,
      config: this.config, stats: this.stats, lastError: this.lastError, activeByStatus, events,
    };
  }
}

export const engine = new SimulationEngine();
