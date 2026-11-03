"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ChefHat, Clock, Flame, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, Badge, Button, EmptyState, useApi, useToast } from "@/components/ui";
import { cn, elapsed, formatCents } from "@/lib/utils";

const COLUMNS = [
  { key: "confirmed", title: "Incoming", tone: "text-sky-400", action: "start_prepare", actionLabel: "Start Preparing", next: ["start_prepare"] },
  { key: "preparing", title: "Preparing", tone: "text-amber-400", action: "ready", actionLabel: "Mark Ready", next: ["ready"] },
  { key: "ready", title: "Ready for Service", tone: "text-emerald-400", action: "serve", actionLabel: "Mark Served", next: ["serve"] },
] as const;

export default function KitchenPage() {
  const toast = useToast();
  const { data } = useApi<any>("/api/orders?open=true&limit=120", { interval: 2500 });
  const [details, setDetails] = useState<Record<number, any>>({});
  const orders = (data?.orders ?? []).map((r: any) => r.order ? { ...r.order, tableName: r.tableName } : r);

  // Load item details for open orders
  useEffect(() => {
    const missing = orders.filter((o: any) => ["confirmed", "preparing", "ready"].includes(o.status) && !details[o.id]);
    missing.forEach(async (o: any) => {
      try {
        const d = await apiFetch(`/api/orders/${o.id}`);
        setDetails((prev) => ({ ...prev, [o.id]: d }));
      } catch { /* ignore */ }
    });
  }, [orders, details]);

  const act = async (id: number, action: string, label: string) => {
    try {
      await apiFetch(`/api/orders/${id}`, "PATCH", { action });
      toast.push(label, "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Action failed", "error");
    }
  };

  const urgency = (o: any) => {
    const mins = (Date.now() - new Date(o.updatedAt ?? o.createdAt).getTime()) / 60000;
    return mins > 20 ? "border-rose-500/50" : mins > 10 ? "border-amber-500/40" : "border-[var(--border)]";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2.5">
            Kitchen Display <ChefHat className="text-amber-400" size={22} />
          </h1>
          <p className="text-sm text-muted mt-0.5">Real-time order pipeline · updates every 2.5s</p>
        </div>
        <div className="flex gap-2 text-xs text-muted">
          <Badge tone="sky">{orders.filter((o: any) => o.status === "confirmed").length} incoming</Badge>
          <Badge tone="amber">{orders.filter((o: any) => o.status === "preparing").length} cooking</Badge>
          <Badge tone="emerald">{orders.filter((o: any) => o.status === "ready").length} ready</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {COLUMNS.map((col) => {
          const list = orders.filter((o: any) => o.status === col.key);
          return (
            <div key={col.key} className="panel rounded-2xl p-4 min-h-[420px]">
              <div className="flex items-center justify-between mb-4">
                <h2 className={cn("font-display font-semibold text-sm uppercase tracking-wider", col.tone)}>{col.title}</h2>
                <span className="text-xs font-bold w-6 h-6 rounded-lg bg-[var(--panel-2)] flex items-center justify-center">{list.length}</span>
              </div>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {list.map((o: any) => {
                    const d = details[o.id];
                    return (
                      <motion.div
                        key={o.id}
                        layout
                        layoutId={`order-${o.id}`}
                        initial={{ opacity: 0, y: 14, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className={cn("rounded-xl border bg-[var(--panel-2)] p-3.5", urgency(o))}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs font-semibold text-amber-400">{o.orderNumber}</span>
                          <span className="flex items-center gap-1 text-[11px] text-muted"><Clock size={11} /> <ElapsedInline start={o.updatedAt ?? o.createdAt} /></span>
                        </div>
                        <div className="flex gap-1.5 mb-2.5">
                          <Badge tone="slate">{o.type.replace("_", " ")}</Badge>
                          {o.tableName && <Badge tone="sky">{o.tableName}</Badge>}
                          {o.source === "simulation" && <Badge tone="violet">sim</Badge>}
                        </div>
                        {d && (
                          <ul className="text-sm space-y-1 mb-3">
                            {d.items.map((it: any) => (
                              <li key={it.id}>
                                <span className="font-semibold">{it.quantity}×</span> {it.productName}
                                {it.modifiers?.length > 0 && <p className="text-[11px] text-muted pl-5">+ {it.modifiers.map((m: any) => m.name).join(", ")}</p>}
                                {it.instructions && <p className="text-[11px] text-sky-400 pl-5">“{it.instructions}”</p>}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-faint">{formatCents(o.totalCents)}</span>
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="primary" onClick={() => act(o.id, col.action, col.key === "ready" ? "Order served" : col.key === "preparing" ? "Order is ready for service" : "Started preparing order")}>
                              {col.actionLabel}
                            </Button>
                            {col.key === "confirmed" && <Button size="sm" variant="danger" onClick={() => act(o.id, "cancel", "Order cancelled")}>✕</Button>}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {list.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-xs text-faint">
                    {col.key === "confirmed" ? "No incoming orders" : col.key === "preparing" ? "Nothing on the line" : "Nothing waiting"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ElapsedInline({ start }: { start: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{elapsed(start)}</span>;
}
