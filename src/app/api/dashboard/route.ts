import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/system";
import { dayKey, resolveRange } from "@/lib/ranges";
import { getEngine } from "@/lib/simulation/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuth("dashboard.view");
    const { from, to, label } = resolveRange(new URL(req.url).searchParams);

    const completed = await db
      .select({
        id: s.orders.id,
        totalCents: s.orders.totalCents,
        taxCents: s.orders.taxCents,
        cogsCents: s.orders.cogsCents,
        subtotalCents: s.orders.subtotalCents,
        discountCents: s.orders.discountCents,
        completedAt: s.orders.completedAt,
        source: s.orders.source,
        type: s.orders.type,
      })
      .from(s.orders)
      .where(and(eq(s.orders.status, "completed"), gte(s.orders.completedAt, from), lte(s.orders.completedAt, to)));

    const refundsInRange = await db
      .select({ c: sql<number>`coalesce(sum(${s.refunds.amountCents}),0)::int` })
      .from(s.refunds)
      .where(and(gte(s.refunds.createdAt, from), lte(s.refunds.createdAt, to)));

    const expensesRows = await db
      .select({ amountCents: s.expenses.amountCents })
      .from(s.expenses)
      .where(and(gte(s.expenses.incurredAt, from), lte(s.expenses.incurredAt, to)));

    const refundTotal = Number(refundsInRange[0]?.c ?? 0);
    const revenue = completed.reduce((a, o) => a + o.totalCents, 0) - refundTotal;
    const orderCount = completed.length;
    const cogs = completed.reduce((a, o) => a + o.cogsCents, 0);
    const grossProfit = revenue - cogs;
    const expenseTotal = expensesRows.reduce((a, e) => a + e.amountCents, 0);
    const netProfit = grossProfit - expenseTotal;
    const taxCollected = completed.reduce((a, o) => a + o.taxCents, 0);
    const discounts = completed.reduce((a, o) => a + o.discountCents, 0);

    // Sales trend by day
    const trendMap = new Map<string, { revenue: number; orders: number }>();
    for (const o of completed) {
      const key = dayKey(new Date(o.completedAt!));
      const cur = trendMap.get(key) ?? { revenue: 0, orders: 0 };
      cur.revenue += o.totalCents;
      cur.orders += 1;
      trendMap.set(key, cur);
    }
    const trend = [...trendMap.entries()].sort().map(([date, v]) => ({ date, revenue: v.revenue, orders: v.orders }));

    // Popular items
    const topItems = await db.execute(sql`
      SELECT oi.product_name AS name, SUM(oi.quantity)::int AS qty,
             SUM(oi.quantity * oi.unit_price_cents)::int AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'completed' AND o.completed_at >= ${from} AND o.completed_at <= ${to}
      GROUP BY oi.product_name ORDER BY qty DESC LIMIT 6
    `);

    // Live status distribution (open orders right now)
    const statusDist = await db
      .select({ status: s.orders.status, c: sql<number>`count(*)::int` })
      .from(s.orders)
      .groupBy(s.orders.status);

    // Recent paid transactions
    const recentTransactions = await db
      .select({
        id: s.payments.id,
        orderNumber: s.orders.orderNumber,
        amountCents: s.payments.amountCents,
        method: s.payments.method,
        createdAt: s.payments.createdAt,
        source: s.orders.source,
      })
      .from(s.payments)
      .innerJoin(s.orders, eq(s.payments.orderId, s.orders.id))
      .orderBy(desc(s.payments.id))
      .limit(8);

    // Low stock + valuation
    const ingredients = await db.select().from(s.ingredients).where(eq(s.ingredients.active, true));
    const lowStock = ingredients
      .filter((i) => i.stockQty <= i.minStock)
      .map((i) => ({ id: i.id, name: i.name, stockQty: i.stockQty, minStock: i.minStock, unit: i.unit }));
    const valuation = ingredients.reduce((a, i) => a + Math.round(i.stockQty * i.unitCostCents), 0);

    // Customer activity in range
    const newCustomers = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(s.customers)
      .where(and(gte(s.customers.createdAt, from), lte(s.customers.createdAt, to)));
    const totalCustomers = await db.select({ c: sql<number>`count(*)::int` }).from(s.customers);

    // Recent orders feed
    const recentOrders = await db
      .select({
        id: s.orders.id,
        orderNumber: s.orders.orderNumber,
        type: s.orders.type,
        status: s.orders.status,
        totalCents: s.orders.totalCents,
        source: s.orders.source,
        createdAt: s.orders.createdAt,
        customerName: s.customers.name,
      })
      .from(s.orders)
      .leftJoin(s.customers, eq(s.orders.customerId, s.customers.id))
      .orderBy(desc(s.orders.id))
      .limit(10);

    // Simulation activity
    const engine = getEngine();
    const simEvents = await db.select().from(s.simulationEvents).orderBy(desc(s.simulationEvents.id)).limit(6);

    return NextResponse.json({
      rangeLabel: label,
      kpis: {
        revenue,
        orderCount,
        avgOrderValue: orderCount ? Math.round(revenue / orderCount) : 0,
        cogs,
        grossProfit,
        expenses: expenseTotal,
        netProfit,
        taxCollected,
        discounts,
        refunds: refundTotal,
        inventoryValuation: valuation,
      },
      trend,
      topItems: (topItems.rows as { name: string; qty: number; revenue: number }[]) ?? [],
      statusDist: Object.fromEntries(statusDist.map((r) => [r.status, Number(r.c)])),
      recentTransactions,
      recentOrders,
      lowStock,
      customers: { new: Number(newCustomers[0].c), total: Number(totalCustomers[0].c) },
      sim: { status: engine.status, stats: engine.stats, sessionId: engine.sessionId, events: simEvents },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
