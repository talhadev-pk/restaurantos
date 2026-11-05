"use client";
import { ArrowDownRight, ArrowUpRight, Plus, RotateCcw, Wallet } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, CardHeader, Field, Input, Modal, Segmented, Select, Spinner, Stat, useApi, useToast } from "../ui";
import { cn, formatCents, timeAgo } from "@/lib/utils";

const CATS = ["rent", "utilities", "payroll", "marketing", "equipment", "general"];

export default function FinancePage() {
  const toast = useToast();
  const [range, setRange] = useState("30d");
  const { data: dash } = useApi<any>(`/api/dashboard?range=${range}`, { interval: 12000 });
  const { data: expData, refetch } = useApi<any>(`/api/expenses?range=${range}`);
  const { data: ordersData, refetch: refetchOrders } = useApi<any>(`/api/orders?range=${range}&limit=150`);
  const [expOpen, setExpOpen] = useState(false);

  const k = dash?.kpis;
  const completedOrders = (ordersData?.orders ?? []).filter((r: any) => r.order.status === "completed");

  const refund = async (id: number) => {
    const reason = prompt("Refund reason:", "Customer requested refund") ?? "";
    try {
      await apiFetch(`/api/orders/${id}`, "PATCH", { action: "refund", reason });
      toast.push("Order refunded — inventory restored, refund recorded.", "success");
      refetchOrders();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Financial Management</h1>
          <p className="text-sm text-muted mt-0.5">Revenue → COGS → gross profit → expenses → net profit</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setExpOpen(true)}><Plus size={14} /> Record expense</Button>
          <Segmented options={[{ value: "today", label: "Today" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "all", label: "All" }]} value={range} onChange={setRange} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Stat label="Revenue" value={formatCents(k?.revenue ?? 0)} icon={<ArrowUpRight size={16} />} sub={k?.refunds ? `after ${formatCents(k.refunds)} refunds` : undefined} tone="text-emerald-400" />
        <Stat label="COGS" value={formatCents(k?.cogs ?? 0)} icon={<Wallet size={16} />} sub="from recipe ingredient costs" />
        <Stat label="Gross Profit" value={formatCents(k?.grossProfit ?? 0)} icon={<ArrowUpRight size={16} />} tone={(k?.grossProfit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"} />
        <Stat label="Net Profit" value={formatCents(k?.netProfit ?? 0)} icon={<ArrowDownRight size={16} />} sub={`after ${formatCents(k?.expenses ?? 0)} expenses`} tone={(k?.netProfit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Operating Expenses" hint={dash?.rangeLabel} />
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {(expData?.expenses ?? []).map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 text-sm rounded-xl px-3 py-2 hover:bg-[var(--panel-2)] group">
                <span className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0"><ArrowDownRight size={14} /></span>
                <div className="min-w-0">
                  <p className="truncate">{e.description}</p>
                  <p className="text-[11px] text-faint capitalize">{e.category} · {new Date(e.incurredAt).toLocaleDateString()}</p>
                </div>
                <span className="ml-auto font-semibold text-rose-300">−{formatCents(e.amountCents)}</span>
                <button onClick={async () => { if (confirm("Delete this expense?")) { await apiFetch(`/api/expenses?id=${e.id}`, "DELETE"); refetch(); } }}
                  className="opacity-0 group-hover:opacity-100 text-faint hover:text-rose-400 text-xs transition-opacity">✕</button>
              </div>
            ))}
            {(expData?.expenses ?? []).length === 0 && <p className="text-sm text-muted text-center py-6">No expenses in this range.</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payments & Refunds" hint="Settled orders in range — refund restores inventory" />
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {completedOrders.map((r: any) => (
              <div key={r.order.id} className="flex items-center gap-3 text-sm rounded-xl px-3 py-2 hover:bg-[var(--panel-2)]">
                <span className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"><ArrowUpRight size={14} /></span>
                <span className="font-mono text-xs text-muted">{r.order.orderNumber}</span>
                {r.order.source === "simulation" && <Badge tone="violet">sim</Badge>}
                <span className="text-xs text-faint">COGS {formatCents(r.order.cogsCents)}</span>
                <span className="ml-auto font-semibold text-emerald-400">{formatCents(r.order.totalCents)}</span>
                <Button size="sm" variant="subtle" onClick={() => refund(r.order.id)} title="Refund"><RotateCcw size={13} /></Button>
              </div>
            ))}
            {completedOrders.length === 0 && <p className="text-sm text-muted text-center py-6">No settled payments in this range.</p>}
          </div>
        </Card>
      </div>

      <Modal open={expOpen} onClose={() => setExpOpen(false)} title="Record Expense">
        <ExpenseForm onDone={() => { setExpOpen(false); refetch(); }} />
      </Modal>
    </div>
  );
}

function ExpenseForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ category: "general", description: "", amount: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/expenses", "POST", { category: f.category, description: f.description, amountCents: Math.round(parseFloat(f.amount) * 100) });
        toast.push("Expense recorded.", "success");
        onDone();
      } catch (err) { toast.push(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); }
    }}>
      <Field label="Category">
        <Select value={f.category} onChange={(e: any) => setF({ ...f, category: e.target.value })}>
          {CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
        </Select>
      </Field>
      <Field label="Description"><Input value={f.description} onChange={(e: any) => setF({ ...f, description: e.target.value })} placeholder="e.g. Monthly rent" required /></Field>
      <Field label="Amount ($)"><Input type="number" min="0.01" step="0.01" value={f.amount} onChange={(e: any) => setF({ ...f, amount: e.target.value })} required /></Field>
      <Button variant="primary" className="w-full" loading={busy}>Save expense</Button>
    </form>
  );
}
