"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Database, Download, HardDrive, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import { Button, Card, CardHeader, Modal, useToast, apiFetch } from "../ui";
import {
  clearAllData, exportBackup, importBackup, requestPersistence,
  storageEstimate, tableCounts, validateBackup,
} from "../db";

export default function StoragePage() {
  const toast = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ payload: any; summary: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setCounts(await tableCounts());
    setEstimate(await storageEstimate());
  };
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    navigator?.storage?.persisted?.().then((p) => setPersisted(p ? "granted" : "not granted")).catch(() => {});
  }, []);

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
  const mb = (n: number) => (n / 1048576).toFixed(2);

  const doExport = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/health"); // ensure seeded before measuring
      const payload = await exportBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `restaurantos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.push(`Backup downloaded — ${totalRecords.toLocaleString()} records.`, "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Export failed", "error");
    } finally { setBusy(false); }
  };

  const onPickFile = async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const check = validateBackup(payload);
      if (!check.valid) {
        toast.push(check.error, "error");
        return;
      }
      setPendingImport({ payload, summary: check.summary });
    } catch {
      toast.push("That file is not valid JSON.", "error");
    }
  };

  const doImport = async () => {
    if (!pendingImport) return;
    setBusy(true);
    try {
      await importBackup(pendingImport.payload, "replace");
      toast.push("Backup restored successfully.", "success");
      setPendingImport(null);
      await refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Import failed", "error");
    } finally { setBusy(false); }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      await clearAllData(false);
      setConfirmClear(false);
      toast.push("Local data cleared. Reloading…", "success");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed to clear data", "error");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Storage & Backup</h1>
        <p className="text-sm text-muted mt-0.5">Your restaurant lives in this browser's IndexedDB — nothing is sent anywhere</p>
      </div>

      <Card className="border-sky-500/25" style={{ background: "rgba(56,189,248,0.05)" }}>
        <div className="flex gap-3 text-sm">
          <ShieldCheck size={18} className="text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-muted">
            <p><b className="text-[var(--text)]">Browser-local storage:</b> every visitor gets an independent private database. Data is tied to this browser profile on this device and does <b className="text-[var(--text)]">not</b> synchronize between browsers or devices.</p>
            <p>Browser storage is durable across refreshes and restarts, but it is not an absolute guarantee — clearing browser data (or OS-level cleanup of unused sites) can remove it. Export backups regularly.</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-muted uppercase tracking-wider font-medium flex items-center gap-2"><Database size={13} className="text-amber-400" /> Records</p>
          <p className="font-display text-3xl font-bold mt-2">{totalRecords.toLocaleString()}</p>
          <p className="text-xs text-faint mt-1">{Object.keys(counts).length} tables</p>
        </Card>
        <Card>
          <p className="text-xs text-muted uppercase tracking-wider font-medium flex items-center gap-2"><HardDrive size={13} className="text-amber-400" /> Storage used</p>
          <p className="font-display text-3xl font-bold mt-2">{estimate ? `${mb(estimate.usage)} MB` : "n/a"}</p>
          <p className="text-xs text-faint mt-1">{estimate ? `of ~${mb(estimate.quota)} MB available` : "not supported by this browser"}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted uppercase tracking-wider font-medium flex items-center gap-2"><ShieldCheck size={13} className="text-amber-400" /> Persistence</p>
          <p className="font-display text-xl font-bold mt-2 capitalize">{persisted ?? "unknown"}</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={async () => {
            const ok = await requestPersistence();
            setPersisted(ok === null ? "not supported" : ok ? "granted" : "not granted");
            toast.push(ok ? "Persistent storage granted — the browser will try to keep this data." : "Persistence request was not granted by the browser.", ok ? "success" : "info");
          }}>Request persistence</Button>
        </Card>
      </div>

      <Card>
        <CardHeader title="Backup & Restore" hint="Full database export/import as JSON, schema-validated" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="primary" loading={busy} onClick={doExport}><Download size={15} /> Download backup</Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import backup…</Button>
          <Button variant="danger" onClick={() => setConfirmClear(true)}><Trash2 size={15} /> Clear all data</Button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }} />
      </Card>

      <Card>
        <CardHeader title="Record counts" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(counts).map(([t, c]) => (
            <div key={t} className="flex items-center justify-between rounded-lg bg-[var(--panel-2)] px-3 py-2 text-xs">
              <span className="text-muted">{t}</span>
              <span className="font-mono font-semibold">{c.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>

      <Modal open={!!pendingImport} onClose={() => setPendingImport(null)} title="Import backup?">
        <div className="space-y-4">
          <p className="text-sm text-muted">This will <b className="text-[var(--text)]">replace all current local data</b> with:</p>
          <p className="text-sm rounded-xl bg-[var(--panel-2)] border border-[var(--border)] px-4 py-3">{pendingImport?.summary}</p>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPendingImport(null)}>Cancel</Button>
            <Button variant="primary" className="flex-1" loading={busy} onClick={doImport}>Replace & restore</Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear all application data?">
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
            <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <p className="text-sm text-muted">This permanently deletes every order, payment, inventory record, customer and setting stored in this browser. A fresh demo restaurant will be seeded on reload. Consider exporting a backup first.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmClear(false)}>Keep my data</Button>
            <Button variant="danger" className="flex-1" loading={busy} onClick={doClear}>Delete everything</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
