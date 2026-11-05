# Deploying RestaurantOS — GitHub & Sharing Guide

## Run it anywhere (100% local)

RestaurantOS stores everything in a SQLite file (`local.db`) inside the project.
No PostgreSQL, no Docker, no cloud accounts — just Node.js 20+.

```powershell
git clone https://github.com/<your-username>/restaurantos.git
cd restaurantos
npm install
npm run dev        # http://localhost:3000 — database auto-created + seeded
```

That is the entire setup. The same commands work identically on Windows, macOS
and Linux, so anyone who clones the repo gets a working restaurant immediately.

## Push to GitHub

`.env`, `local.db`, `node_modules` and `.next` are git-ignored — your local data
and secrets never leave your machine.

```powershell
git remote add origin https://github.com/<your-username>/restaurantos.git
git push -u origin main
```

(If needed first: `git branch -M main`, or `gh repo create restaurantos --public --source . --push`.)

## What not to commit

- `local.db` / `local.db-*` — your copy of the demo data (ignored; fresh clones get their own auto-seeded DB)
- `.env` — only if you add real secrets later (`.env.example` documents the default)

## Hosting it (optional)

It still works on any Node host (Railway, Render, a VPS): `npm run build && npm run start`.
Because the database is a local file, prefer hosts with persistent disks; on
read-only serverless platforms the app falls back gracefully but data will not persist.
