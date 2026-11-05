# RestaurantOS

**Browser-native enterprise restaurant management & business simulation platform.**
No backend. No database server. No cloud. Everything runs and persists **in your browser** (IndexedDB via Dexie.js), so it deploys anywhere as a static website — including **GitHub Pages**.

> This is a demonstration project. All displayed data is illustrative and stored only in the visitor's browser.
> Made with ❤️ by Talha — talhamalikawan@example.com

## Quick Start (Windows 11 / PowerShell)

Prerequisite: **Node.js 20+** — nothing else.

```powershell
git clone https://github.com/<your-username>/restaurantos.git
cd restaurantos
npm install
npm run dev:vite     # the app at http://localhost:5173 (Vite)
# or: npm run dev    # Next.js host at http://localhost:3000 (same app)
```

Sign in: **talhamalikawan@example.com** / **demo1234**.
On first launch the app creates its local IndexedDB database and seeds a full demo
restaurant (menu, recipes, inventory, staff, ~120 real historical orders) — per browser profile.

## Deploy to GitHub Pages (free, static)

1. Push this repo to GitHub (empty repo named e.g. `restaurantos`).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` — the included workflow `.github/workflows/deploy-pages.yml`
   builds with `VITE_BASE=/<repo-name>/` and publishes `dist/`.
4. Your site lives at `https://<you>.github.io/<repo>/` — open it, sign in, done.

Client-side routing uses the URL hash, so refreshes and deep links never 404 on Pages.
For a custom domain, set `VITE_BASE=/` in the workflow env step.

## Architecture

| Layer | Tech |
| --- | --- |
| UI | React 19 + TypeScript, Tailwind CSS 4, Framer Motion, Recharts, Lucide |
| Build | Vite (static) + Next.js (preview host only) |
| Database | IndexedDB via Dexie.js — 29 tables, indexes, transactions |
| Settings | LocalStorage (lightweight preferences) |
| Business logic | `src/spa/services.ts` — Dexie transactions, atomic multi-table ops |
| Simulation | `src/spa/engine.ts` — in-browser tick engine (runs while the app is open) |
| Backup | `src/spa/db.ts` — JSON export/import with schema validation |

```
src/spa/
  db.ts         Dexie schema, settings (localStorage), backup/restore, storage stats
  services.ts   auth, order lifecycle, recipe-driven inventory, payments, refunds
  api.ts        local dispatcher — every UI "request" resolves against IndexedDB
  engine.ts     virtual customers + virtual kitchen (assisted/automatic/stress)
  seed.ts       one-time demo data per browser profile
  pages/        17 screens: dashboard, POS, KDS, tables, menu, recipes, inventory,
                purchasing, customers, employees, finance, reports (CSV), simulation,
                storage & backup, audit, settings
```

## Guarantees

- **Exactly-once inventory deduction** at order completion (Dexie transaction + status check)
- **Exactly-once payment** per completed order
- **Negative stock blocked** unless the audited override is enabled in Settings
- **Refunds** restore consumed ingredients and never double-count
- **History preserved**: order items snapshot name/price/tax
- **Per-profile isolation**: each browser profile has its own independent database
- **Backup/restore**: full JSON export, validated import (schema check + confirm), clear-data with confirmation

## Verify the business logic headlessly

```powershell
npx tsx scripts/smoke.ts   # 21 acceptance checks against an emulated IndexedDB
```

## Notes

- The simulation engine runs while the app tab is open and active. Closing the tab pauses everything safely; reopen it to continue.
- Browser storage is durable but not destruction-proof — use **Storage & Backup → Download backup** regularly.
