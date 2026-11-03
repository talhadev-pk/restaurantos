"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus, Printer, Receipt, Search, ShoppingBag, Store, Trash2, Truck, UtensilsCrossed, X } from "lucide-react";
import { useMemo, useState } from "react";
import { apiFetch, Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner, useApi, useToast } from "@/components/ui";
import { cn, formatCents, PRODUCT_COLORS, STATUS_STYLES } from "@/lib/utils";

type Product = { id: number; name: string; description: string; priceCents: number; taxRateBp: number; color: string; available: boolean; categoryId: number | null };
type Modifier = { id: number; productId: number; name: string; priceDeltaCents: number };
type CartLine = { product: Product; qty: number; modifiers: Modifier[]; instructions: string };

export default function PosPage() {
  const toast = useToast();
  const { data: menuData, refetch: refetchMenu } = useApi<any>("/api/menu/products", { interval: 10000 });
  const { data: catData } = useApi<any>("/api/menu/categories");
  const { data: modData } = useApi<any>("/api/menu/modifiers", { interval: 10000 });
  const { data: tableData } = useApi<any>("/api/tables", { interval: 8000 });
  const { data: custData } = useApi<any>("/api/customers");
  const { data: openOrdersData, refetch: refetchOpen } = useApi<any>("/api/orders?open=true", { interval: 5000 });

  const [query, setQuery] = useState("");
  const [catId, setCatId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [type, setType] = useState<"dine_in" | "takeaway" | "delivery">("dine_in");
  const [tableId, setTableId] = useState<number | "">("");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [discount, setDiscount] = useState("0");
  const [busy, setBusy] = useState(false);
  const [pickModifiers, setPickModifiers] = useState<Product | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [payFor, setPayFor] = useState<any | null>(null);

  const products: Product[] = (menuData?.products ?? []).map((r: any) => r.product).filter((p: Product) => p.available);
  const modifiers: Modifier[] = modData?.modifiers ?? [];
  const categories = (catData?.categories ?? []).filter((c: any) => c.active);

  const visible = useMemo(
    () => products.filter((p) => (!catId || p.categoryId === catId) && p.name.toLowerCase().includes(query.toLowerCase())),
    [products, catId, query],
  );

  const lineUnit = (l: CartLine) => l.product.priceCents + l.modifiers.reduce((a, m) => a + m.priceDeltaCents, 0);
  const subtotal = cart.reduce((a, l) => a + lineUnit(l) * l.qty, 0);
  const tax = cart.reduce((a, l) => a + Math.round((lineUnit(l) * l.qty * l.product.taxRateBp) / 10000), 0);
  const discountCents = Math.min(subtotal, Math.max(0, Math.round(parseFloat(discount || "0") * 100) || 0));
  const total = Math.max(0, subtotal - discountCents) + tax;

  const addToCart = (p: Product, mods: Modifier[] = [], instructions = "") => {
    setCart((prev) => {
      const key = (l: CartLine) => l.product.id + "|" + l.modifiers.map((m) => m.id).sort().join(",") + "|" + l.instructions;
      const next = [...prev];
      const idx = next.findIndex((l) => key(l) === p.id + "|" + mods.map((m) => m.id).sort().join(",") + "|" + instructions);
      if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      else next.push({ product: p, qty: 1, modifiers: mods, instructions });
      return next;
    });
  };
  const setQty = (i: number, delta: number) =>
    setCart((prev) => prev.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + delta) } : l)).filter((l) => l.qty > 0));

  const submitOrder = async (autoConfirm: boolean) => {
    if (!cart.length) return toast.push("Add at least one item to the order.", "info");
    if (type === "dine_in" && !tableId) return toast.push("Select a table for this dine-in order.", "info");
    setBusy(true);
    try {
      const { order } = await apiFetch<any>("/api/orders", "POST", {
        type,
        tableId: type === "dine_in" ? Number(tableId) : null,
        customerId: customerId ? Number(customerId) : null,
        discountCents,
        autoConfirm,
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.qty, modifierIds: l.modifiers.map((m) => m.id), instructions: l.instructions })),
      });
      toast.push(`Order ${order.orderNumber} created${autoConfirm ? " and sent to the kitchen" : ""}.`, "success");
      setCart([]); setDiscount("0");
      refetchOpen();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed to create order", "error");
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = async (id: number) => setReceipt(await apiFetch(`/api/orders/${id}`));
  const act = async (id: number, action: string, paymentMethod?: string) => {
    try {
      await apiFetch(`/api/orders/${id}`, "PATCH", { action, paymentMethod });
      toast.push(action === "complete" ? "Payment recorded — order completed." : `Order ${action}d.`, "success");
      setPayFor(null);
      refetchOpen();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Action failed", "error");
    }
  };

  const tables = (tableData?.tables ?? []).map((r: any) => r.table);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">
      {/* Catalog */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h1 className="font-display text-2xl font-bold tracking-tight">Point of Sale</h1>
          <div className="relative flex-1 max-w-xs ml-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input className="pl-9" placeholder="Search menu…" value={query} onChange={(e: any) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button onClick={() => setCatId(null)} className={cn("px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap", !catId ? "border-amber-400/50 text-amber-300 bg-amber-500/10" : "border-[var(--border)] text-muted hover:text-[var(--text)]")}>All</button>
          {categories.map((c: any) => (
            <button key={c.id} onClick={() => setCatId(c.id)} className={cn("px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap", catId === c.id ? "border-amber-400/50 text-amber-300 bg-amber-500/10" : "border-[var(--border)] text-muted hover:text-[var(--text)]")}>{c.name}</button>
          ))}
        </div>
        {!menuData ? <Spinner label="Loading menu…" /> : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {visible.map((p: Product, i: number) => {
              const hasMods = modifiers.some((m) => m.productId === p.id);
              return (
                <motion.button
                  key={p.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => (hasMods ? setPickModifiers(p) : addToCart(p))}
                  className="text-left panel p-4 hover:border-[var(--border-strong)] transition-all group"
                >
                  <div className={cn("h-16 rounded-xl bg-gradient-to-br flex items-end p-2 mb-3", PRODUCT_COLORS[p.color] ?? PRODUCT_COLORS.amber)}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{p.name.slice(0, 2)}</span>
                  </div>
                  <p className="text-sm font-semibold leading-tight">{p.name}</p>
                  <p className="text-[11px] text-muted mt-0.5 line-clamp-1">{p.description}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-display font-bold text-amber-400">{formatCents(p.priceCents)}</span>
                    {hasMods && <Badge tone="sky">options</Badge>}
                  </div>
                </motion.button>
              );
            })}
            {visible.length === 0 && <div className="col-span-full"><EmptyState title="No products match" hint="Try another search or category." /></div>}
          </div>
        )}

        {/* Open orders */}
        <Card className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold">Open Orders</h3>
            <Badge tone="sky">{openOrdersData?.orders?.length ?? 0} active</Badge>
          </div>
          <div className="space-y-2">
            {(openOrdersData?.orders ?? []).map((o: any) => (
              <motion.div layout key={o.order.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5">
                <button onClick={() => openReceipt(o.order.id)} className="font-mono text-xs text-amber-400 hover:underline">{o.order.orderNumber}</button>
                <Badge tone="slate">{o.order.type.replace("_", " ")}</Badge>
                {o.tableName && <Badge tone="sky">{o.tableName}</Badge>}
                {o.order.source === "simulation" && <Badge tone="violet">sim</Badge>}
                <span className="text-xs text-muted">{o.itemCount} item{o.itemCount > 1 ? "s" : ""}</span>
                <span className={cn("rounded-lg border px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLES[o.order.status])}>{o.order.status}</span>
                <span className="ml-auto font-semibold text-sm">{formatCents(o.order.totalCents)}</span>
                <div className="flex gap-1.5">
                  {["ready", "served", "pending", "confirmed"].includes(o.order.status) && o.order.status !== "pending" && (o.order.status === 'ready' || o.order.status === 'served') && (
                    <Button size="sm" variant="success" onClick={() => setPayFor(o.order)}>Charge</Button>
                  )}
                  {["pending"].includes(o.order.status) && <Button size="sm" variant="ghost" onClick={() => act(o.order.id, "confirm")}>Send to kitchen</Button>}
                  {!["completed", "cancelled"].includes(o.order.status) && (
                    <Button size="sm" variant="danger" onClick={() => act(o.order.id, "cancel")}>Cancel</Button>
                  )}
                </div>
              </motion.div>
            ))}
            {(openOrdersData?.orders ?? []).length === 0 && <p className="text-sm text-muted py-3 text-center">No open orders — the floor is quiet.</p>}
          </div>
        </Card>
      </div>

      {/* Cart */}
      <div className="panel rounded-2xl p-5 self-start sticky top-[72px]">
        <h3 className="font-display font-semibold flex items-center gap-2 mb-4"><ShoppingBag size={16} className="text-amber-400" /> Current Order</h3>
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {([
            ["dine_in", "Dine-in", UtensilsCrossed],
            ["takeaway", "Takeaway", ShoppingBag],
            ["delivery", "Delivery", Truck],
          ] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => setType(v)}
              className={cn("flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-medium transition-all", type === v ? "border-amber-400/50 bg-amber-500/10 text-amber-300" : "border-[var(--border)] text-muted hover:text-[var(--text)]")}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
        <div className="space-y-2.5 mb-4">
          {type === "dine_in" && (
            <Select value={tableId} onChange={(e: any) => setTableId(e.target.value)}>
              <option value="">Select table…</option>
              {tables.map((t: any) => (
                <option key={t.id} value={t.id} disabled={t.status !== "available"}>
                  {t.name} · seats {t.capacity}{t.status !== "available" ? ` (${t.status})` : ""}
                </option>
              ))}
            </Select>
          )}
          <Select value={customerId} onChange={(e: any) => setCustomerId(e.target.value)}>
            <option value="">Walk-in guest (no profile)</option>
            {(custData?.customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.isVirtual ? " ·sim" : ""}</option>)}
          </Select>
        </div>

        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {cart.map((l, i) => (
              <motion.div key={i} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{l.product.name}</p>
                    {l.modifiers.length > 0 && <p className="text-[11px] text-muted mt-0.5">+ {l.modifiers.map((m) => m.name).join(", ")}</p>}
                    {l.instructions && <p className="text-[11px] text-sky-400 mt-0.5">“{l.instructions}”</p>}
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap">{formatCents(lineUnit(l) * l.qty)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(i, -1)} className="w-6 h-6 rounded-lg border border-[var(--border)] flex items-center justify-center text-muted hover:text-[var(--text)]"><Minus size={12} /></button>
                    <span className="w-7 text-center text-sm font-semibold">{l.qty}</span>
                    <button onClick={() => setQty(i, 1)} className="w-6 h-6 rounded-lg border border-[var(--border)] flex items-center justify-center text-muted hover:text-[var(--text)]"><Plus size={12} /></button>
                  </div>
                  <button onClick={() => setQty(i, -l.qty)} className="text-faint hover:text-rose-400 transition-colors"><Trash2 size={14} /></button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {cart.length === 0 && <p className="text-sm text-muted text-center py-6">Tap menu items to build an order.</p>}
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-2 text-sm">
          <div className="flex justify-between text-muted"><span>Subtotal</span><span>{formatCents(subtotal)}</span></div>
          <div className="flex justify-between text-muted items-center">
            <span>Discount ($)</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ""))} className="w-20 text-right rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-sm outline-none focus:border-amber-400/50" />
          </div>
          <div className="flex justify-between text-muted"><span>Tax</span><span>{formatCents(tax)}</span></div>
          <div className="flex justify-between font-display font-bold text-lg pt-1"><span>Total</span><span className="text-amber-400">{formatCents(total)}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Button variant="ghost" loading={busy} onClick={() => submitOrder(false)}>Save pending</Button>
          <Button variant="primary" loading={busy} onClick={() => submitOrder(true)}>Send to kitchen</Button>
        </div>
      </div>

      {/* Modifiers modal */}
      <ModifierPicker product={pickModifiers} modifiers={modifiers.filter((m) => m.productId === pickModifiers?.id)}
        onClose={() => setPickModifiers(null)}
        onAdd={(mods, instructions) => { if (pickModifiers) addToCart(pickModifiers, mods, instructions); setPickModifiers(null); }} />

      {/* Payment modal */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title="Complete & Charge">
        {payFor && (
          <PaymentForm total={payFor.totalCents} onConfirm={(m) => act(payFor.id, "complete", m)} />
        )}
      </Modal>

      {/* Receipt modal */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={<span className="flex items-center gap-2"><Receipt size={17} className="text-amber-400" /> Receipt</span>}>
        {receipt && <ReceiptView data={receipt} />}
      </Modal>
    </div>
  );
}

function ModifierPicker({ product, modifiers, onClose, onAdd }: { product: Product | null; modifiers: Modifier[]; onClose: () => void; onAdd: (mods: Modifier[], instructions: string) => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const [instructions, setInstructions] = useState("");
  return (
    <Modal open={!!product} onClose={onClose} title={product?.name ?? ""}>
      <p className="text-xs text-muted mb-3">Customise this item</p>
      <div className="space-y-2 mb-4">
        {modifiers.map((m) => (
          <button key={m.id}
            onClick={() => setSel((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))}
            className={cn("w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm transition-all", sel.includes(m.id) ? "border-amber-400/50 bg-amber-500/10" : "border-[var(--border)] hover:bg-[var(--panel-2)]")}>
            <span>{m.name}</span>
            <span className="text-amber-400 font-medium">+{formatCents(m.priceDeltaCents)}</span>
          </button>
        ))}
      </div>
      <Input placeholder="Special instructions (e.g. no onions)…" value={instructions} onChange={(e: any) => setInstructions(e.target.value)} />
      <Button variant="primary" className="w-full mt-4" onClick={() => onAdd(modifiers.filter((m) => sel.includes(m.id)), instructions)}>
        <Plus size={15} /> Add to order
      </Button>
    </Modal>
  );
}

function PaymentForm({ total, onConfirm }: { total: number; onConfirm: (method: string) => void }) {
  const [method, setMethod] = useState("card");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p className="text-center text-muted text-sm">Amount due</p>
      <p className="text-center font-display text-4xl font-bold text-amber-400 my-2">{formatCents(total)}</p>
      <div className="grid grid-cols-3 gap-2 my-5">
        {["cash", "card", "mobile"].map((m) => (
          <button key={m} onClick={() => setMethod(m)}
            className={cn("rounded-xl border py-3 text-sm font-medium capitalize transition-all", method === m ? "border-amber-400/50 bg-amber-500/10 text-amber-300" : "border-[var(--border)] text-muted")}>
            {m}
          </button>
        ))}
      </div>
      <Button variant="primary" className="w-full" loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(method); } finally { setBusy(false); } }}>
        Confirm {method} payment
      </Button>
      <p className="text-[11px] text-faint text-center mt-3">Inventory is deducted exactly once when the order completes.</p>
    </div>
  );
}

function ReceiptView({ data }: { data: any }) {
  const { order, items, payment, refunds, tableName, customerName } = data;
  return (
    <div className="text-sm">
      <div className="text-center pb-4 border-b border-dashed border-[var(--border)]">
        <p className="font-display font-bold text-lg">Ember & Oak Bistro</p>
        <p className="text-xs text-muted">{order.orderNumber} · {new Date(order.createdAt).toLocaleString()}</p>
        <div className="flex justify-center gap-2 mt-2">
          <Badge tone="sky">{order.type.replace("_", " ")}</Badge>
          {tableName && <Badge tone="slate">{tableName}</Badge>}
          {order.source === "simulation" && <Badge tone="violet">simulated</Badge>}
        </div>
      </div>
      <div className="py-4 space-y-2 border-b border-dashed border-[var(--border)]">
        {items.map((it: any) => (
          <div key={it.id} className="flex justify-between gap-3">
            <div>
              <p>{it.quantity}× {it.productName}</p>
              {it.modifiers?.length > 0 && <p className="text-[11px] text-muted">+ {it.modifiers.map((m: any) => m.name).join(", ")}</p>}
            </div>
            <span className="font-medium">{formatCents(it.unitPriceCents * it.quantity)}</span>
          </div>
        ))}
      </div>
      <div className="py-4 space-y-1.5 text-sm">
        <div className="flex justify-between text-muted"><span>Subtotal</span><span>{formatCents(order.subtotalCents)}</span></div>
        {order.discountCents > 0 && <div className="flex justify-between text-muted"><span>Discount</span><span>−{formatCents(order.discountCents)}</span></div>}
        <div className="flex justify-between text-muted"><span>Tax</span><span>{formatCents(order.taxCents)}</span></div>
        <div className="flex justify-between font-display font-bold text-lg"><span>Total</span><span>{formatCents(order.totalCents)}</span></div>
        {payment && <div className="flex justify-between text-emerald-400 text-xs pt-1"><span>Paid via {payment.method}</span><span>{new Date(payment.createdAt).toLocaleString()}</span></div>}
        {refunds?.length > 0 && <div className="flex justify-between text-rose-400 text-xs"><span>Refunded — {refunds[0].reason}</span><span>−{formatCents(refunds[0].amountCents)}</span></div>}
        {customerName && <p className="text-xs text-muted pt-1">Guest: {customerName}</p>}
      </div>
      <p className="text-center text-[10px] text-faint">Demonstration project — illustrative data only</p>
    </div>
  );
}
