"use client";
import { Save, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch, Badge, Button, Card, CardHeader, Field, Input, useApi, useToast } from "@/components/ui";

export default function SettingsPage() {
  const toast = useToast();
  const { data, loading, refetch } = useApi<any>("/api/settings");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.settings) setF(data.settings);
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/settings", "PUT", f);
      toast.push("Settings saved — they persist across restarts.", "success");
      refetch();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed to save settings", "error");
    } finally { setBusy(false); }
  };

  if (loading) return <Card><p className="text-sm text-muted py-8 text-center">Loading settings…</p></Card>;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted mt-0.5">Stored in the database — never reset to hardcoded defaults</p>
      </div>

      <Card>
        <CardHeader title="Identity" hint="Shown across the app, sidebar and footer" />
        <div className="space-y-4">
          <Field label="Display name (owner)">
            <Input value={f.displayName ?? ""} onChange={(e: any) => setF({ ...f, displayName: e.target.value })} />
          </Field>
          <Field label="Owner email" hint="Also your sign-in email">
            <Input type="email" value={f.ownerEmail ?? ""} onChange={(e: any) => setF({ ...f, ownerEmail: e.target.value })} />
          </Field>
          <Field label="Restaurant name"><Input value={f.restaurantName ?? ""} onChange={(e: any) => setF({ ...f, restaurantName: e.target.value })} /></Field>
          <Field label="Currency symbol"><Input value={f.currencySymbol ?? "$"} onChange={(e: any) => setF({ ...f, currencySymbol: e.target.value })} className="w-24" /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Inventory Policy" hint="Safety guard for stock integrity" />
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="accent-amber-400 w-4 h-4 mt-1" checked={f.allowNegativeStock === "true"}
            onChange={(e) => setF({ ...f, allowNegativeStock: e.target.checked ? "true" : "false" })} />
          <span>
            <span className="text-sm font-medium flex items-center gap-2">Allow negative stock <Badge tone="rose">audited override</Badge></span>
            <p className="text-xs text-muted mt-1">When off (recommended), order completion fails if a recipe ingredient would drop below zero. When on, deductions proceed and are recorded — visible in the audit trail and stock movements.</p>
          </span>
        </label>
      </Card>

      <Card>
        <CardHeader title="About" />
        <div className="text-sm space-y-2 text-muted">
          <p><b className="text-[var(--text)]">RestaurantOS</b> — enterprise restaurant management &amp; simulation platform.</p>
          <p className="flex items-center gap-2 text-xs"><ShieldAlert size={13} className="text-amber-400" /> This is a demonstration project. All displayed data is illustrative.</p>
          <p className="text-xs">Made with ❤️ by <b className="text-[var(--text)]">{f.displayName || "Talha"}</b> · {f.ownerEmail || "talhamalikawan@example.com"}</p>
          <p className="text-xs text-faint">Sign-in: use your account email and password. Demo password: <span className="font-mono">demo1234</span></p>
        </div>
      </Card>

      <Button variant="primary" loading={busy} onClick={save} className="w-full"><Save size={15} /> Save settings</Button>
    </div>
  );
}
