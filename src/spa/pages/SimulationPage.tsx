"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Flame, Gauge, HandMetal, Pause, Play, RotateCcw, Square, Zap } from "lucide-react";
import { useState } from "react";
import { apiFetch, Badge, Button, Card, CardHeader, Field, Input, Spinner, useApi, useToast } from "../ui";
import { cn, timeAgo } from "@/lib/utils";

const MODES = [
  { value: "assisted", label: "Assisted", icon: HandMetal, desc: "Engine creates guests & orders — you cook and complete them" },
  { value: "automatic", label: "Automatic", icon: Bot, desc: "Full lifecycle: arrivals, kitchen, payment — hands-free restaurant" },
  { value: "stress", label: "Stress Test", icon: Zap, desc: "High-volume takeaway burst to pressure-test the pipeline" },
] as const;

const EVENT_TONES: Record<string, string> = { order: "text-sky-400", kitchen: "text-amber-400", payment: "text-emerald-400", customer: "text-violet-400", warn: "text-rose-400", info: "text-muted" };

export default function SimulationPage() {
  const toast = useToast();
  const { data: snap, refetch } = useApi<any>("/api/simulation/status", { interval: 2500 });
  const { data: logData, refetch: refetchLogs } = useApi<any>("/api/simulation/logs", { interval: 4000 });
  const [mode, setMode] = useState<string>("automatic");
  const [cfg, setCfg] = useState({ speed: "1", arrivalSec: "12", minItems: "1", maxItems: "4", operatingStart: "8", operatingEnd: "23" });
  const [busy, setBusy] = useState(false);
  const [resetResult, setResetResult] = useState<any>(null);

  const status = snap?.status ?? "idle";

  const call = async (action: string, body: any = {}) => {
    setBusy(true);
    try {
      await apiFetch(`/api/simulation/${action}`, "POST", body);
      refetch(); refetchLogs();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed", "error");
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!confirm("Reset simulation? All simulation-generated orders will be deleted and consumed inventory restored.")) return;
    setBusy(true);
    try {
      const res = await apiFetch<any>("/api/simulation/reset", "POST");
      setResetResult(res.summary);
      toast.push(`Reset complete: removed ${res.summary.ordersRemoved} simulation orders, restored ${res.summary.inventoryRestored} stock movements.`, "success");
      refetch(); refetchLogs();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Failed", "error"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2.5">Simulation Engine <Flame className="text-amber-400" size={22} /></h1>
        <p className="text-sm text-muted mt-0.5">Virtual customers, virtual kitchen, real database records — the same services power manual and simulated operations</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* Controls */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Engine Control" action={
              <Badge tone={status === "running" ? "emerald" : status === "paused" ? "amber" : "slate"}>{status}</Badge>
            } />
            <div className="grid grid-cols-3 gap-2 mb-4">
              {MODES.map((m) => (
                <button key={m.value} onClick={() => setMode(m.value)}
                  className={cn("rounded-xl border p-3 text-center transition-all", mode === m.value ? "border-amber-400/50 bg-amber-500/10" : "border-[var(--border)] hover:bg-[var(--panel-2)]")}>
                  <m.icon size={17} className={cn("mx-auto mb-1.5", mode === m.value ? "text-amber-400" : "text-muted")} />
                  <p className="text-[11px] font-semibold">{m.label}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted mb-4 rounded-lg bg-[var(--panel-2)] px-3 py-2">{MODES.find((m) => m.value === mode)?.desc}</p>
            <div className="grid grid-cols-2 gap-2">
              {status === "idle" && <Button variant="primary" loading={busy} onClick={() => call("start", { mode, speed: Number(cfg.speed), arrivalSec: Number(cfg.arrivalSec), minItems: Number(cfg.minItems), maxItems: Number(cfg.maxItems), operatingStart: Number(cfg.operatingStart), operatingEnd: Number(cfg.operatingEnd) })}><Play size={14} /> Start</Button>}
              {status === "running" && <Button variant="ghost" loading={busy} onClick={() => call("pause")}><Pause size={14} /> Pause</Button>}
              {status === "paused" && <Button variant="primary" loading={busy} onClick={() => call("resume")}><Play size={14} /> Resume</Button>}
              {status !== "idle" && <Button variant="danger" loading={busy} onClick={() => call("stop")}><Square size={14} /> Stop</Button>}
              <Button variant="ghost" loading={busy} disabled={status === "running"} onClick={reset} title={status === "running" ? "Stop the simulation first" : ""}><RotateCcw size={14} /> Reset Data</Button>
            </div>
            {resetResult && <p className="text-[11px] text-emerald-400 mt-3">Last reset: {resetResult.ordersRemoved} orders removed, {resetResult.inventoryRestored} stock movements restored.</p>}
          </Card>

          <Card>
            <CardHeader title="Configuration" hint="Applied live via the speed control" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Speed multiplier"><Input type="number" min="0.5" max="10" step="0.5" value={cfg.speed} onChange={(e: any) => setCfg({ ...cfg, speed: e.target.value })} /></Field>
              <Field label="Arrival every (sec)"><Input type="number" min="3" max="120" value={cfg.arrivalSec} onChange={(e: any) => setCfg({ ...cfg, arrivalSec: e.target.value })} /></Field>
              <Field label="Min items / order"><Input type="number" min="1" max="8" value={cfg.minItems} onChange={(e: any) => setCfg({ ...cfg, minItems: e.target.value })} /></Field>
              <Field label="Max items / order"><Input type="number" min="1" max="8" value={cfg.maxItems} onChange={(e: any) => setCfg({ ...cfg, maxItems: e.target.value })} /></Field>
              <Field label="Opens at (hour)"><Input type="number" min="0" max="23" value={cfg.operatingStart} onChange={(e: any) => setCfg({ ...cfg, operatingStart: e.target.value })} /></Field>
              <Field label="Closes at (hour)"><Input type="number" min="0" max="23" value={cfg.operatingEnd} onChange={(e: any) => setCfg({ ...cfg, operatingEnd: e.target.value })} /></Field>
            </div>
            <Button variant="ghost" size="sm" className="w-full mt-3" loading={busy} onClick={() => call("config", { speed: Number(cfg.speed), arrivalSec: Number(cfg.arrivalSec), minItems: Number(cfg.minItems), maxItems: Number(cfg.maxItems), operatingStart: Number(cfg.operatingStart), operatingEnd: Number(cfg.operatingEnd) })}>
              <Gauge size={13} /> Apply configuration
            </Button>
            <p className="text-[11px] text-faint mt-2">Speed applies live while running; other settings apply to new sessions.</p>
          </Card>
        </div>

        {/* Live stats + log */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Session Telemetry" action={snap?.sessionId ? <Badge tone="sky">session #{snap.sessionId}</Badge> : undefined} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ["Orders created", snap?.stats.ordersCreated ?? 0, "text-sky-400"],
                ["Completed & paid", snap?.stats.ordersCompleted ?? 0, "text-emerald-400"],
                ["Virtual guests", snap?.stats.customersCreated ?? 0, "text-violet-400"],
                ["Blocked (e.g. stock)", snap?.stats.blocked ?? 0, "text-rose-400"],
              ].map(([label, v, tone]) => (
                <div key={label as string} className="rounded-xl bg-[var(--panel-2)] p-4 text-center">
                  <motion.p key={String(v)} initial={{ scale: 1.15 }} animate={{ scale: 1 }} className={cn("font-display text-2xl font-bold", tone)}>{String(v)}</motion.p>
                  <p className="text-[10px] text-faint uppercase tracking-wide mt-1">{label}</p>
                </div>
              ))}
            </div>
            {snap?.lastError && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 mt-4">Last engine notice: {snap.lastError}</p>}
            {snap?.activeByStatus && Object.keys(snap.activeByStatus).length > 0 && (
              <div className="flex gap-2 mt-4 flex-wrap">
                {Object.entries(snap.activeByStatus).map(([st, c]) => <Badge key={st} tone="slate">{st}: {String(c)}</Badge>)}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity Log" hint="Real events emitted by the engine" />
            <div className="space-y-1 max-h-[460px] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {(logData?.events ?? []).map((e: any) => (
                  <motion.p key={e.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="text-xs flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-[var(--panel-2)]">
                    <span className={cn("uppercase font-semibold text-[9px] tracking-wider w-14 shrink-0 mt-0.5", EVENT_TONES[e.eventType] ?? "text-muted")}>{e.eventType}</span>
                    <span className="flex-1 text-muted">{e.message}</span>
                    <span className="text-faint text-[10px] shrink-0">{timeAgo(e.createdAt)}</span>
                  </motion.p>
                ))}
              </AnimatePresence>
              {(logData?.events ?? []).length === 0 && <p className="text-sm text-muted text-center py-10">No events yet — start the engine to bring the restaurant to life.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
