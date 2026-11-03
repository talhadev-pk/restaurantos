# Deploying RestaurantOS — GitHub & Hosting Guide

## 1. View it right now

The app is already running in this sandbox's preview:
open the preview URL shown above (port 3000) and sign in with
**talhamalikawan@example.com** / **demo1234**.

To run it on **your own Windows 11 machine** (PowerShell):

```powershell
git clone https://github.com/<your-username>/restaurantos.git
cd restaurantos
npm install
Copy-Item .env.example .env        # then edit DATABASE_URL to your PostgreSQL
npx drizzle-kit push               # create all tables
npx tsx src/db/seed.ts             # demo data (menu, recipes, stock, ~125 real orders)
npm run dev                        # http://localhost:3000
```

## 2. Push to GitHub

This project ships with a `.gitignore` that excludes `.env`, `node_modules` and
`.next`, so secrets never reach the repository.

```powershell
git remote add origin https://github.com/<your-username>/restaurantos.git
git push -u origin main
```

(If `main` doesn't exist locally: `git branch -M main` first.)

## 3. Make it work normally when hosted

RestaurantOS needs two things in production:

1. **A PostgreSQL database** — free options: [Neon](https://neon.tech),
   [Supabase](https://supabase.com), [Vercel Postgres], or your own server.
2. **A Node.js host that keeps a server process alive** — the simulation engine
   runs a background timer on the server.

### Recommended hosts

| Host | Notes |
| --- | --- |
| **Railway** | Easiest end-to-end: add a PostgreSQL plugin, copy its `DATABASE_URL` into the app's variables, deploy from the GitHub repo. Timer-based simulation engine works perfectly. |
| **Render** | Web Service + Render PostgreSQL. Set `DATABASE_URL`. Works perfectly. |
| **Fly.io / VPS / Docker** | `npm run build && npm run start`. Works perfectly. |
| **Vercel** | Works for the UI/API, but Vercel is *serverless*: background timers pause between requests. RestaurantOS includes a **request-driven pump fallback** (the engine advances whenever the UI polls status), so the simulation still progresses while the app is open — for the best simulation experience prefer Railway/Render. |

### Environment variables to set on the host

```
DATABASE_URL=postgresql://<user>:<password>@<host>/<db>?sslmode=require
```

### One-time setup on the host database

Most platforms run `npm run build` automatically. Database schema + demo data
are one-time commands you can run from your PC against the hosted database:

```powershell
$env:DATABASE_URL="postgresql://...your hosted url..."
npx drizzle-kit push
npx tsx src/db/seed.ts
```

Or add them to the host's release/post-deploy command.

## 4. What NOT to commit

- `.env` (contains your database password) — already ignored; commit only `.env.example`.
- Real customer or payment data — this project uses fictional demo data only.
