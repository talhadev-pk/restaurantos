"use client";
import { CheckCheck, PackageCheck, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Spinner, TableShell, useApi, useToast } from "../ui";
import { cn, formatCents, formatQty, timeAgo } from "@/lib/utils";

const PO_TONES: Record<string, string> = { draft: "slate", approved: "sky", partially_received: "amber", received: "emerald", cancelled: "rose" };

export default function PurchasingPage() {
  const toast = useToast();
  const { data: poData, loading, refetch } = useApi<any>("/api/purchases");
  const { data: supData, refetch: refetchSup } = useApi<any>("/api/suppliers");
  const { data: invData } = useApi<any>("/api/inventory");
  const [newPo, setNewPo] = useState(false);
  const [newSup, setNewSup] = useState(false);
  const [receivePo, setReceivePo] = useState<any | null>(null);

  const act = async (id: number, action: string, extra: any = {}) => {
    try {
      await apiFetch(`/api/purchases/${id}`, "PATCH", { action, ...extra });
      toast.push(action === "approve" ? "Purchase order approved." : "Purchase order updated.", "success");
      refetch();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const suppliers = supData?.suppliers ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Suppliers & Purchasing</h1>
          <p className="text-sm text-muted mt-0.5">Receiving goods increases stock and records purchase movements</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setNewSup(true)}><Plus size={14} /> Supplier</Button>
          <Button variant="primary" size="sm" onClick={() => setNewPo(true)}><Plus size={14} /> Purchase Order</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {loading ? <Card><Spinner label="Loading purchase orders…" /></Card> : (
            <>
              {(poData?.purchaseOrders ?? []).map((po: any) => (
                <Card key={po.id}>
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <span className="font-display font-bold">PO #{po.id}</span>
                    <Badge tone={PO_TONES[po.status]}>{po.status.replace("_", " ")}</Badge>
                    <span className="text-xs text-muted">{po.supplierName}</span>
                    <span className="ml-auto font-display font-bold text-amber-400">{formatCents(po.totalCostCents)}</span>
                    <span className="text-xs text-faint">{timeAgo(po.createdAt)}</span>
                  </div>
                  <div className="space-y-1 mb-3">
                    {po.items.map((it: any) => (
                      <div key={it.item.id} className="flex items-center justify-between text-xs text-muted rounded-lg bg-[var(--panel-2)] px-3 py-2">
                        <span>{it.ingredientName}</span>
                        <span className="font-mono">
                          received {formatQty(it.item.receivedQty, it.unit)} / {formatQty(it.item.quantity, it.unit)} · {formatCents(Math.round(it.item.quantity * it.item.unitCostCents))}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {po.status === "draft" && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => act(po.id, "approve")}><CheckCheck size={13} /> Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => act(po.id, "cancel")}>Cancel</Button>
                      </>
                    )}
                    {["approved", "partially_received"].includes(po.status) && (
                      <Button size="sm" variant="success" onClick={() => setReceivePo(po)}><PackageCheck size={13} /> Receive goods</Button>
                    )}
                  </div>
                </Card>
              ))}
              {(poData?.purchaseOrders ?? []).length === 0 && (
                <Card><p className="text-sm text-muted text-center py-6">No purchase orders yet. Create one to replenish stock.</p></Card>
              )}
            </>
          )}
        </div>

        <Card className="self-start">
          <CardHeader title="Suppliers" hint={`${suppliers.length} registered`} />
          <div className="space-y-2.5">
            {suppliers.map((sup: any) => (
              <div key={sup.id} className="rounded-xl border border-[var(--border)] p-3.5">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{sup.name}</p>
                  <Badge tone={sup.active ? "emerald" : "rose"}>{sup.active ? "active" : "inactive"}</Badge>
                </div>
                <p className="text-xs text-muted mt-1">{sup.contactName}</p>
                <p className="text-[11px] text-faint">{sup.email} · {sup.phone}</p>
                <button className="text-[11px] text-amber-400 hover:underline mt-1.5"
                  onClick={async () => {
                    await apiFetch(`/api/suppliers?id=${sup.id}`, "PATCH", { active: !sup.active });
                    refetchSup();
                  }}>
                  {sup.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal open={newPo} onClose={() => setNewPo(false)} title="New Purchase Order" width="max-w-xl">
        <NewPoForm suppliers={suppliers} ingredients={invData?.ingredients ?? []} onDone={() => { setNewPo(false); refetch(); }} />
      </Modal>
      <Modal open={newSup} onClose={() => setNewSup(false)} title="New Supplier">
        <NewSupplierForm onDone={() => { setNewSup(false); refetchSup(); }} />
      </Modal>
      <Modal open={!!receivePo} onClose={() => setReceivePo(null)} title={receivePo ? `Receive goods — PO #${receivePo.id}` : ""} width="max-w-xl">
        {receivePo && <ReceiveForm po={receivePo} onDone={() => { setReceivePo(null); refetch(); }} />}
      </Modal>
    </div>
  );
}

function NewPoForm({ suppliers, ingredients, onDone }: { suppliers: any[]; ingredients: any[]; onDone: () => void }) {
  const toast = useToast();
  const [supplierId, setSupplierId] = useState<number | "">(suppliers[0]?.id ?? "");
  const [lines, setLines] = useState([{ ingredientId: ingredients[0]?.id ?? 0, quantity: 0, unitCost: 0 }]);
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((a, l) => a + l.quantity * l.unitCost, 0);
  return (
    <div className="space-y-4">
      <Field label="Supplier">
        <Select value={supplierId} onChange={(e: any) => setSupplierId(Number(e.target.value))}>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const ing = ingredients.find((x) => x.id === l.ingredientId);
          return (
            <div key={i} className="flex items-center gap-2">
              <Select value={l.ingredientId} onChange={(e: any) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredientId: Number(e.target.value) } : x)))}>
                {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
              </Select>
              <Input type="number" min="0" step="any" placeholder="Qty" className="w-24" value={l.quantity || ""}
                onChange={(e: any) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <Input type="number" min="0" step="0.01" placeholder="$/unit" className="w-24" value={l.unitCost || ""}
                onChange={(e: any) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: Number(e.target.value) } : x)))} />
              <span className="text-xs text-faint w-8">{ing?.unit}</span>
            </div>
          );
        })}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { ingredientId: ingredients[0]?.id ?? 0, quantity: 0, unitCost: 0 }])}><Plus size={13} /> Add line</Button>
      <div className="flex items-center justify-between rounded-xl bg-[var(--panel-2)] px-4 py-3">
        <span className="text-sm text-muted">Order total</span>
        <span className="font-display font-bold text-lg text-amber-400">{formatCents(Math.round(total * 100))}</span>
      </div>
      <Button variant="primary" className="w-full" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await apiFetch("/api/purchases", "POST", {
            supplierId: Number(supplierId),
            items: lines.filter((l) => l.quantity > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, unitCostCents: Math.round(l.unitCost * 100) })),
          });
          toast.push("Purchase order created as draft.", "success");
          onDone();
        } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
      }}>Create purchase order</Button>
    </div>
  );
}

function NewSupplierForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", contactName: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/suppliers", "POST", f);
        toast.push("Supplier registered.", "success");
        onDone();
      } catch (err) { toast.push(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); }
    }}>
      <Field label="Company name"><Input value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact person"><Input value={f.contactName} onChange={(e: any) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e: any) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <Field label="Email"><Input type="email" value={f.email} onChange={(e: any) => setF({ ...f, email: e.target.value })} /></Field>
      <Button variant="primary" className="w-full" loading={busy}>Add supplier</Button>
    </form>
  );
}

function ReceiveForm({ po, onDone }: { po: any; onDone: () => void }) {
  const toast = useToast();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Enter quantities delivered. Stock increases immediately and the movement is recorded.</p>
      {po.items.filter((it: any) => it.item.receivedQty < it.item.quantity).map((it: any) => (
        <div key={it.item.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5">
          <div className="flex-1">
            <p className="text-sm font-medium">{it.ingredientName}</p>
            <p className="text-[11px] text-muted">remaining {formatQty(it.item.quantity - it.item.receivedQty, it.unit)}</p>
          </div>
          <Input type="number" min="0" step="any" className="w-28" placeholder={`0 ${it.unit}`}
            value={qtys[it.item.id] ?? ""} onChange={(e: any) => setQtys({ ...qtys, [it.item.id]: e.target.value })} />
        </div>
      ))}
      <Button variant="primary" className="w-full" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          const received = Object.entries(qtys).map(([itemId, q]) => ({ itemId: Number(itemId), qty: Number(q) })).filter((r) => r.qty >= 0 && qStr(r.qty));
          if (!received.length) { toast.push("Enter at least one delivered quantity.", "info"); return; }
          await apiFetch(`/api/purchases/${po.id}`, "PATCH", { action: "receive", received });
          toast.push("Goods received — inventory updated.", "success");
          onDone();
        } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
        function qStr(q: number) { return q > 0; }
      }}>Confirm delivery</Button>
    </div>
  );
}
