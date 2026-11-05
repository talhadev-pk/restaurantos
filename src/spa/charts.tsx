"use client";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/utils";

const tipStyle = {
  background: "var(--panel-solid)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--text)",
};

export function RevenueTrend({ data }: { data: { date: string; revenue: number; orders: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data.map((d) => ({ ...d, revenueUsd: d.revenue / 100 }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5a524" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#f5a524" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} tickLine={false} axisLine={false} tickMargin={8}
          tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
        <Tooltip contentStyle={tipStyle} formatter={(v: any, name: any) => (name === "revenueUsd" ? [formatCents(Math.round(Number(v) * 100)), "Revenue"] : [v, "Orders"])} />
        <Area type="monotone" dataKey="revenueUsd" stroke="#f5a524" strokeWidth={2.2} fill="url(#revGrad)" animationDuration={700} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const DONUT_COLORS = ["#64748b", "#38bdf8", "#f59e0b", "#34d399", "#a78bfa", "#10b981", "#f43f5e"];

export function StatusDonut({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).filter(([, v]) => v > 0);
  const data = entries.map(([name, value]) => ({ name, value }));
  if (!data.length) return <p className="text-sm text-muted text-center py-10">No orders yet in this range.</p>;
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={88} paddingAngle={3} animationDuration={700}>
            {data.map((_, i) => (
              <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip contentStyle={tipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-1">
        {data.map((d, i) => (
          <span key={d.name} className="inline-flex items-center gap-1.5 text-[11px] text-muted capitalize">
            <span className="w-2 h-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            {d.name} · {d.value}
          </span>
        ))}
      </div>
    </div>
  );
}
