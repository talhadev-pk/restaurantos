"use client";
import { CalendarCheck, Plus } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useApi, useToast } from "@/components/ui";

const TONES: Record<string, string> = { booked: "sky", seated: "emerald", completed: "slate", cancelled: "rose", no_show: "amber" };

export default function ReservationsPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/reservations");
  const { data: tableData } = useApi<any>("/api/tables");
  const { data: custData } = useApi<any>("/api/customers");
  const [createOpen, setCreateOpen] = useState(false);

  const act = async (id: number, action: string, label: string) => {
    try {
      await apiFetch(`/api/reservations?id=${id}`, "PATCH", { action });
      toast.push(label, "success");
      refetch();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); }
  };

  const reservations = data?.reservations ?? [];
  const upcoming = reservations.filter((r: any) => ["booked", "seated"].includes(r.r.status) && new Date(r.r.reservedFor) > new Date(Date.now() - 86400000));

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Reservations</h1>
          <p className="text-sm text-muted mt-0.5">Conflicts within a ±2 hour window per table are prevented</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New reservation</Button>
      </div>

      {loading ? <Spinner label="Loading reservations…" /> : upcoming.length === 0 ? (
        <Card><EmptyState title="No reservations" hint="Book a table for a guest to get started." icon={<CalendarCheck size={22} />} /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {upcoming.map((row: any) => {
            const r = row.r;
            const when = new Date(r.reservedFor);
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <p className="font-display font-semibold">{r.customerName || row.customerName || "Walk-in guest"}</p>
                    <p className="text-xs text-muted mt-0.5">{when.toLocaleDateString()} at {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <Badge tone={TONES[r.status]}>{r.status.replace("_", " ")}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted my-3">
                  <Badge tone="slate">{row.tableName} · seats {row.capacity}</Badge>
                  <Badge tone="slate">party of {r.partySize}</Badge>
                </div>
                {r.notes && <p className="text-xs text-muted bg-[var(--panel-2)] rounded-lg px-3 py-2 mb-3">{r.notes}</p>}
                <div className="flex gap-2">
                  {r.status === "booked" && (
                    <>
                      <Button size="sm" variant="success" onClick={() => act(r.id, "seat", "Guests seated — table is now occupied.")}>Seat guests</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(r.id, "no_show", "Marked as no-show.")}>No-show</Button>
                      <Button size="sm" variant="danger" onClick={() => act(r.id, "cancel", "Reservation cancelled.")}>Cancel</Button>
                    </>
                  )}
                  {r.status === "seated" && (
                    <Button size="sm" variant="success" onClick={() => act(r.id, "complete", "Reservation completed.")}>Complete</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Reservation">
        <CreateForm
          tables={(tableData?.tables ?? []).map((r: any) => r.table)}
          customers={custData?.customers ?? []}
          onDone={() => { setCreateOpen(false); refetch(); }}
        />
      </Modal>
    </div>
  );
}

function CreateForm({ tables, customers, onDone }: { tables: any[]; customers: any[]; onDone: () => void }) {
  const toast = useToast();
  const now = new Date(Date.now() + 3600000);
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const [f, setF] = useState({ customerId: "", customerName: "", tableId: "", when: local, partySize: "2", notes: "" });
  const [busy, setBusy] = useState(false);
  const table = tables.find((t) => t.id === Number(f.tableId));
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/reservations", "POST", {
          customerId: f.customerId ? Number(f.customerId) : null,
          customerName: f.customerName,
          tableId: Number(f.tableId),
          reservedFor: new Date(f.when).toISOString(),
          partySize: Number(f.partySize),
          notes: f.notes,
        });
        toast.push("Reservation booked.", "success");
        onDone();
      } catch (err) {
        toast.push(err instanceof Error ? err.message : "Failed", "error");
      } finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Existing customer">
          <Select value={f.customerId} onChange={(e: any) => setF({ ...f, customerId: e.target.value })}>
            <option value="">— new / walk-in —</option>
            {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Guest name (if walk-in)"><Input value={f.customerName} onChange={(e: any) => setF({ ...f, customerName: e.target.value })} /></Field>
        <Field label="Date & time"><Input type="datetime-local" value={f.when} onChange={(e: any) => setF({ ...f, when: e.target.value })} required /></Field>
        <Field label="Party size"><Input type="number" min="1" max="20" value={f.partySize} onChange={(e: any) => setF({ ...f, partySize: e.target.value })} required /></Field>
      </div>
      <Field label="Table" hint={table ? `${table.name} seats ${table.capacity}${Number(f.partySize) > table.capacity ? " — too small for this party!" : ""}` : undefined}>
        <Select value={f.tableId} onChange={(e: any) => setF({ ...f, tableId: e.target.value })} required>
          <option value="">Select table…</option>
          {tables.map((t: any) => <option key={t.id} value={t.id}>{t.name} · seats {t.capacity} · {t.status}</option>)}
        </Select>
      </Field>
      <Field label="Notes"><Input value={f.notes} onChange={(e: any) => setF({ ...f, notes: e.target.value })} placeholder="Occasion, allergies, preferences…" /></Field>
      <Button variant="primary" className="w-full" loading={busy}>Book reservation</Button>
    </form>
  );
}
