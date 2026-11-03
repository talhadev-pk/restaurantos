"use client";
import { ScrollText } from "lucide-react";
import { Badge, Card, CardHeader, Spinner, useApi } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

const ACTION_COLORS: Record<string, string> = {
  create: "emerald", update: "sky", delete: "rose", login: "violet",
  start: "emerald", stop: "rose", reset: "amber", refund: "amber",
};

export default function AuditPage() {
  const { data, loading } = useApi<any>("/api/audit", { interval: 8000 });
  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Audit Trail</h1>
        <p className="text-sm text-muted mt-0.5">Every important operation is recorded with actor, entity and payload</p>
      </div>
      <Card>
        <CardHeader title="Recent Activity" hint="Newest first · last 120 events" />
        {loading ? <Spinner label="Loading audit log…" /> : (
          <div className="space-y-1">
            {(data?.logs ?? []).map((l: any) => (
              <div key={l.id} className="flex items-center gap-3 text-sm rounded-xl px-3 py-2 hover:bg-[var(--panel-2)] transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <Badge tone={ACTION_COLORS[l.action] ?? "slate"}>{l.action}</Badge>
                <span className="text-muted capitalize">{l.entity}{l.entityId ? ` #${l.entityId}` : ""}</span>
                <span className="text-xs text-faint">{l.userName}</span>
                {l.details && Object.keys(l.details).length > 0 && (
                  <span className="text-[11px] text-faint font-mono truncate max-w-[320px]">{JSON.stringify(l.details)}</span>
                )}
                <span className="ml-auto text-xs text-faint shrink-0">{timeAgo(l.createdAt)}</span>
              </div>
            ))}
            {(data?.logs ?? []).length === 0 && <p className="text-sm text-muted text-center py-10 flex flex-col items-center gap-2"><ScrollText size={20} className="text-faint" />No audit entries yet.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
