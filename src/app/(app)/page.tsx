"use client";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Coins, Flame, Package, Receipt, Star, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useState } from "react";
import { RevenueTrend, StatusDonut } from "@/components/charts";
import { Badge, Card, CardHeader, EmptyState, Segmented, Spinner, Stat, useApi, Button } from "@/components/ui";
import { cn, formatCents, STATUS_STYLES, timeAgo } from "@/lib/utils";
import Link from "next/link";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export default function DashboardPage() {
  const [range, setRange] = useState("today");
  const { data, loading, error, refetch } = useApi<any>(`/api/dashboard?range=${range}`, { interval: 8000 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Executive Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">{data?.rangeLabel ?? "…"} · every figure is computed live from the database</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>Refresh</Button>
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      {error && <Card className="text-sm text-rose-400">{error}</Card>}
      {loading && !data && <Spinner label="Computing business metrics…" />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Net Revenue" value={formatCents(data.kpis.revenue)} icon={<Coins size={17} />}
              sub={data.kpis.refunds > 0 ? <span className="text-rose-400">incl. −{formatCents(data.kpis.refunds)} refunds</span> : `${data.rangeLabel}`} />
            <Stat label="Orders" value={data.kpis.orderCount} icon={<Receipt size={17} />} sub={`Avg ${formatCents(data.kpis.avgOrderValue)}`} />
            <Stat label="Gross Profit" value={formatCents(data.kpis.grossProfit)} icon={<TrendingUp size={17} />}
              sub={`COGS ${formatCents(data.kpis.cogs)} · margin ${data.kpis.revenue > 0 ? Math.round(((data.kpis.grossProfit) / data.kpis.revenue) * 100) : 0}%`}
              tone={data.kpis.grossProfit >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Stat label="Net Profit" value={formatCents(data.kpis.netProfit)} icon={<Wallet size={17} />}
              sub={`After ${formatCents(data.kpis.expenses)} operating expenses`}
              tone={data.kpis.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader title="Sales Trend" hint="Daily revenue from completed orders" />
              {data.trend.length ? <RevenueTrend data={data.trend} /> : <EmptyState title="No sales in this range" hint="Complete some orders to see the revenue trend." />}
            </Card>
            <Card>
              <CardHeader title="Order Status" hint="Distribution of orders in range + live" />
              <StatusDonut dist={data.statusDist} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader title="Popular Items" hint="By quantity sold" />
              <div className="space-y-3">
                {data.topItems.length === 0 && <p className="text-sm text-muted">No sales recorded yet.</p>}
                {data.topItems.map((it: any, i: number) => {
                  const max = data.topItems[0]?.qty ?? 1;
                  return (
                    <div key={it.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-md bg-[var(--panel-2)] text-[10px] flex items-center justify-center font-semibold text-amber-400">{i + 1}</span>
                          {it.name}
                        </span>
                        <span className="text-muted text-xs">{it.qty} sold · {formatCents(it.revenue)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--panel-2)] overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${(it.qty / max) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.06 }}
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader title="Inventory Health" hint={`Valuation ${formatCents(data.kpis.inventoryValuation)}`}
                action={<Link href="/inventory" className="text-xs text-amber-400 hover:underline">Manage</Link>} />
              {data.lowStock.length === 0 ? (
                <div className="flex items-center gap-3 text-sm text-emerald-400">
                  <Package size={18} /> All ingredients are above minimum levels.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.lowStock.slice(0, 6).map((i: any) => (
                    <div key={i.id} className="flex items-center justify-between text-sm border border-rose-500/15 bg-rose-500/5 rounded-xl px-3 py-2">
                      <span className="flex items-center gap-2"><AlertTriangle size={14} className="text-rose-400" />{i.name}</span>
                      <span className="text-xs text-muted">{i.stockQty}/{i.minStock} {i.unit}</span>
                    </div>
                  ))}
                  {data.lowStock.length > 6 && <p className="text-xs text-muted">+ {data.lowStock.length - 6} more low-stock ingredients</p>}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-[var(--border)] grid grid-cols-2 gap-3 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-faint">Tax Collected</p>
                  <p className="font-display font-bold mt-0.5">{formatCents(data.kpis.taxCollected)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-faint">Discounts</p>
                  <p className="font-display font-bold mt-0.5">{formatCents(data.kpis.discounts)}</p>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Simulation Activity" hint="Virtual restaurant engine"
                action={<Badge tone={data.sim.status === "running" ? "emerald" : "slate"}>{data.sim.status}</Badge>} />
              <div className="grid grid-cols-3 gap-2 text-center mb-4">
                <div className="rounded-xl bg-[var(--panel-2)] py-2.5">
                  <p className="font-display font-bold text-lg">{data.sim.stats.ordersCreated}</p>
                  <p className="text-[10px] text-faint uppercase tracking-wide">Orders</p>
                </div>
                <div className="rounded-xl bg-[var(--panel-2)] py-2.5">
                  <p className="font-display font-bold text-lg">{data.sim.stats.ordersCompleted}</p>
                  <p className="text-[10px] text-faint uppercase tracking-wide">Completed</p>
                </div>
                <div className="rounded-xl bg-[var(--panel-2)] py-2.5">
                  <p className="font-display font-bold text-lg">{data.sim.stats.customersCreated}</p>
                  <p className="text-[10px] text-faint uppercase tracking-wide">Guests</p>
                </div>
              </div>
              <div className="space-y-2">
                {data.sim.events.length === 0 && <p className="text-sm text-muted">No simulation events yet. Start the engine from the Simulation page.</p>}
                {data.sim.events.slice(0, 5).map((e: any) => (
                  <p key={e.id} className="text-xs text-muted flex items-start gap-2">
                    <Flame size={12} className="text-amber-400 mt-0.5 shrink-0" />
                    <span className="flex-1">{e.message}</span>
                    <span className="text-faint shrink-0">{timeAgo(e.createdAt)}</span>
                  </p>
                ))}
              </div>
              <Link href="/simulation">
                <Button variant="ghost" size="sm" className="w-full mt-4">Open Simulation Engine</Button>
              </Link>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Recent Orders" hint="Latest across all channels" />
              <div className="space-y-1.5">
                {data.recentOrders.map((o: any) => (
                  <div key={o.id} className="flex items-center gap-3 text-sm rounded-xl px-3 py-2 hover:bg-[var(--panel-2)] transition-colors">
                    <span className="font-mono text-xs text-muted">{o.orderNumber}</span>
                    <Badge tone={o.type === "dine_in" ? "sky" : o.type === "takeaway" ? "amber" : "violet"}>{o.type.replace("_", " ")}</Badge>
                    {o.source === "simulation" && <Badge tone="violet">sim</Badge>}
                    <span className={cn("ml-auto rounded-lg border px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLES[o.status])}>{o.status}</span>
                    <span className="font-semibold w-20 text-right">{formatCents(o.totalCents)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Recent Transactions" hint="Latest settled payments"
                action={<div className="flex items-center gap-2 text-xs text-muted"><Users size={13} /> {data.customers.new} new guests · {data.customers.total} total</div>} />
              <div className="space-y-1.5">
                {data.recentTransactions.length === 0 && <p className="text-sm text-muted">No payments yet.</p>}
                {data.recentTransactions.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-3 text-sm rounded-xl px-3 py-2 hover:bg-[var(--panel-2)] transition-colors">
                    <span className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><ArrowUpRight size={14} /></span>
                    <span className="font-mono text-xs text-muted">{t.orderNumber}</span>
                    {t.source === "simulation" && <Badge tone="violet">sim</Badge>}
                    <Badge tone="slate">{t.method}</Badge>
                    <span className="ml-auto text-xs text-faint">{timeAgo(t.createdAt)}</span>
                    <span className="font-semibold text-emerald-400 w-20 text-right">{formatCents(t.amountCents)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
