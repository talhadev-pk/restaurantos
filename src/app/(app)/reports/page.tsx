"use client";
import { Download, FileBarChart2 } from "lucide-react";
import { useState } from "react";
import { Card, CardHeader, Segmented, Spinner, TableShell, useApi } from "@/components/ui";

const REPORTS = [
  { value: "sales", label: "Daily Sales" },
  { value: "products", label: "Product Performance" },
  { value: "categories", label: "Category Performance" },
  { value: "inventory", label: "Inventory Consumption" },
  { value: "wastage", label: "Wastage" },
  { value: "purchases", label: "Supplier Purchases" },
  { value: "customers", label: "Customer Activity" },
  { value: "employees", label: "Employee Activity" },
  { value: "profit", label: "Profit & Loss" },
  { value: "tax", label: "Tax Summary" },
];

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

export default function ReportsPage() {
  const [type, setType] = useState("sales");
  const [range, setRange] = useState("30d");
  const { data, loading } = useApi<any>(`/api/reports?type=${type}&range=${range}`);

  const rows: any[] = data?.rows ?? [];
  const headers = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Reports & Analytics</h1>
          <p className="text-sm text-muted mt-0.5">Every report is generated from live SQL queries</p>
        </div>
        <a
          href={`/api/reports?type=${type}&range=${range}&format=csv`}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--panel-2)] transition-colors"
          download
        >
          <Download size={15} className="text-amber-400" /> Export CSV
        </a>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {REPORTS.map((r) => (
          <button key={r.value} onClick={() => setType(r.value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${type === r.value ? "border-amber-400/50 bg-amber-500/10 text-amber-300" : "border-[var(--border)] text-muted hover:text-[var(--text)]"}`}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="mb-5">
        <Segmented options={RANGES} value={range} onChange={setRange} />
      </div>

      <Card>
        <CardHeader title={data?.title ?? "Report"} hint={data?.rangeLabel ?? ""} />
        {loading ? <Spinner label="Running report query…" /> : rows.length === 0 ? (
          <p className="text-sm text-muted text-center py-10 flex flex-col items-center gap-2"><FileBarChart2 size={20} className="text-faint" />No data for this report in the selected range.</p>
        ) : (
          <TableShell headers={headers.map((h) => h.replace(/_/g, " "))}>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]/60">
                {headers.map((h) => (
                  <td key={h} className="py-2.5 pr-4 text-sm">
                    {typeof row[h] === "number" ? <span className="font-mono">{row[h]}</span> : String(row[h] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </TableShell>
        )}
      </Card>
    </div>
  );
}
