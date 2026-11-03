"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightLeft, Combine, Plus, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, Field, Input, Modal, Segmented, Select, Spinner, useApi, useToast } from "@/components/ui";
import { cn, formatCents, TABLE_STYLES, timeAgo } from "@/lib/utils";
import Link from "next/link";

export default function TablesPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/tables", { interval: 6000 });
  const [selected, setSelected] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [combineSel, setCombineSel] = useState<number[]>([]);

  const rows = data?.tables ?? [];
  const sel = rows.find((r: any) => r.table.id === selected);

  const patch = async (body: any, success: string) => {
    try {
      await apiFetch("/api/tables", "PATCH", body);
      toast.push(success, "success");
      refetch();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Action failed", "error");
    }
  };

  const counts = rows.reduce((acc: Record<string, number>, r: any) => {
    acc[r.table.status] = (acc[r.table.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Floor & Tables</h1>
          <p className="text-sm text-muted mt-0.5">Live statuses driven by orders and reservations</p>
        </div>
        <div className="flex items-center gap-2">
          {combineSel.length >= 2 && (
            <Button size="sm" variant="ghost" onClick={async () => { await patch({ id: combineSel[0], action: "combine", tableIds: combineSel }, "Tables combined for a party."); setCombineSel([]); }}>
              <Combine size={14} /> Combine ({combineSel.length})
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add Table</Button>
        </div>
      </div>

      <div className="flex gap-4 mb-4 flex-wrap">
        {Object.entries(TABLE_STYLES).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={cn("w-2 h-2 rounded-full", v.dot)} /> {v.label} <b className="text-[var(--text)]">{counts[k] ?? 0}</b>
          </span>
        ))}
      </div>

      {loading && !data ? <Spinner label="Loading floor plan…" /> : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
          {/* Floor plan */}
          <div className="panel rounded-2xl relative overflow-hidden" style={{ height: 540 }}>
            <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
            <div className="absolute top-4 left-4 text-[10px] uppercase tracking-[0.2em] text-faint">Main Dining Room</div>
            <div className="absolute top-4 right-4 text-[10px] uppercase tracking-[0.2em] text-faint">Entrance →</div>
            <AnimatePresence>
              {rows.map((r: any) => {
                const t = r.table;
                const st = TABLE_STYLES[t.status] ?? TABLE_STYLES.available;
                const inCombine = combineSel.includes(t.id);
                return (
                  <motion.button
                    key={t.id}
                    layout
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setSelected(t.id)}
                    onDoubleClick={() => setCombineSel((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                    className={cn(
                      "absolute rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition-colors shadow-lg",
                      st.ring,
                      selected === t.id && "ring-2 ring-amber-400/60",
                      inCombine && "ring-2 ring-sky-400/60",
                    )}
                    style={{
                      left: `${t.posX}%`, top: `${t.posY}%`,
                      width: t.capacity >= 8 ? 118 : t.capacity >= 6 ? 104 : 88,
                      height: t.capacity >= 6 ? 74 : 64,
                    }}
                  >
                    <span className="font-display font-bold text-sm">{t.name}</span>
                    <span className="flex items-center gap-1 text-[10px] text-muted"><Users size={10} /> {t.capacity}</span>
                    {r.activeOrderNumber && <span className="font-mono text-[9px] text-amber-400">{r.activeOrderNumber}</span>}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Details panel */}
          <div className="space-y-4">
            <Card>
              <h3 className="font-display font-semibold mb-3">Table Details</h3>
              {!sel ? (
                <p className="text-sm text-muted">Select a table on the floor plan. Double-click tables to select multiple for combining.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-lg">{sel.table.name}</span>
                    <Badge tone={sel.table.status === "available" ? "emerald" : sel.table.status === "occupied" ? "rose" : sel.table.status === "reserved" ? "amber" : "sky"}>
                      {sel.table.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted flex items-center gap-2"><Users size={14} /> Seats {sel.table.capacity}</p>
                  {sel.table.note && <p className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2">{sel.table.note}</p>}
                  {sel.activeOrderNumber && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-sm space-y-1">
                      <p className="font-mono text-xs text-amber-400">{sel.activeOrderNumber}</p>
                      <p className="text-muted text-xs capitalize">{sel.activeOrderStatus} · {formatCents(sel.activeOrderTotal)} · opened {timeAgo(sel.activeOrderCreatedAt)}</p>
                      <Link href="/pos" className="text-xs text-amber-400 hover:underline inline-block mt-1">Manage order in POS →</Link>
                      <div className="flex gap-2 mt-2">
                        <Select value={transferTarget} onChange={(e: any) => setTransferTarget(e.target.value)} className="!py-1.5 text-xs">
                          <option value="">Transfer to…</option>
                          {rows.filter((x: any) => x.table.status === "available" && x.table.id !== sel.table.id).map((x: any) => (
                            <option key={x.table.id} value={x.table.id}>{x.table.name} (seats {x.table.capacity})</option>
                          ))}
                        </Select>
                        <Button size="sm" disabled={!transferTarget} onClick={async () => {
                          await patch({ id: sel.table.id, action: "transfer", toTableId: Number(transferTarget) }, `Order moved to another table.`);
                          setTransferTarget("");
                        }}><ArrowRightLeft size={13} /></Button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {sel.table.status === "cleaning" && (
                      <Button size="sm" variant="success" onClick={() => patch({ id: sel.table.id, action: "status", status: "available" }, "Table cleaned and available.")}>
                        <Sparkles size={13} /> Mark Clean
                      </Button>
                    )}
                    {sel.table.status === "available" && (
                      <Button size="sm" variant="ghost" onClick={() => patch({ id: sel.table.id, action: "status", status: "reserved" }, "Table reserved.")}>Reserve</Button>
                    )}
                    {sel.table.status === "reserved" && !sel.activeOrderNumber && (
                      <Button size="sm" variant="ghost" onClick={() => patch({ id: sel.table.id, action: "status", status: "available" }, "Reservation released.")}>Release</Button>
                    )}
                    {(sel.table.status === "occupied" || sel.table.status === "cleaning") && !sel.activeOrderNumber && (
                      <Button size="sm" variant="ghost" onClick={() => patch({ id: sel.table.id, action: "status", status: "available" }, "Table freed.")}>Free Table</Button>
                    )}
                    {["reserved"].includes(sel.table.status) && sel.table.note && (
                      <Button size="sm" variant="ghost" onClick={() => patch({ id: sel.table.id, action: "separate", tableIds: [sel.table.id] }, "Table separated.")}>Separate</Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Table">
        <AddTableForm onDone={() => { setAddOpen(false); refetch(); }} />
      </Modal>
    </div>
  );
}

function AddTableForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/tables", "POST", { name, capacity: Number(capacity), posX: 10 + Math.random() * 70, posY: 10 + Math.random() * 70 });
        toast.push("Table added to the floor.", "success");
        onDone();
      } catch (err) {
        toast.push(err instanceof Error ? err.message : "Failed", "error");
      } finally { setBusy(false); }
    }}>
      <Field label="Table name"><Input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="T-09" required /></Field>
      <Field label="Capacity (seats)"><Input type="number" min={1} max={20} value={capacity} onChange={(e: any) => setCapacity(e.target.value)} /></Field>
      <Button variant="primary" className="w-full" loading={busy}>Create Table</Button>
    </form>
  );
}
