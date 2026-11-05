# RestaurantOS

**Enterprise Restaurant Management & Realistic Business Simulation Platform**

RestaurantOS runs a complete virtual restaurant: POS, kitchen display, floor & table management, recipes with inventory auto-deduction, suppliers & purchasing, customers with loyalty, reservations, virtual employees with attendance simulation, finance (P&L, expenses, refunds), reporting with CSV export, an audit trail, and a controllable **simulation engine** that drives virtual customers through the same transactional code paths as manual operations.

> This is a demonstration project. All displayed data is illustrative.
> Made with ❤️ by Talha — talhamalikawan@example.com

---

## Technology

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Framer Motion, Recharts, Lucide |
| Backend | Next.js Route Handlers (Node runtime) |
| Database | **Local SQLite file** (`local.db`) via Drizzle ORM + @libsql/client — zero setup, no external database |
| Auth | scrypt password hashing, DB-backed sessions (httpOnly cookie), role-based permissions enforced on the server |
| Simulation | Server-side engine singleton (`src/lib/simulation/engine.ts`) with tick loop + request-driven pump |

## Quick Start (Windows 11 / PowerShell)

Prerequisite: **Node.js 20+** only. No database server, no Docker, no accounts.

```powershell
# 1. Install dependencies
npm install

# 2. Run — done!
npm run dev     # development on http://localhost:3000
```

The first run automatically creates `local.db` (all 26 tables) and seeds the demo
restaurant (menu, recipes, stock, suppliers, virtual staff, ~120 real historical
orders). Nothing else to configure.

```powershell
npm run build; npm run start   # production mode

# Optional: wipe + reseed demo data at any time
npx tsx src/db/seed.ts
```

Sign in: **talhamalikawan@example.com** / **demo1234** (Administrator).

> Deploying? See **DEPLOYMENT.md** for GitHub push + hosting (Railway / Render / Vercel) instructions.

## Architecture

```
src/
  db/schema.ts            26 tables — users/roles, tables, menu, recipes, inventory,
                          suppliers/POs, customers, reservations, employees, attendance,
                          orders/items/payments/refunds, expenses, simulation, audit, settings
  lib/auth.ts             scrypt hashing, sessions, permission enforcement
  lib/services/orders.ts  THE business core — pricing, tax, state machine,
                          exactly-once inventory deduction (row locks + tx), payments,
                          refunds with inventory restore, table lifecycle
  lib/simulation/engine.ts virtual customers + virtual kitchen tick engine
  app/api/...             RESTish routes; every write runs inside db.transaction()
  app/(app)/...           16 pages: dashboard, POS, KDS, tables, menu, recipes,
                          inventory, purchasing, customers, reservations, employees,
                          finance, reports (CSV), simulation, audit, settings
```

## Core guarantees

- **Exactly-once deduction**: inventory is consumed only at order completion, inside a transaction guarded by `SELECT ... FOR UPDATE` + `inventory_deducted` flag. Duplicate completes are rejected (409).
- **Exactly-once payment**: unique constraint on `payments.order_id`.
- **Zero-setup local database**: SQLite file auto-created and auto-seeded at first boot (`src/db/index.ts` + `src/instrumentation.ts`).
- **Negative stock** is blocked transactionally unless the audited override (`allowNegativeStock`) is enabled in Settings.
- **Refunds** restore consumed inventory (`refund_restore` movements) and never double-count.
- **Historical integrity**: order items snapshot name/price/tax; recipe edits only affect future orders.
- **RBAC**: roles (Administrator, Manager, Cashier, Kitchen Staff, Inventory Manager, Accountant) with permission checks on every mutation route.
- **Audit trail**: all important operations logged with actor + payload.

## Simulation Engine

Modes: **Assisted** (engine creates guests/orders; you cook & charge), **Automatic** (end-to-end: arrival → kitchen → ready → paid → table freed → cleaned), **Stress test** (burst of up to 40 concurrent takeaway orders). Controls: start / pause / resume / stop / reset / speed ×0.5–×10 / arrival frequency / operating hours / order size. **Reset** deletes all simulation-generated orders and restores every consumed ingredient.

The engine calls the same `createOrder` / `transitionOrder` service functions as the POS — there is no separate fake transaction logic.

## API Overview

`POST /api/auth/login|logout`, `GET /api/auth/me` · `GET|PUT /api/settings` · `GET /api/dashboard?range=` · `GET|POST /api/orders`, `GET|PATCH /api/orders/:id` · `GET|POST|PATCH|DELETE /api/menu/:entity` · `GET|PUT /api/recipes` · `GET|POST|PATCH /api/tables` · `GET|POST|PATCH /api/inventory` · `GET|POST|PATCH /api/suppliers` · `GET|POST /api/purchases`, `PATCH /api/purchases/:id` · `GET|POST|PATCH /api/customers` · `GET|POST|PATCH /api/reservations` · `GET|POST|PATCH /api/employees` (incl. `simulate_attendance`) · `GET|POST|DELETE /api/expenses` · `GET /api/reports?type=&range=&format=csv` · `GET|POST /api/simulation/:action` · `GET /api/audit` · `GET /api/health`

## Testing workflows (manual QA matrix)

1. POS: create takeaway order → totals computed server-side (subtotal → discount → 8.5%/4.25% tax → total).
2. KDS: confirmed → preparing → ready; POS: ready → charge (cash/card/mobile) → completed.
3. Inventory: stock drops by exactly `recipe qty × order qty`; movement rows recorded.
4. Double-complete → 409 rejection; payment unique.
5. Insufficient stock → completion rolled back, order stays `ready`, clear error message.
6. Refund → status cancelled, refund row, inventory restored from movement history.
7. Reservations: overlapping ±2h booking on same table → 409 with explanation.
8. Purchasing: draft → approve → receive (partial supported) → stock increases, PO total recorded.
9. Dashboard & all 10 reports read live DB aggregates; `format=csv` downloads real data.
10. Simulation: run 2 min automatic mode → orders appear in POS/KDS/reports; reset restores everything.
11. Restart resilience: all data is in PostgreSQL; refresh/restart loses nothing.
