"use client";
import { motion } from "framer-motion";
import { Flame, Loader2, Lock, Mail } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { getSettings } from "./db";
import { currentUser, ensureBooted } from "./api";
import { apiFetch } from "./ui";
import Shell from "./Shell";
import DashboardPage from "./pages/DashboardPage";
import PosPage from "./pages/PosPage";
import KitchenPage from "./pages/KitchenPage";
import TablesPage from "./pages/TablesPage";
import ReservationsPage from "./pages/ReservationsPage";
import MenuPage from "./pages/MenuPage";
import RecipesPage from "./pages/RecipesPage";
import InventoryPage from "./pages/InventoryPage";
import PurchasingPage from "./pages/PurchasingPage";
import CustomersPage from "./pages/CustomersPage";
import EmployeesPage from "./pages/EmployeesPage";
import FinancePage from "./pages/FinancePage";
import ReportsPage from "./pages/ReportsPage";
import SimulationPage from "./pages/SimulationPage";
import AuditPage from "./pages/AuditPage";
import SettingsPage from "./pages/SettingsPage";
import StoragePage from "./pages/StoragePage";

type SessionUser = { id: number; name: string; email: string; roleName: string; permissions: string[] };

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>(getSettings());

  useEffect(() => {
    (async () => {
      try {
        await ensureBooted();
        const u = await currentUser();
        setUser(u);
        setSettings(getSettings());
      } catch (e) {
        setBootError(e instanceof Error ? e.message : "Failed to initialize the local database");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (bootError) {
    return <FullScreen><p className="font-display font-bold text-rose-400">Could not open the local database</p><p className="text-sm text-muted mt-2">{bootError}</p></FullScreen>;
  }
  if (!ready) {
    return (
      <FullScreen>
        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.6 }} className="flex items-center gap-3 text-muted">
          <Flame className="text-amber-400" size={26} />
          <span className="font-display font-semibold">RestaurantOS — preparing your local restaurant…</span>
        </motion.div>
      </FullScreen>
    );
  }
  if (!user) {
    return <LoginScreen onLoggedIn={(u, s) => { setUser(u); setSettings(s); }} />;
  }

  return (
    <HashRouter>
      <Shell user={user} settings={settings} onLogout={async () => { await apiFetch("/api/auth/logout", "POST"); setUser(null); }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/purchasing" element={<PurchasingPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/simulation" element={<SimulationPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-6 text-center">{children}</div>;
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (u: SessionUser, s: Record<string, string>) => void }) {
  const [email, setEmail] = useState("talhamalikawan@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user } = await apiFetch<{ user: SessionUser }>("/api/auth/login", "POST", { email, password });
      onLoggedIn(user, getSettings());
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
            <p className="text-xs text-muted mt-1">Local-first Restaurant Management</p>
          </div>
        </div>
        <p className="text-sm text-muted mb-7 mt-4">Sign in to your local restaurant workspace.</p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-muted mb-1.5 block">Email</span>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <input className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/15 transition-all" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted mb-1.5 block">Password</span>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <input className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/15 transition-all" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required placeholder="demo password: demo1234" />
            </div>
          </label>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
              {error}
            </motion.p>
          )}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black font-semibold text-sm py-3 hover:brightness-110 active:scale-[0.99] transition-all shadow-lg shadow-orange-500/25 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 size={15} className="animate-spin" />}
            Sign in
          </button>
        </form>
        <div className="mt-7 pt-5 border-t border-[var(--border)] text-center space-y-1.5">
          <p className="text-[10.5px] text-faint">This is a demonstration project. All displayed data is illustrative and stored only in this browser.</p>
          <p className="text-[11.5px] text-muted">Made with ❤️ by <span className="font-semibold">Talha</span></p>
        </div>
      </motion.div>
    </div>
  );
}
