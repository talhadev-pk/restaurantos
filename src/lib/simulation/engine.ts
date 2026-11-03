// Server-only: the RestaurantOS simulation engine.
// A singleton driving virtual customers and a virtual kitchen through the SAME
// order service as manual operations — no separate fake transaction logic.
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createOrder, transitionOrder } from "../services/orders";

export type SimMode = "assisted" | "automatic" | "stress";
export type EngineStatus = "idle" | "running" | "paused";

interface EngineConfig {
  speed: number; // multiplier
  arrivalSec: number; // base seconds between arrivals
  minItems: number;
  maxItems: number;
  operatingStart: number; // hour 0-23
  operatingEnd: number; // hour 0-23
}

const FIRST = ["Ava", "Liam", "Maya", "Omar", "Zoe", "Ethan", "Layla", "Noah", "Ivy", "Kai", "Sara", "Leo", "Nina", "Adam", "Ruby", "Finn", "Mila", "Owen", "Tara", "Hugo", "Erin", "Max", "Lena", "Sam"];
const LAST = ["Chen", "Patel", "Garcia", "Khan", "Smith", "Ali", "Brown", "Kim", "Lopez", "Singh", "Novak", "Silva", "Ahmed", "Reyes", "Costa", "Weber"];
const PAY_METHODS = ["cash", "card", "mobile"];

class SimulationEngine {
  status: EngineStatus = "idle";
  mode: SimMode = "automatic";
  sessionId: number | null = null;
  config: EngineConfig = {
    speed: 1,
    arrivalSec: 12,
    minItems: 1,
    maxItems: 4,
    operatingStart: 8,
    operatingEnd: 23,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextArrivalAt = 0;
  private prepEta = new Map<number, number>(); // orderId -> epoch ms when ready
  private serveEta = new Map<number, number>(); // orderId -> epoch ms when complete
  private cleaningEta = new Map<number, number>(); // tableId -> epoch ms when available
  private busy = false;
  stats = { ordersCreated: 0, ordersCompleted: 0, customersCreated: 0, blocked: 0 };
  lastError: string | null = null;

  isActive() {
    return this.status !== "idle";
  }

  /** Opportunistically advance the engine one step. Safe to call from request
   *  handlers — the interval timer is the primary driver, this is a fallback
   *  for hosts without persistent background timers. Guarded by `busy`. */
  async pump() {
    await this.tick();
  }

  async start(mode: SimMode, config?: Partial<EngineConfig>) {
    if (this.status === "running") throw new Error("Simulation is already running.");
    this.mode = mode;
    if (config) this.config = { ...this.config, ...config };
    // close stale sessions
    await db
      .update(s.simulationSessions)
      .set({ status: "stopped", endedAt: new Date() })
      .where(and(eq(s.simulationSessions.status, "running")));
    const [session] = await db
      .insert(s.simulationSessions)
      .values({ mode, status: "running", speed: this.config.speed, config: this.config as unknown as Record<string, unknown> })
      .returning();
    this.sessionId = session.id;
    this.status = "running";
    this.stats = { ordersCreated: 0, ordersCompleted: 0, customersCreated: 0, blocked: 0 };
    this.prepEta.clear();
    this.serveEta.clear();
    this.nextArrivalAt = Date.now() + (mode === "stress" ? 300 : 1500);
    this.timer = setInterval(() => void this.tick(), 750);
    await this.log("info", `Simulation started in ${mode.toUpperCase()} mode (speed x${this.config.speed}).`);
  }

  async pause() {
    if (this.status !== "running") throw new Error("Simulation is not running.");
    this.status = "paused";
    if (this.sessionId) {
      await db.update(s.simulationSessions).set({ status: "paused" }).where(eq(s.simulationSessions.id, this.sessionId));
    }
    await this.log("info", "Simulation paused.");
  }

  async resume() {
    if (this.status !== "paused") throw new Error("Simulation is not paused.");
    this.status = "running";
    this.nextArrivalAt = Date.now() + 1000;
    if (this.sessionId) {
      await db.update(s.simulationSessions).set({ status: "running" }).where(eq(s.simulationSessions.id, this.sessionId));
    }
    await this.log("info", "Simulation resumed.");
  }

  async stop() {
    this.status = "idle";
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.sessionId) {
      await db
        .update(s.simulationSessions)
        .set({ status: "stopped", endedAt: new Date() })
        .where(eq(s.simulationSessions.id, this.sessionId));
    }
    await this.log("info", "Simulation stopped.");
    this.sessionId = null;
    this.prepEta.clear();
    this.serveEta.clear();
  }

  async updateConfig(patch: Partial<EngineConfig> & { speed?: number }) {
    const prev = this.config.speed;
    this.config = { ...this.config, ...patch };
    if (this.sessionId && patch.speed !== undefined && patch.speed !== prev) {
      await db.update(s.simulationSessions).set({ speed: this.config.speed }).where(eq(s.simulationSessions.id, this.sessionId));
      await this.log("info", `Simulation speed changed to x${this.config.speed}.`);
    }
  }

  async log(type: string, message: string) {
    await db.insert(s.simulationEvents).values({ sessionId: this.sessionId, eventType: type, message });
  }

  /** Delete all simulation-generated data and restore consumed inventory. */
  async reset() {
    const wasActive = this.isActive();
    if (wasActive) await this.stop();
    const summary = await db.transaction(async (tx) => {
      // restore inventory from simulation consumption movements
      const moves = await tx
        .select()
        .from(s.stockMovements)
        .where(and(eq(s.stockMovements.source, "simulation"), eq(s.stockMovements.type, "consumption")));
      for (const m of moves) {
        await tx
          .update(s.ingredients)
          .set({ stockQty: sql`${s.ingredients.stockQty} + ${m.quantity}` })
          .where(eq(s.ingredients.id, m.ingredientId));
      }
      await tx.delete(s.stockMovements).where(eq(s.stockMovements.source, "simulation"));
      const simOrders = await tx.select({ id: s.orders.id, tableId: s.orders.tableId }).from(s.orders).where(eq(s.orders.source, "simulation"));
      const ids = simOrders.map((o) => o.id);
      if (ids.length) {
        await tx.delete(s.refunds).where(inArray(s.refunds.orderId, ids));
        await tx.delete(s.payments).where(inArray(s.payments.orderId, ids));
        await tx.delete(s.orderItems).where(inArray(s.orderItems.orderId, ids));
        await tx.delete(s.orders).where(inArray(s.orders.id, ids));
      }
      // free any tables still marked occupied by simulation
      await tx.execute(sql`UPDATE restaurant_tables SET status = 'available' WHERE status IN ('occupied','cleaning')`);
      await tx.delete(s.simulationEvents).where(sql`true`);
      await tx.update(s.simulationSessions).set({ status: "stopped", endedAt: new Date() }).where(eq(s.simulationSessions.status, "running"));
      return { ordersRemoved: ids.length, inventoryRestored: moves.length };
    });
    await this.log("info", `Simulation reset: removed ${summary.ordersRemoved} orders, restored ${summary.inventoryRestored} stock movements.`);
    return summary;
  }

  private async pickCustomer(): Promise<number | null> {
    const makeNew = Math.random() < 0.35;
    if (makeNew) {
      const name = `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
      const [c] = await db
        .insert(s.customers)
        .values({ name, phone: `+1-555-${String(Math.floor(1000 + Math.random() * 9000))}`, isVirtual: true })
        .returning();
      this.stats.customersCreated++;
      await this.log("customer", `New virtual customer arrived: ${name}`);
      return c.id;
    }
    const pool = await db.select().from(s.customers).orderBy(sql`random()`).limit(1);
    return pool[0]?.id ?? null;
  }

  private async spawnOrder() {
    if (!this.sessionId) return;
    const hour = new Date().getHours();
    if (hour < this.config.operatingStart || hour >= this.config.operatingEnd) return;

    const auto = this.mode === "automatic" || this.mode === "stress";
    // pick type
    let type: "dine_in" | "takeaway" | "delivery";
    let tableId: number | null = null;
    if (this.mode === "stress") {
      type = "takeaway";
    } else {
      const r = Math.random();
      const wantDineIn = r < 0.55;
      if (wantDineIn) {
        const free = await db
          .select()
          .from(s.restaurantTables)
          .where(and(eq(s.restaurantTables.status, "available"), eq(s.restaurantTables.active, true)))
          .orderBy(sql`random()`)
          .limit(1);
        if (free[0]) {
          type = "dine_in";
          tableId = free[0].id;
        } else {
          type = Math.random() < 0.7 ? "takeaway" : "delivery";
        }
      } else type = r < 0.85 ? "takeaway" : "delivery";
    }

    const prods = await db.select().from(s.products).where(eq(s.products.available, true));
    if (!prods.length) return;
    const count =
      this.config.minItems + Math.floor(Math.random() * Math.max(1, this.config.maxItems - this.config.minItems + 1));
    const items = Array.from({ length: count }, () => {
      const p = prods[Math.floor(Math.random() * prods.length)];
      return { productId: p.id, quantity: 1 + Math.floor(Math.random() * 2) };
    });
    const customerId = await this.pickCustomer();

    try {
      const order = await createOrder(null, {
        type,
        tableId,
        customerId,
        items,
        autoConfirm: true,
        source: "simulation",
        simulationSessionId: this.sessionId,
      });
      this.stats.ordersCreated++;
      await this.log("order", `Order ${order.orderNumber} created (${type}, ${count} item${count > 1 ? "s" : ""}).`);
      if (auto) {
        const prepMs = this.mode === "stress" ? 3000 : 12000 + count * 5000;
        const eta = Date.now() + prepMs / this.config.speed;
        await transitionOrder(null, order.id, "start_prepare");
        this.prepEta.set(order.id, eta);
        await this.log("kitchen", `Order ${order.orderNumber} sent to the virtual kitchen.`);
      }
    } catch (e) {
      this.stats.blocked++;
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      await this.log("warn", `Order blocked: ${msg}`);
    }
  }

  private async progressKitchen() {
    const now = Date.now();
    // confirmed/preparing → ready
    for (const [orderId, eta] of this.prepEta) {
      if (now >= eta) {
        try {
          await transitionOrder(null, orderId, "ready");
          this.serveEta.set(orderId, now + 9000 / this.config.speed);
          await this.log("kitchen", `An order is ready for service.`);
        } catch {
          /* order moved externally */
        }
        this.prepEta.delete(orderId);
      }
    }
    // ready → completed & paid
    for (const [orderId, eta] of this.serveEta) {
      if (now >= eta) {
        try {
          const method = PAY_METHODS[Math.floor(Math.random() * PAY_METHODS.length)];
          await transitionOrder(null, orderId, "complete", { paymentMethod: method });
          this.stats.ordersCompleted++;
          await this.log("payment", `Order completed and paid (${method}).`);
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
    const tables = await db.select().from(s.restaurantTables).where(eq(s.restaurantTables.status, "cleaning"));
    for (const t of tables) {
      const eta = this.cleaningEta.get(t.id) ?? now + 6000 / this.config.speed;
      this.cleaningEta.set(t.id, eta);
      if (now >= eta) {
        await db.update(s.restaurantTables).set({ status: "available" }).where(eq(s.restaurantTables.id, t.id));
        this.cleaningEta.delete(t.id);
      }
    }
  }

  private async tick() {
    if (this.status !== "running" || this.busy) return;
    this.busy = true;
    try {
      const auto = this.mode === "automatic" || this.mode === "stress";
      // arrivals
      if (Date.now() >= this.nextArrivalAt) {
        if (this.mode === "stress") {
          const active = await db
            .select({ c: sql<number>`count(*)::int` })
            .from(s.orders)
            .where(inArray(s.orders.status, ["confirmed", "preparing", "ready"]));
          if (Number(active[0].c) < 40) {
            for (let i = 0; i < 4; i++) await this.spawnOrder();
          }
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
    const recent = await db.select().from(s.simulationEvents).orderBy(desc(s.simulationEvents.id)).limit(40);
    const activeOrders = this.sessionId
      ? await db
          .select({ status: s.orders.status, c: sql<number>`count(*)::int` })
          .from(s.orders)
          .where(eq(s.orders.simulationSessionId, this.sessionId))
          .groupBy(s.orders.status)
      : [];
    return {
      status: this.status,
      mode: this.mode,
      sessionId: this.sessionId,
      config: this.config,
      stats: this.stats,
      lastError: this.lastError,
      activeByStatus: Object.fromEntries(activeOrders.map((r) => [r.status, Number(r.c)])),
      events: recent.reverse(),
    };
  }
}

const g = globalThis as typeof globalThis & { __rosEngine?: SimulationEngine };
export function getEngine(): SimulationEngine {
  if (!g.__rosEngine) g.__rosEngine = new SimulationEngine();
  return g.__rosEngine;
}
