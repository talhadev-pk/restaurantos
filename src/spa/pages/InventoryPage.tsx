"use client";
import { AlertTriangle, History, Package, Plus, Scale, Trash } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Spinner, TableShell, useApi, useToast } from "../ui";
import { cn, formatCents, formatQty, timeAgo } from "@/lib/utils";

export default function InventoryPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/inventory", { interval: 10000 });
  const [adjustFor, setAdjustFor] = useState<any | null>(null);
  const [wasteFor, setWasteFor] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState<"stock" | "movements">("stock");

  const ingredients = data?.ingredients ?? [];
  const low = ingredients.filter((i: any) => i.low);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted mt-0.5">
            Valuation <b className="text-amber-400">{formatCents(data?.valuation ?? 0)}</b>
            {data?.wasteCostCents > 0 && <> · waste cost {formatCents(data.wasteCostCents)}</>}
            {" "}· negative stock {data?.allowNegativeStock ? <Badge tone="rose">allowed (audited override)</Badge> : <Badge tone="emerald">blocked</Badge>}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 gap-0.5">
            {([["stock", "Stock levels"], ["movements", "Movements"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors", tab === k ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-muted")}>{l}</button>
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New ingredient</Button>
        </div>
      </div>

      {low.length > 0 && (
        <Card className="mb-5 border-rose-500/25 !bg-rose-500/5">
          <p className="text-sm font-semibold text-rose-300 flex items-center gap-2 mb-2"><AlertTriangle size={15} /> {low.length} ingredient{low.length > 1 ? "s" : ""} below minimum stock</p>
          <div className="flex flex-wrap gap-2">
            {low.map((i: any) => (
              <span key={i.id} className="text-xs rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-rose-200">
                {i.name} — {formatQty(i.stockQty, i.unit)} left (min {formatQty(i.minStock, i.unit)})
              </span>
            ))}
          </div>
        </Card>
      )}

      {loading ? <Spinner label="Loading inventory…" /> : tab === "stock" ? (
        <Card>
          <TableShell headers={["Ingredient", "Stock", "Min level", "Unit cost", "Value", "Status", "Actions"]}>
            {ingredients.map((i: any) => (
              <tr key={i.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]/60">
                <td className="py-3 pr-4 font-medium">{i.name} <span className="text-faint text-xs">({i.unit})</span></td>
                <td className="py-3 pr-4">
                  <span className={cn("font-mono font-semibold", i.low && "text-rose-400")}>{formatQty(i.stockQty, i.unit)}</span>
                  <div className="h-1 w-24 mt-1.5 rounded-full bg-[var(--panel-2)] overflow-hidden">
                    <div className={cn("h-full rounded-full", i.low ? "bg-rose-400" : "bg-emerald-400")}
                      style={{ width: `${Math.min(100, i.minStock > 0 ? (i.stockQty / (i.minStock * 3)) * 100 : i.stockQty > 0 ? 100 : 0)}%` }} />
                  </div>
                </td>
                <td className="py-3 pr-4 text-xs text-muted font-mono">{formatQty(i.minStock, i.unit)}</td>
                <td className="py-3 pr-4 text-xs text-muted">{formatCents(i.unitCostCents)}/{i.unit}</td>
                <td className="py-3 pr-4 text-sm font-semibold">{formatCents(Math.round(i.stockQty * i.unitCostCents))}</td>
                <td className="py-3 pr-4">{i.low ? <Badge tone="rose">low stock</Badge> : <Badge tone="emerald">healthy</Badge>}</td>
                <td className="py-3 pr-4">
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setAdjustFor(i)}><Scale size={12} /> Adjust</Button>
                    <Button size="sm" variant="ghost" onClick={() => setWasteFor(i)}><Trash size={12} /> Waste</Button>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Stock Movements" hint="Purchases, consumption, adjustments, waste — full audit trail" />
          <div className="space-y-1.5">
            {(data?.movements ?? []).map((m: any) => (
              <div key={m.m.id} className="flex items-center gap-3 text-sm rounded-xl px-3 py-2 hover:bg-[var(--panel-2)]">
                <Badge tone={m.m.type === "purchase" ? "emerald" : m.m.type === "consumption" ? "sky" : m.m.type === "waste" ? "rose" : m.m.type === "refund_restore" ? "violet" : "slate"}>
                  {m.m.type.replace("_", " ")}
                </Badge>
                <span className="font-medium">{m.ingredientName}</span>
                <span className="font-mono text-xs text-muted">
                  {m.m.type === "consumption" || m.m.type === "waste" ? "−" : "+"}{formatQty(m.m.quantity, m.unit)}
                </span>
                {m.m.note && <span className="text-xs text-faint truncate max-w-[260px]">{m.m.note}</span>}
                {m.m.source === "simulation" && <Badge tone="violet">sim</Badge>}
                <span className="ml-auto text-xs text-faint">{timeAgo(m.m.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={!!adjustFor} onClose={() => setAdjustFor(null)} title={adjustFor ? `Adjust — ${adjustFor.name}` : ""}>
        {adjustFor && <StockForm kind="adjust" ingredient={adjustFor} onDone={() => { setAdjustFor(null); refetch(); }} />}
      </Modal>
      <Modal open={!!wasteFor} onClose={() => setWasteFor(null)} title={wasteFor ? `Record waste — ${wasteFor.name}` : ""}>
        {wasteFor && <StockForm kind="waste" ingredient={wasteFor} onDone={() => { setWasteFor(null); refetch(); }} />}
      </Modal>
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Ingredient">
        <CreateIngredientForm onDone={() => { setCreateOpen(false); refetch(); }} />
      </Modal>
    </div>
  );
}

function StockForm({ kind, ingredient, onDone }: { kind: "adjust" | "waste"; ingredient: any; onDone: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sign, setSign] = useState(1);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const quantity = kind === "adjust" ? Number(qty) * sign : Number(qty);
        await apiFetch("/api/inventory", "POST", { action: kind === "adjust" ? "adjust" : "waste", ingredientId: ingredient.id, quantity, note });
        toast.push(kind === "waste" ? "Waste recorded — stock reduced and cost tracked." : "Stock adjusted.", "success");
        onDone();
      } catch (err) {
        toast.push(err instanceof Error ? err.message : "Failed", "error");
      } finally { setBusy(false); }
    }}>
      <p className="text-sm text-muted">Current stock: <b className="text-[var(--text)]">{formatQty(ingredient.stockQty, ingredient.unit)}</b></p>
      {kind === "adjust" && (
        <div className="grid grid-cols-2 gap-2">
          {[1, -1].map((sn) => (
            <button type="button" key={sn} onClick={() => setSign(sn)}
              className={cn("rounded-xl border py-2.5 text-sm font-medium transition-all", sign === sn ? (sn === 1 ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300" : "border-rose-400/50 bg-rose-500/10 text-rose-300") : "border-[var(--border)] text-muted")}>
              {sn === 1 ? "+ Add stock" : "− Remove stock"}
            </button>
          ))}
        </div>
      )}
      <Field label={`Quantity (${ingredient.unit})`} hint={kind === "adjust" ? "Enter a positive magnitude — direction chosen above" : undefined}>
        <Input type="number" min="0.001" step="any" value={qty} onChange={(e: any) => setQty(e.target.value)} required />
      </Field>
      <Field label="Note"><Input value={note} onChange={(e: any) => setNote(e.target.value)} placeholder={kind === "waste" ? "e.g. expired, dropped…" : "e.g. stocktake correction…"} /></Field>
      <Button variant={kind === "waste" ? "danger" : "primary"} className="w-full" loading={busy}>
        {kind === "waste" ? "Record wastage" : "Apply adjustment"}
      </Button>
    </form>
  );
}

function CreateIngredientForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", unit: "pcs", stockQty: "", minStock: "", unitCost: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/inventory", "POST", {
          action: "create", name: f.name, unit: f.unit,
          stockQty: Number(f.stockQty || 0), minStock: Number(f.minStock || 0),
          unitCostCents: Math.round(parseFloat(f.unitCost || "0") * 100),
        });
        toast.push("Ingredient created.", "success");
        onDone();
      } catch (err) {
        toast.push(err instanceof Error ? err.message : "Failed", "error");
      } finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Unit">
          <Select value={f.unit} onChange={(e: any) => setF({ ...f, unit: e.target.value })}>
            <option value="pcs">pcs</option><option value="g">grams (g)</option><option value="ml">millilitres (ml)</option>
          </Select>
        </Field>
        <Field label="Opening stock"><Input type="number" min="0" step="any" value={f.stockQty} onChange={(e: any) => setF({ ...f, stockQty: e.target.value })} /></Field>
        <Field label="Minimum level"><Input type="number" min="0" step="any" value={f.minStock} onChange={(e: any) => setF({ ...f, minStock: e.target.value })} /></Field>
        <Field label="Unit cost ($)"><Input type="number" min="0" step="0.01" value={f.unitCost} onChange={(e: any) => setF({ ...f, unitCost: e.target.value })} /></Field>
      </div>
      <Button variant="primary" className="w-full" loading={busy}>Create ingredient</Button>
    </form>
  );
}
