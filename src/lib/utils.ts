// Pure utilities — safe for both client and server bundles.

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatCents(cents: number | null | undefined, symbol = "$"): string {
  const n = (cents ?? 0) / 100;
  return `${symbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 100) / 100;
  if (unit === "g" && rounded >= 1000) return `${(rounded / 1000).toFixed(2)} kg`;
  if (unit === "ml" && rounded >= 1000) return `${(rounded / 1000).toFixed(2)} L`;
  return `${rounded} ${unit}`;
}

export function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function elapsed(startIso: string | Date): string {
  const d = typeof startIso === "string" ? new Date(startIso) : startIso;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "served", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  confirmed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  preparing: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ready: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  served: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  completed: "bg-emerald-600/20 text-emerald-200 border-emerald-500/40",
  cancelled: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export const TABLE_STYLES: Record<string, { dot: string; ring: string; label: string }> = {
  available: { dot: "bg-emerald-400", ring: "border-emerald-500/40 bg-emerald-500/5", label: "Available" },
  occupied: { dot: "bg-rose-400", ring: "border-rose-500/40 bg-rose-500/5", label: "Occupied" },
  reserved: { dot: "bg-amber-400", ring: "border-amber-500/40 bg-amber-500/5", label: "Reserved" },
  cleaning: { dot: "bg-sky-400", ring: "border-sky-500/40 bg-sky-500/5", label: "Cleaning" },
};

export const PRODUCT_COLORS: Record<string, string> = {
  amber: "from-amber-500/30 to-orange-600/20 text-amber-300",
  rose: "from-rose-500/30 to-pink-600/20 text-rose-300",
  emerald: "from-emerald-500/30 to-teal-600/20 text-emerald-300",
  sky: "from-sky-500/30 to-blue-600/20 text-sky-300",
  violet: "from-violet-500/30 to-purple-600/20 text-violet-300",
  lime: "from-lime-500/30 to-green-600/20 text-lime-300",
};
