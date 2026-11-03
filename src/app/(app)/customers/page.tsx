"use client";
import { Plus, Star, Users } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner, useApi, useToast } from "@/components/ui";
import { cn, formatCents, timeAgo } from "@/lib/utils";

const SEG_TONES: Record<string, string> = { vip: "amber", regular: "sky", new: "slate" };

export default function CustomersPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/customers");
  const [detail, setDetail] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const customers = data?.customers ?? [];
  const segments = customers.reduce((acc: Record<string, number>, c: any) => { acc[c.segment] = (acc[c.segment] ?? 0) + 1; return acc; }, {});

  const open = async (id: number) => setDetail(await apiFetch(`/api/customers?id=${id}`));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted mt-0.5">
            {customers.length} profiles ·
            <span className="text-amber-300"> {segments.vip ?? 0} VIP</span> ·
            <span className="text-sky-300"> {segments.regular ?? 0} regular</span> ·
            <span className="text-muted"> {segments.new ?? 0} new</span>
            <span className="text-faint"> · fictional people power the simulation</span>
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New customer</Button>
      </div>

      {loading ? <Spinner label="Loading guests…" /> : customers.length === 0 ? (
        <Card><EmptyState title="No customers yet" hint="Create one, or let the simulation engine invent guests." icon={<Users size={22} />} /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {customers.map((c: any) => (
            <button key={c.id} onClick={() => open(c.id)} className="text-left">
              <Card className="hover:border-[var(--border-strong)] transition-colors h-full">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/30 to-purple-600/20 flex items-center justify-center font-display font-bold text-violet-300">
                    {c.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                  </div>
                  <div className="flex gap-1.5">
                    <Badge tone={SEG_TONES[c.segment]}>{c.segment}</Badge>
                    {c.isVirtual && <Badge tone="violet">sim</Badge>}
                  </div>
                </div>
                <p className="font-display font-semibold">{c.name}</p>
                <p className="text-xs text-muted">{c.phone || "no phone"} {c.email ? `· ${c.email}` : ""}</p>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-[var(--panel-2)] py-1.5"><p className="text-sm font-bold">{c.visits}</p><p className="text-[9px] text-faint uppercase">visits</p></div>
                  <div className="rounded-lg bg-[var(--panel-2)] py-1.5"><p className="text-sm font-bold">{formatCents(c.totalSpentCents)}</p><p className="text-[9px] text-faint uppercase">spent</p></div>
                  <div className="rounded-lg bg-[var(--panel-2)] py-1.5"><p className="text-sm font-bold text-amber-400 flex items-center justify-center gap-1"><Star size={11} />{c.loyaltyPoints}</p><p className="text-[9px] text-faint uppercase">points</p></div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.customer?.name ?? "Customer"} width="max-w-xl">
        {detail && (
          <div>
            <div className="flex gap-2 mb-4">
              <Badge tone={SEG_TONES[detail.customer.segment]}>{detail.customer.segment}</Badge>
              {detail.customer.isVirtual && <Badge tone="violet">simulated guest</Badge>}
              <Badge tone="slate">{detail.customer.visits} visits</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="rounded-xl bg-[var(--panel-2)] p-3">
                <p className="text-[10px] text-faint uppercase">Lifetime spend</p>
                <p className="font-display font-bold text-lg text-emerald-400">{formatCents(detail.customer.totalSpentCents)}</p>
              </div>
              <div className="rounded-xl bg-[var(--panel-2)] p-3">
                <p className="text-[10px] text-faint uppercase">Loyalty points</p>
                <p className="font-display font-bold text-lg text-amber-400">{detail.customer.loyaltyPoints}</p>
              </div>
            </div>
            <p className="text-xs font-medium text-muted mb-2">Order history</p>
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {detail.history.length === 0 && <p className="text-sm text-muted py-4 text-center">No orders yet.</p>}
              {detail.history.map((o: any) => (
                <div key={o.id} className="flex items-center gap-3 text-sm rounded-lg px-3 py-2 hover:bg-[var(--panel-2)]">
                  <span className="font-mono text-xs text-muted">{o.orderNumber}</span>
                  <Badge tone="slate">{o.type.replace("_", " ")}</Badge>
                  <Badge tone={o.status === "completed" ? "emerald" : o.status === "cancelled" ? "rose" : "sky"}>{o.status}</Badge>
                  <span className="ml-auto text-xs text-faint">{timeAgo(o.createdAt)}</span>
                  <span className="font-semibold w-20 text-right">{formatCents(o.totalCents)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Customer">
        <CreateForm onDone={() => { setCreateOpen(false); refetch(); }} />
      </Modal>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/customers", "POST", f);
        toast.push("Customer created.", "success");
        onDone();
      } catch (err) { toast.push(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); }
    }}>
      <Field label="Full name"><Input value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><Input value={f.phone} onChange={(e: any) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e: any) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
      <Button variant="primary" className="w-full" loading={busy}>Create customer</Button>
    </form>
  );
}
