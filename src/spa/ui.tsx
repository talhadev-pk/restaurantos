"use client";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, X, XCircle } from "lucide-react";
import {
  createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import { cn } from "@/lib/utils";
import { apiDispatch } from "./api";

// ---------- fetch helpers ----------
// Every "API call" is resolved locally in the browser against IndexedDB —
// the shapes are identical to a networked API, but nothing leaves the device.
export async function apiFetch<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  return apiDispatch(path, method, body) as Promise<T>;
}

export function useApi<T = any>(url: string | null, opts: { interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const my = ++seq.current;
      try {
        if (!silent) setLoading(true);
        const d = await apiFetch<T>(url);
        if (seq.current === my) { setData(d); setError(null); }
      } catch (e) {
        if (seq.current === my) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (seq.current === my) setLoading(false);
      }
    },
    [url],
  );
  useEffect(() => {
    load();
    if (opts.interval) {
      const t = setInterval(() => load(true), opts.interval);
      return () => clearInterval(t);
    }
  }, [load, opts.interval]);
  return { data, error, loading, refetch: () => load(true) };
}

// ---------- toasts ----------
type Toast = { id: number; message: string; kind: "success" | "error" | "info" };
const ToastCtx = createContext<{ push: (message: string, kind?: Toast["kind"]) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-80">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className="panel-solid rounded-xl px-4 py-3 flex items-start gap-3 shadow-xl shadow-black/30"
            >
              {t.kind === "success" && <CheckCircle2 className="w-4.5 h-4.5 mt-0.5 text-emerald-400 shrink-0" size={18} />}
              {t.kind === "error" && <XCircle className="mt-0.5 text-rose-400 shrink-0" size={18} />}
              {t.kind === "info" && <AlertTriangle className="mt-0.5 text-amber-400 shrink-0" size={18} />}
              <p className="text-sm leading-snug">{t.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- primitives ----------
export function Button({ children, variant = "ghost", size = "md", loading, className, ...props }: any) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:opacity-45 disabled:cursor-not-allowed select-none whitespace-nowrap";
  const variants: Record<string, string> = {
    primary: "bg-gradient-to-r from-amber-400 to-orange-500 text-black shadow-lg shadow-orange-500/20 hover:brightness-110 active:scale-[0.98]",
    ghost: "border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-2)] text-[var(--text)] active:scale-[0.98]",
    subtle: "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]",
    danger: "bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 active:scale-[0.98]",
    success: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 active:scale-[0.98]",
  };
  const sizes: Record<string, string> = {
    sm: "text-xs px-3 py-1.5",
    md: "text-sm px-4 py-2.5",
    lg: "text-sm px-5 py-3",
  };
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className, ...props }: { children: ReactNode; className?: string } & any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn("panel p-5", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({ title, hint, action }: { title: ReactNode; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="font-display font-semibold text-[15px]">{title}</h3>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3.5 py-2.5 text-sm outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/15 transition-all placeholder:text-[var(--faint)]";
export function Input(props: any) {
  return <input className={cn(inputCls, props.className)} {...props} />;
}
export function Select(props: any) {
  return <select className={cn(inputCls, "cursor-pointer", props.className)} {...props} />;
}
export function Textarea(props: any) {
  return <textarea className={cn(inputCls, "min-h-[80px]", props.className)} {...props} />;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint mt-1 block">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = "slate", className }: { children: ReactNode; tone?: string; className?: string }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-500/15 text-slate-300 border-slate-500/25",
    sky: "bg-sky-500/15 text-sky-300 border-sky-500/25",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/25",
    violet: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium capitalize", tones[tone] ?? tones.slate, className)}>
      {children}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted">
      <Loader2 className="animate-spin" size={20} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-14 h-14 rounded-2xl border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center text-[var(--faint)] mb-4">
        {icon ?? <Inbox size={24} />}
      </div>
      <p className="font-display font-semibold">{title}</p>
      {hint && <p className="text-sm text-muted mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

export function Stat({ label, value, sub, icon, tone = "text-[var(--text)]" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: string }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted font-medium uppercase tracking-wider">{label}</p>
          <p className={cn("font-display text-2xl font-bold mt-1.5 tracking-tight", tone)}>{value}</p>
          {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
        </div>
        {icon && <div className="w-10 h-10 rounded-xl bg-[var(--panel-2)] border border-[var(--border)] flex items-center justify-center text-amber-400">{icon}</div>}
      </div>
    </Card>
  );
}

export function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            value === o.value ? "text-black" : "text-muted hover:text-[var(--text)]",
          )}
        >
          {value === o.value && (
            <motion.span layoutId={undefined} className="absolute inset-0 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500" transition={{ type: "spring", stiffness: 500, damping: 35 }} />
          )}
          <span className="relative z-10">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={cn("panel-solid rounded-2xl w-full p-6 max-h-[88vh] overflow-y-auto shadow-2xl shadow-black/40", width)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-lg font-bold">{title}</h3>
              <button onClick={onClose} className="text-muted hover:text-[var(--text)] transition-colors p-1 rounded-lg hover:bg-[var(--panel-2)]">
                <X size={17} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TableShell({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[11px] font-semibold uppercase tracking-wider text-faint pb-3 pr-4 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
