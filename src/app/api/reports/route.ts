import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse, ServiceError } from "@/lib/system";
import { dayKey, resolveRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const str = String(v ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth("reports.view");
    const sp = new URL(req.url).searchParams;
    const type = sp.get("type") ?? "sales";
    const format = sp.get("format") ?? "json";
    const { from, to, label } = resolveRange(sp);

    let title = type;
    let rows: Record<string, unknown>[] = [];

    if (type === "sales") {
      const orders = await db.select().from(s.orders)
        .where(and(eq(s.orders.status, "completed"), gte(s.orders.completedAt, from), lte(s.orders.completedAt, to)));
      const byDay = new Map<string, { revenue: number; orders: number; tax: number; cogs: number; discounts: number }>();
      for (const o of orders) {
        const k = dayKey(new Date(o.completedAt!));
        const cur = byDay.get(k) ?? { revenue: 0, orders: 0, tax: 0, cogs: 0, discounts: 0 };
        cur.revenue += o.totalCents; cur.orders += 1; cur.tax += o.taxCents; cur.cogs += o.cogsCents; cur.discounts += o.discountCents;
        byDay.set(k, cur);
      }
      title = "Daily Sales";
      rows = [...byDay.entries()].sort().map(([date, v]) => ({
        date, orders: v.orders, revenue_usd: (v.revenue / 100).toFixed(2), tax_usd: (v.tax / 100).toFixed(2),
        discounts_usd: (v.discounts / 100).toFixed(2), cogs_usd: (v.cogs / 100).toFixed(2),
        gross_profit_usd: ((v.revenue - v.cogs) / 100).toFixed(2),
      }));
    } else if (type === "products") {
      const r = await db.execute(sql`
        SELECT oi.product_name AS product, SUM(oi.quantity)::int AS qty,
               SUM(oi.quantity * oi.unit_price_cents)::int AS revenue_cents
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'completed' AND o.completed_at >= ${from} AND o.completed_at <= ${to}
        GROUP BY oi.product_name ORDER BY revenue_cents DESC`);
      rows = (r.rows as any[]).map((x) => ({ product: x.product, qty: x.qty, revenue_usd: (x.revenue_cents / 100).toFixed(2) }));
    } else if (type === "categories") {
      const r = await db.execute(sql`
        SELECT coalesce(c.name, 'Uncategorised') AS category, SUM(oi.quantity)::int AS qty,
               SUM(oi.quantity * oi.unit_price_cents)::int AS revenue_cents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE o.status = 'completed' AND o.completed_at >= ${from} AND o.completed_at <= ${to}
        GROUP BY c.name ORDER BY revenue_cents DESC`);
      rows = (r.rows as any[]).map((x) => ({ category: x.category, qty: x.qty, revenue_usd: (x.revenue_cents / 100).toFixed(2) }));
    } else if (type === "inventory") {
      const r = await db.execute(sql`
        SELECT i.name AS ingredient, i.unit, SUM(sm.quantity) AS consumed
        FROM stock_movements sm JOIN ingredients i ON i.id = sm.ingredient_id
        WHERE sm.type = 'consumption' AND sm.created_at >= ${from} AND sm.created_at <= ${to}
        GROUP BY i.name, i.unit ORDER BY consumed DESC`);
      rows = (r.rows as any[]).map((x) => ({ ingredient: x.ingredient, consumed: Number(x.consumed), unit: x.unit }));
    } else if (type === "wastage") {
      const r = await db.execute(sql`
        SELECT i.name AS ingredient, i.unit, sm.quantity, sm.note,
               to_char(sm.created_at, 'YYYY-MM-DD HH24:MI') AS when,
               ROUND(sm.quantity * sm.unit_cost_cents) / 100.0 AS cost_usd
        FROM stock_movements sm JOIN ingredients i ON i.id = sm.ingredient_id
        WHERE sm.type = 'waste' AND sm.created_at >= ${from} AND sm.created_at <= ${to}
        ORDER BY sm.id DESC`);
      rows = r.rows as any[];
    } else if (type === "purchases") {
      const pos = await db.select({ po: s.purchaseOrders, supplier: s.suppliers.name })
        .from(s.purchaseOrders).innerJoin(s.suppliers, eq(s.purchaseOrders.supplierId, s.suppliers.id))
        .where(and(gte(s.purchaseOrders.createdAt, from), lte(s.purchaseOrders.createdAt, to)))
        .orderBy(desc(s.purchaseOrders.id));
      rows = pos.map((p) => ({
        po: p.po.id, supplier: p.supplier, status: p.po.status,
        total_usd: (p.po.totalCostCents / 100).toFixed(2),
        created: p.po.createdAt.toISOString().slice(0, 10),
      }));
    } else if (type === "customers") {
      const cs = await db.select().from(s.customers).orderBy(desc(s.customers.totalSpentCents)).limit(100);
      rows = cs.map((c) => ({
        customer: c.name, visits: c.visits, spent_usd: (c.totalSpentCents / 100).toFixed(2),
        loyalty_points: c.loyaltyPoints, virtual: c.isVirtual ? "yes" : "no",
      }));
    } else if (type === "employees") {
      const r = await db.execute(sql`
        SELECT e.name AS employee, e.position,
               count(*) FILTER (WHERE a.status = 'present')::int AS present_days,
               count(*) FILTER (WHERE a.status = 'late')::int AS late_days,
               count(*) FILTER (WHERE a.status = 'absent')::int AS absent_days
        FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id
          AND a.work_date >= ${dayKey(from)} AND a.work_date <= ${dayKey(to)}
        GROUP BY e.name, e.position ORDER BY e.name`);
      rows = r.rows as any[];
    } else if (type === "profit") {
      const orders = await db.select().from(s.orders)
        .where(and(eq(s.orders.status, "completed"), gte(s.orders.completedAt, from), lte(s.orders.completedAt, to)));
      const revenue = orders.reduce((a, o) => a + o.totalCents, 0);
      const cogs = orders.reduce((a, o) => a + o.cogsCents, 0);
      const ex = await db.select({ category: s.expenses.category, c: sql<number>`sum(amount_cents)::int` })
        .from(s.expenses).where(and(gte(s.expenses.incurredAt, from), lte(s.expenses.incurredAt, to)))
        .groupBy(s.expenses.category);
      const expenseTotal = ex.reduce((a, x) => a + Number(x.c), 0);
      const refunds = await db.select({ c: sql<number>`coalesce(sum(amount_cents),0)::int` }).from(s.refunds)
        .where(and(gte(s.refunds.createdAt, from), lte(s.refunds.createdAt, to)));
      title = "Profit & Loss";
      rows = [
        { line: "Revenue (net sales)", amount_usd: (revenue / 100).toFixed(2) },
        { line: "Refunds", amount_usd: (-Number(refunds[0].c) / 100).toFixed(2) },
        { line: "Cost of goods sold", amount_usd: (-cogs / 100).toFixed(2) },
        { line: "Gross profit", amount_usd: ((revenue - Number(refunds[0].c) - cogs) / 100).toFixed(2) },
        ...ex.map((x) => ({ line: `Expense: ${x.category}`, amount_usd: (-Number(x.c) / 100).toFixed(2) })),
        { line: "Net profit", amount_usd: ((revenue - Number(refunds[0].c) - cogs - expenseTotal) / 100).toFixed(2) },
      ];
    } else if (type === "tax") {
      const r = await db.execute(sql`
        SELECT oi.tax_rate_bp / 100.0 AS tax_pct,
               SUM(oi.quantity * oi.unit_price_cents)::int AS taxable_cents,
               ROUND(SUM(oi.quantity * oi.unit_price_cents * oi.tax_rate_bp / 10000.0))::int AS tax_cents
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'completed' AND o.completed_at >= ${from} AND o.completed_at <= ${to}
        GROUP BY oi.tax_rate_bp ORDER BY tax_pct`);
      title = "Tax Summary";
      rows = (r.rows as any[]).map((x) => ({
        tax_rate_pct: x.tax_pct, taxable_usd: (x.taxable_cents / 100).toFixed(2), tax_usd: (x.tax_cents / 100).toFixed(2),
      }));
    } else {
      throw new ServiceError("Unknown report type.");
    }

    if (format === "csv") {
      const csv = toCsv(rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="restaurantos-${type}-report.csv"`,
        },
      });
    }
    return NextResponse.json({ title, rangeLabel: label, rows });
  } catch (e) {
    return errorResponse(e);
  }
}
