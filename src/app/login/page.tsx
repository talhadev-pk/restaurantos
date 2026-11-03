"use client";
import { motion } from "framer-motion";
import { Flame, Loader2, Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("talhamalikawan@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // route didn't return JSON (e.g. 404 HTML) — surface a clean message
        throw new Error(`Sign-in service returned ${res.status} — check that the API and database are running.`);
      }
      if (!res.ok) throw new Error(data.error ?? "Sign-in failed");
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(700px 400px at 50% 0%, var(--glow), transparent 70%)" }} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 24 }}
        className="panel-solid rounded-3xl p-9 w-full max-w-md relative shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <Flame size={21} className="text-black" strokeWidth={2.4} />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold leading-none">RestaurantOS</h1>
            <p className="text-xs text-muted mt-1">Enterprise Restaurant Management</p>
          </div>
        </div>
        <p className="text-sm text-muted mb-7 mt-4">Sign in to operate your virtual restaurant.</p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-muted mb-1.5 block">Email</span>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/15 transition-all"
                value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted mb-1.5 block">Password</span>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/15 transition-all"
                value={password} onChange={(e) => setPassword(e.target.value)} type="password" required autoComplete="current-password"
                placeholder="demo password: demo1234"
              />
            </div>
          </label>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
              {error}
            </motion.p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-semibold text-sm py-3 hover:brightness-110 active:scale-[0.99] transition-all shadow-lg shadow-orange-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            Sign in
          </button>
        </form>
        <div className="mt-7 pt-5 border-t border-[var(--border)] text-center space-y-1.5">
          <p className="text-[10.5px] text-faint">This is a demonstration project. All displayed data is illustrative.</p>
          <p className="text-[11.5px] text-muted">Made with ❤️ by <span className="font-semibold">Talha</span></p>
        </div>
      </motion.div>
    </div>
  );
}
