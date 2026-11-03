"use client";
import { AlarmClockCheck, Plus, Shield, Users } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Spinner, TableShell, useApi, useToast } from "@/components/ui";
import { formatCents } from "@/lib/utils";

const ATT_TONES: Record<string, string> = { present: "emerald", late: "amber", absent: "rose" };

export default function EmployeesPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/employees");
  const [createOpen, setCreateOpen] = useState(false);
  const [simBusy, setSimBusy] = useState(false);

  const simulateAttendance = async () => {
    setSimBusy(true);
    try {
      const { created, workDate } = await apiFetch<any>("/api/employees", "POST", { action: "simulate_attendance" });
      toast.push(created > 0 ? `Simulated attendance for ${created} employees on ${workDate}.` : "Attendance for today already exists.", "success");
      refetch();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); } finally { setSimBusy(false); }
  };

  const cycleStatus = async (e: any) => {
    const order = ["active", "on_break", "off_duty"];
    const next = order[(order.indexOf(e.status) + 1) % order.length];
    try {
      await apiFetch(`/api/employees?id=${e.id}`, "PATCH", { status: next });
      refetch();
    } catch (err) { toast.push(err instanceof Error ? err.message : "Failed", "error"); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Employees</h1>
          <p className="text-sm text-muted mt-0.5">Virtual staff entities — attendance is simulated and recorded</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" loading={simBusy} onClick={simulateAttendance}><AlarmClockCheck size={14} /> Simulate today's attendance</Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New employee</Button>
        </div>
      </div>

      {loading ? <Spinner label="Loading staff…" /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(data?.employees ?? []).map((e: any) => {
            const present = e.attendance?.filter((a: any) => a.status === "present").length ?? 0;
            const late = e.attendance?.filter((a: any) => a.status === "late").length ?? 0;
            const absent = e.attendance?.filter((a: any) => a.status === "absent").length ?? 0;
            return (
              <Card key={e.id}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500/30 to-blue-600/20 flex items-center justify-center font-display font-bold text-sky-300 shrink-0">
                    {e.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-semibold">{e.name}</p>
                      {e.isVirtual && <Badge tone="violet">virtual</Badge>}
                      <button onClick={() => cycleStatus(e)} title="Cycle status">
                        <Badge tone={e.status === "active" ? "emerald" : e.status === "on_break" ? "amber" : "slate"}>{e.status.replace("_", " ")}</Badge>
                      </button>
                    </div>
                    <p className="text-xs text-muted mt-0.5">{e.position} · {e.department}</p>
                    <p className="text-[11px] text-faint mt-0.5 flex items-center gap-1"><Shield size={10} /> {e.roleName ?? "No system role"} · {formatCents(e.hourlyRateCents)}/hr</p>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center shrink-0">
                    <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5"><p className="text-xs font-bold text-emerald-400">{present}</p><p className="text-[9px] text-faint">present</p></div>
                    <div className="rounded-lg bg-amber-500/10 px-2 py-1.5"><p className="text-xs font-bold text-amber-400">{late}</p><p className="text-[9px] text-faint">late</p></div>
                    <div className="rounded-lg bg-rose-500/10 px-2 py-1.5"><p className="text-xs font-bold text-rose-400">{absent}</p><p className="text-[9px] text-faint">absent</p></div>
                  </div>
                </div>
                <div className="flex gap-1 mt-3 flex-wrap">
                  {(e.attendance ?? []).slice(0, 8).map((a: any) => (
                    <span key={a.id} title={`${a.workDate} — ${a.status}${a.checkIn ? ` · in ${new Date(a.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`}
                      className={`w-6 h-6 rounded-md text-[9px] font-bold flex items-center justify-center border ${ATT_TONES[a.status] === "emerald" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : ATT_TONES[a.status] === "amber" ? "bg-amber-500/15 text-amber-400 border-amber-500/25" : "bg-rose-500/15 text-rose-400 border-rose-500/25"}`}>
                      {a.workDate.slice(8)}
                    </span>
                  ))}
                  {(e.attendance ?? []).length === 0 && <p className="text-xs text-faint">No attendance records — run the attendance simulation.</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Employee">
        <CreateForm roles={data?.roles ?? []} onDone={() => { setCreateOpen(false); refetch(); }} />
      </Modal>
    </div>
  );
}

function CreateForm({ roles, onDone }: { roles: any[]; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", position: "", department: "Front of House", roleId: "", rate: "16" });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await apiFetch("/api/employees", "POST", {
          name: f.name, position: f.position, department: f.department,
          roleId: f.roleId ? Number(f.roleId) : null,
          hourlyRateCents: Math.round(parseFloat(f.rate || "0") * 100),
        });
        toast.push("Employee added.", "success");
        onDone();
      } catch (err) { toast.push(err instanceof Error ? err.message : "Failed", "error"); } finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Position"><Input value={f.position} onChange={(e: any) => setF({ ...f, position: e.target.value })} placeholder="e.g. Line Cook" required /></Field>
        <Field label="Department">
          <Select value={f.department} onChange={(e: any) => setF({ ...f, department: e.target.value })}>
            {["Front of House", "Kitchen", "Management", "Operations", "Finance"].map((d) => <option key={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="System role (permissions)">
          <Select value={f.roleId} onChange={(e: any) => setF({ ...f, roleId: e.target.value })}>
            <option value="">— none —</option>
            {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Hourly rate ($)"><Input type="number" min="0" step="0.5" value={f.rate} onChange={(e: any) => setF({ ...f, rate: e.target.value })} /></Field>
      </div>
      <Button variant="primary" className="w-full" loading={busy}>Add employee</Button>
    </form>
  );
}
