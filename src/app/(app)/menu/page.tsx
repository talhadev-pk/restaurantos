"use client";
import { motion } from "framer-motion";
import { Pencil, Plus, Power, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, Field, Input, Modal, Select, Spinner, TableShell, useApi, useToast } from "@/components/ui";
import { cn, formatCents, PRODUCT_COLORS } from "@/lib/utils";

export default function MenuPage() {
  const toast = useToast();
  const { data: prodData, loading, refetch } = useApi<any>("/api/menu/products");
  const { data: catData, refetch: refetchCats } = useApi<any>("/api/menu/categories");
  const { data: modData, refetch: refetchMods } = useApi<any>("/api/menu/modifiers");
  const [editProduct, setEditProduct] = useState<any | null>(null); // {} = new
  const [newCat, setNewCat] = useState("");

  const products = (prodData?.products ?? []).map((r: any) => ({ ...r.product, categoryName: r.categoryName }));
  const categories = catData?.categories ?? [];
  const modifiers = modData?.modifiers ?? [];

  const toggleAvailable = async (p: any) => {
    try {
      await apiFetch(`/api/menu/products?id=${p.id}`, "PATCH", { available: !p.available });
      toast.push(`${p.name} ${p.available ? "disabled" : "enabled"} — POS updated instantly.`, "success");
      refetch();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const deleteProduct = async (p: any) => {
    if (!confirm(`Delete "${p.name}"? Historical orders keep their snapshots.`)) return;
    try {
      await apiFetch(`/api/menu/products?id=${p.id}`, "DELETE");
      toast.push("Product deleted.", "success");
      refetch();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    try {
      await apiFetch("/api/menu/categories", "POST", { name: newCat, sortOrder: categories.length });
      toast.push("Category created.", "success");
      setNewCat("");
      refetchCats();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Menu Manager</h1>
          <p className="text-sm text-muted mt-0.5">Changes take effect in the POS immediately</p>
        </div>
        <Button variant="primary" onClick={() => setEditProduct({})}><Plus size={15} /> New Product</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
        <Card className="self-start">
          <h3 className="font-display font-semibold mb-3">Categories</h3>
          <div className="space-y-1 mb-4">
            {categories.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-[var(--panel-2)]">
                <span className={c.active ? "" : "line-through text-faint"}>{c.name}</span>
                <span className="text-[11px] text-faint">{products.filter((p: any) => p.categoryId === c.id).length}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newCat} onChange={(e: any) => setNewCat(e.target.value)} placeholder="New category…" className="!py-2 text-xs" />
            <Button size="sm" onClick={addCategory}><Plus size={13} /></Button>
          </div>
        </Card>

        <Card>
          {loading ? <Spinner label="Loading menu…" /> : (
            <TableShell headers={["Product", "Category", "Price", "Tax", "Modifiers", "Status", "Actions"]}>
              {products.map((p: any) => {
                const mods = modifiers.filter((m: any) => m.productId === p.id);
                return (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]/60 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <span className={cn("w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-[11px] font-bold", PRODUCT_COLORS[p.color] ?? PRODUCT_COLORS.amber)}>
                          {p.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-[11px] text-muted line-clamp-1 max-w-[260px]">{p.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted text-xs">{p.categoryName ?? "—"}</td>
                    <td className="py-3 pr-4 font-semibold text-amber-400">{formatCents(p.priceCents)}</td>
                    <td className="py-3 pr-4 text-xs text-muted">{(p.taxRateBp / 100).toFixed(1)}%</td>
                    <td className="py-3 pr-4 text-xs text-muted">{mods.length > 0 ? mods.map((m: any) => m.name).join(", ") : "—"}</td>
                    <td className="py-3 pr-4">
                      <button onClick={() => toggleAvailable(p)} title="Toggle availability">
                        <Badge tone={p.available ? "emerald" : "rose"}>{p.available ? "available" : "hidden"}</Badge>
                      </button>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1">
                        <Button size="sm" variant="subtle" onClick={() => setEditProduct(p)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="subtle" onClick={() => deleteProduct(p)}><Trash2 size={13} className="text-rose-400" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </Card>
      </div>

      <Modal open={!!editProduct} onClose={() => setEditProduct(null)} title={editProduct?.id ? `Edit ${editProduct.name}` : "New Product"} width="max-w-xl">
        {editProduct && (
          <ProductForm
            product={editProduct.id ? editProduct : null}
            categories={categories}
            modifiers={editProduct.id ? modifiers.filter((m: any) => m.productId === editProduct.id) : []}
            onDone={() => { setEditProduct(null); refetch(); refetchMods(); }}
          />
        )}
      </Modal>
    </div>
  );
}

function ProductForm({ product, categories, modifiers, onDone }: { product: any; categories: any[]; modifiers: any[]; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? (categories[0]?.id ?? ""),
    price: product ? (product.priceCents / 100).toFixed(2) : "",
    tax: product ? (product.taxRateBp / 100).toString() : "8.5",
    color: product?.color ?? "amber",
    available: product?.available ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [modName, setModName] = useState("");
  const [modPrice, setModPrice] = useState("");

  const save = async (e: any) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: f.name, description: f.description, categoryId: Number(f.categoryId) || null,
        priceCents: Math.round(parseFloat(f.price) * 100), taxRateBp: Math.round(parseFloat(f.tax) * 100),
        color: f.color, available: f.available,
      };
      if (Number.isNaN(payload.priceCents) || payload.priceCents <= 0) throw new Error("Enter a valid price.");
      if (product) await apiFetch(`/api/menu/products?id=${product.id}`, "PATCH", payload);
      else await apiFetch("/api/menu/products", "POST", payload);
      toast.push(product ? "Product updated." : "Product created.", "success");
      onDone();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed", "error");
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e: any) => setF({ ...f, categoryId: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Price ($)"><Input type="number" step="0.01" min="0.01" value={f.price} onChange={(e: any) => setF({ ...f, price: e.target.value })} required /></Field>
        <Field label="Tax rate (%)"><Input type="number" step="0.1" min="0" max="30" value={f.tax} onChange={(e: any) => setF({ ...f, tax: e.target.value })} /></Field>
      </div>
      <Field label="Description"><Input value={f.description} onChange={(e: any) => setF({ ...f, description: e.target.value })} placeholder="Short menu description…" /></Field>
      <Field label="Tile accent">
        <div className="flex gap-2">
          {Object.entries(PRODUCT_COLORS).map(([k, v]) => (
            <button type="button" key={k} onClick={() => setF({ ...f, color: k })}
              className={cn("w-9 h-9 rounded-xl bg-gradient-to-br border-2 transition-all", v, f.color === k ? "border-amber-400 scale-110" : "border-transparent")} />
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2.5 text-sm cursor-pointer">
        <input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} className="accent-amber-400 w-4 h-4" />
        Available on the POS
      </label>

      {product && (
        <div className="border-t border-[var(--border)] pt-4">
          <p className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5"><Tag size={12} /> Modifiers / add-ons</p>
          <div className="space-y-1.5 mb-2">
            {modifiers.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm rounded-lg bg-[var(--panel-2)] px-3 py-1.5">
                <span>{m.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-amber-400">+{formatCents(m.priceDeltaCents)}</span>
                  <button type="button" onClick={async () => { await apiFetch(`/api/menu/modifiers?id=${m.id}`, "DELETE"); onDone(); }} className="text-faint hover:text-rose-400"><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
            {modifiers.length === 0 && <p className="text-xs text-faint">No modifiers yet.</p>}
          </div>
          <div className="flex gap-2">
            <Input value={modName} onChange={(e: any) => setModName(e.target.value)} placeholder="Modifier name…" className="!py-2 text-xs" />
            <Input value={modPrice} onChange={(e: any) => setModPrice(e.target.value)} placeholder="+$" className="!py-2 text-xs w-20" type="number" step="0.01" />
            <Button size="sm" type="button" onClick={async () => {
              if (!modName.trim()) return;
              await apiFetch("/api/menu/modifiers", "POST", { productId: product.id, name: modName, priceDeltaCents: Math.round(parseFloat(modPrice || "0") * 100) });
              setModName(""); setModPrice(""); onDone();
            }}><Plus size={13} /></Button>
          </div>
        </div>
      )}
      <Button variant="primary" className="w-full" loading={busy}>{product ? "Save changes" : "Create product"}</Button>
    </form>
  );
}
