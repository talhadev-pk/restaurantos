"use client";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3, BookOpen, CalendarCheck, ChefHat, ClipboardList, Coins, FileBarChart2, Flame,
  LayoutDashboard, LogOut, Moon, Package, PhoneCall, Settings, Shield, ShoppingCart, Sun,
  Table2, Users, Wallet, GlassWater,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { apiFetch, ToastProvider } from "./ui";

type Me = { user: { id: number; name: string; email: string; roleName: string; permissions: string[] }; settings: Record<string, string> };

const NAV = [
  {
    section: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
      { href: "/pos", label: "Point of Sale", icon: ShoppingCart, perm: "pos.use" },
      { href: "/kitchen", label: "Kitchen Display", icon: ChefHat, perm: "kitchen.use" },
      { href: "/tables", label: "Floor & Tables", icon: Table2, perm: null },
      { href: "/reservations", label: "Reservations", icon: CalendarCheck, perm: "reservations.manage" },
    ],
  },
  {
    section: "Menu & Stock",
    items: [
      { href: "/menu", label: "Menu Manager", icon: BookOpen, perm: null },
      { href: "/recipes", label: "Recipes", icon: ClipboardList, perm: null },
      { href: "/inventory", label: "Inventory", icon: Package, perm: "inventory.manage" },
      { href: "/purchasing", label: "Purchasing", icon: GlassWater, perm: "purchasing.manage" },
    ],
  },
  {
    section: "Business",
    items: [
      { href: "/customers", label: "Customers", icon: Users, perm: "customers.manage" },
      { href: "/employees", label: "Employees", icon: Shield, perm: "employees.manage" },
      { href: "/finance", label: "Finance", icon: Wallet, perm: "finance.manage" },
      { href: "/reports", label: "Reports", icon: FileBarChart2, perm: "reports.view" },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/simulation", label: "Simulation Engine", icon: Flame, perm: "simulation.control" },
      { href: "/audit", label: "Audit Trail", icon: BarChart3, perm: "audit.view" },
      { href: "/settings", label: "Settings", icon: Settings, perm: null },
    ],
  },
];

function useTheme() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const t = localStorage.getItem("ros-theme");
    if (t === "light") {
      document.documentElement.classList.add("light");
      setLight(true);
    }
  }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("ros-theme", next ? "light" : "dark");
  };
  return { light, toggle };
}

export default function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const { light, toggle } = useTheme();

  useEffect(() => {
    apiFetch<Me>("/api/auth/me")
      .then((d) => { setMe(d); setChecked(true); })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!checked || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.6 }} className="flex items-center gap-3 text-muted">
          <Flame className="text-amber-400" size={26} />
          <span className="font-display font-semibold">RestaurantOS</span>
        </motion.div>
      </div>
    );
  }

  const { user, settings } = me;
  const can = (perm: string | null) => !perm || user.permissions.includes("*") || user.permissions.includes(perm);
  const displayName = settings.displayName || "Talha";

  return (
    <ToastProvider>
      <div className="min-h-screen flex">
        {/* Sidebar */}
        <aside className="w-[248px] shrink-0 border-r border-[var(--border)] flex flex-col sticky top-0 h-screen overflow-y-auto">
          <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Flame size={18} className="text-black" strokeWidth={2.4} />
            </div>
            <div>
              <p className="font-display font-bold text-[15px] leading-none">RestaurantOS</p>
              <p className="text-[10px] text-faint mt-1 tracking-wide uppercase">{settings.restaurantName || "Enterprise"}</p>
            </div>
          </div>
          <nav className="flex-1 px-3 pb-4 space-y-5 mt-2">
            {NAV.map((group) => {
              const items = group.items.filter((i) => can(i.perm));
              if (!items.length) return null;
              return (
                <div key={group.section}>
                  <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint mb-1.5">{group.section}</p>
                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "relative flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors",
                            active ? "text-[var(--text)]" : "text-muted hover:text-[var(--text)] hover:bg-[var(--panel-2)]",
                          )}
                        >
                          {active && (
                            <motion.span
                              layoutId="nav-active"
                              className="absolute inset-0 rounded-xl bg-[var(--panel-2)] border border-[var(--border)]"
                              transition={{ type: "spring", stiffness: 450, damping: 36 }}
                            />
                          )}
                          <item.icon size={16} className={cn("relative z-10", active && "text-amber-400")} />
                          <span className="relative z-10">{item.label}</span>
                          {active && <span className="relative z-10 ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
          <div className="px-5 py-4 border-t border-[var(--border)] space-y-2">
            <p className="text-[10.5px] text-faint leading-snug">This is a demonstration project. All displayed data is illustrative.</p>
            <p className="text-[11.5px] text-muted">Made with ❤️ by <span className="font-semibold text-[var(--text)]">{displayName}</span></p>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/75 backdrop-blur-xl px-6 py-3.5 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted">Signed in as</p>
              <p className="text-sm font-semibold truncate">
                {user.name} <span className="text-faint font-normal">· {user.roleName} · {user.email}</span>
              </p>
            </div>
            <SimStatusPill />
            <button
              onClick={toggle}
              className="w-9 h-9 rounded-xl border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center text-muted hover:text-[var(--text)] transition-colors"
              title="Toggle theme"
            >
              {light ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button
              onClick={async () => { await apiFetch("/api/auth/logout", "POST"); router.replace("/login"); }}
              className="w-9 h-9 rounded-xl border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center text-muted hover:text-rose-400 transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </header>
          <main className="flex-1 px-6 py-6 max-w-[1500px] w-full mx-auto">
            <AnimatePresence mode="wait">
              <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}

function SimStatusPill() {
  const [status, setStatus] = useState<string>("idle");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await apiFetch<{ status: string }>("/api/simulation/status");
        if (alive) setStatus(d.status);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <Link href="/simulation" className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 hover:bg-[var(--panel-2)] transition-colors">
      <span className={cn("w-2 h-2 rounded-full", status === "running" ? "bg-emerald-400 pulse-dot" : status === "paused" ? "bg-amber-400" : "bg-slate-500")} />
      <span className="text-xs font-medium text-muted capitalize">Simulation {status}</span>
    </Link>
  );
}
