// Server-safe date range resolver shared by dashboard and reports.
export function resolveRange(sp: URLSearchParams): { from: Date; to: Date; label: string } {
  const range = sp.get("range") ?? "today";
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (range === "custom") {
    const from = sp.get("from") ? new Date(sp.get("from")!) : startOfDay(now);
    const to = sp.get("to") ? new Date(sp.get("to")!) : now;
    return { from, to, label: "Custom range" };
  }
  if (range === "yesterday") {
    const y = new Date(now.getTime() - 86400000);
    return { from: startOfDay(y), to: startOfDay(now), label: "Yesterday" };
  }
  if (range === "7d") return { from: new Date(now.getTime() - 7 * 86400000), to: now, label: "Last 7 days" };
  if (range === "30d") return { from: new Date(now.getTime() - 30 * 86400000), to: now, label: "Last 30 days" };
  if (range === "all") return { from: new Date(2020, 0, 1), to: now, label: "All time" };
  return { from: startOfDay(now), to: now, label: "Today" };
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
