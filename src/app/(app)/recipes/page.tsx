"use client";
import { Beaker, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { apiFetch, Badge, Button, Card, Field, Input, Modal, Select, Spinner, useApi, useToast } from "@/components/ui";
import { cn, formatCents, formatQty } from "@/lib/utils";

export default function RecipesPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/recipes");
  const { data: inv } = useApi<any>("/api/inventory");
  const [edit, setEdit] = useState<any | null>(null);

  const recipes = data?.recipes ?? [];
  const ingredients = inv?.ingredients ?? [];

  const totals = useMemo(() => {
    const withRecipe = recipes.filter((r: any) => r.recipeId);
    return {
      withRecipe: withRecipe.length,
      avgMargin: withRecipe.length ? Math.round(withRecipe.reduce((a: number, r: any) => a + r.marginPct, 0) / withRecipe.length) : 0,
    };
  }, [recipes]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Recipes & Costing</h1>
          <p className="text-sm text-muted mt-0.5">
            {totals.withRecipe}/{recipes.length} products have recipes · avg margin {totals.avgMargin}% — recipes drive inventory deduction
          </p>
        </div>
      </div>

      {loading ? <Spinner label="Computing recipe costs…" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {recipes.map((r: any) => (
            <Card key={r.productId}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-display font-semibold">{r.productName}</h3>
                  <p className="text-xs text-muted mt-0.5">Sells at {formatCents(r.priceCents)}</p>
                </div>
                <Badge tone={r.recipeId ? "emerald" : "rose"}>{r.recipeId ? "recipe set" : "no recipe"}</Badge>
              </div>
              <div className="space-y-1 min-h-[72px]">
                {r.lines.map((l: any) => (
                  <div key={l.ingredientId} className="flex items-center justify-between text-xs text-muted">
                    <span>{l.ingredientName}</span>
                    <span className="font-mono">{formatQty(l.quantity, l.unit)} · {formatCents(l.lineCostCents)}</span>
                  </div>
                ))}
                {!r.recipeId && <p className="text-xs text-faint">Orders for this item consume no inventory until a recipe is defined.</p>}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 mb-4 text-center">
                <div className="rounded-lg bg-[var(--panel-2)] py-2">
                  <p className="text-[10px] text-faint uppercase">Cost</p>
                  <p className="text-xs font-bold">{formatCents(r.costCents)}</p>
                </div>
                <div className="rounded-lg bg-[var(--panel-2)] py-2">
                  <p className="text-[10px] text-faint uppercase">Profit</p>
                  <p className={cn("text-xs font-bold", r.grossProfitCents >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatCents(r.grossProfitCents)}</p>
                </div>
                <div className="rounded-lg bg-[var(--panel-2)] py-2">
                  <p className="text-[10px] text-faint uppercase">Margin</p>
                  <p className="text-xs font-bold text-amber-400">{r.marginPct}%</p>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setEdit(r)}>
                <Pencil size={13} /> {r.recipeId ? "Edit recipe" : "Define recipe"}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Recipe — ${edit.productName}` : ""} width="max-w-xl">
        {edit && <RecipeEditor recipe={edit} ingredients={ingredients} onDone={() => { setEdit(null); refetch(); }} />}
      </Modal>
    </div>
  );
}

function RecipeEditor({ recipe, ingredients, onDone }: { recipe: any; ingredients: any[]; onDone: () => void }) {
  const toast = useToast();
  const [lines, setLines] = useState<{ ingredientId: number; quantity: number }[]>(
    recipe.lines.map((l: any) => ({ ingredientId: l.ingredientId, quantity: l.quantity })),
  );
  const [busy, setBusy] = useState(false);

  const cost = lines.reduce((a, l) => {
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    return a + (ing ? Math.round(ing.unitCostCents * l.quantity) : 0);
  }, 0);
  const profit = recipe.priceCents - cost;
  const margin = recipe.priceCents > 0 ? Math.round((profit / recipe.priceCents) * 1000) / 10 : 0;

  const used = new Set(lines.map((l) => l.ingredientId));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {lines.map((l, idx) => {
          const ing = ingredients.find((i) => i.id === l.ingredientId);
          return (
            <div key={idx} className="flex items-center gap-2">
              <Select value={l.ingredientId} onChange={(e: any) => setLines(lines.map((x, j) => (j === idx ? { ...x, ingredientId: Number(e.target.value) } : x)))}>
                {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </Select>
              <Input type="number" min="0.01" step="any" value={l.quantity} className="w-28"
                onChange={(e: any) => setLines(lines.map((x, j) => (j === idx ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <span className="text-xs text-muted w-10">{ing?.unit}</span>
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== idx))} className="text-faint hover:text-rose-400"><Trash2 size={14} /></button>
            </div>
          );
        })}
      </div>
      <Button size="sm" variant="ghost" disabled={[...used].length >= ingredients.length}
        onClick={() => {
          const free = ingredients.find((i) => !used.has(i.id));
          if (free) setLines([...lines, { ingredientId: free.id, quantity: 1 }]);
        }}>
        <Plus size={13} /> Add ingredient
      </Button>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 grid grid-cols-3 gap-3 text-center">
        <div><p className="text-[10px] text-faint uppercase">Cost / serving</p><p className="font-display font-bold text-lg">{formatCents(cost)}</p></div>
        <div><p className="text-[10px] text-faint uppercase">Gross profit</p><p className={cn("font-display font-bold text-lg", profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatCents(profit)}</p></div>
        <div><p className="text-[10px] text-faint uppercase">Margin</p><p className="font-display font-bold text-lg text-amber-400">{margin}%</p></div>
      </div>
      <Button variant="primary" className="w-full" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await apiFetch("/api/recipes", "PUT", { productId: recipe.productId, lines: lines.filter((l) => l.quantity > 0) });
          toast.push("Recipe saved — future orders will consume the new quantities.", "success");
          onDone();
        } catch (e) {
          toast.push(e instanceof Error ? e.message : "Failed", "error");
        } finally { setBusy(false); }
      }}>
        <Beaker size={14} /> Save recipe
      </Button>
    </div>
  );
}
