# Deploying RestaurantOS — Going Live Guide

## Run it locally (any PC, no setup)

```powershell
git clone https://github.com/<your-username>/restaurantos.git
cd restaurantos
npm install
npm run dev        # http://localhost:3000 — database auto-created + seeded
```

---

## Go LIVE — Option A: Railway (recommended, easiest)

Railway runs your GitHub repo as a 24/7 website. The repo ships with a
`Dockerfile` + `railway.json`, so everything is detected automatically.

1. Push the project to GitHub (see README / chat instructions).
2. Go to **https://railway.app** → sign in with GitHub.
3. **New Project** → **Deploy from GitHub repo** → pick `restaurantos`.
4. Railway auto-detects the `Dockerfile` and builds (first build ~3–5 min).
5. Add a volume so the SQLite database persists across redeploys:
   your service → **Volumes** → **New Volume** → mount path `/app/data`.
   Then set a variable so the DB lives on the volume:
   **Variables** → `DATABASE_URL` = `file:/app/data/local.db`
6. **Settings → Networking → Generate Domain** → you get a public URL like
   `restaurantos-production.up.railway.app`.
7. Open it, sign in: **talhamalikawan@example.com** / **demo1234**.

That's it — live website, real database, simulation engine running 24/7.
Railway free trial (~$5 credit) covers weeks of demo usage.

## Option B: Render

1. Push to GitHub.
2. **https://render.com** → **New +** → **Web Service** → connect repo → Runtime: **Docker**.
3. Free tier works, but note: the filesystem is rebuilt on each deploy
   (demo data is regenerated automatically on first boot — acceptable for demos).

## Option C: Host it from YOUR PC (100% free, data stays local)

Your own computer becomes the server. The site is live while the PC is on.

```powershell
# Terminal 1 — run the production build
npm run build
npm run start          # serves on port 3000

# Terminal 2 — free public tunnel (no account needed)
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public URL like `https://random-words.trycloudflare.com` —
share it with anyone. Your data never leaves your machine.

## Option D: Docker anywhere (VPS, home server, etc.)

```bash
docker build -t restaurantos .
docker run -d -p 3000:3000 -v restaurantos-data:/app/data \
  -e DATABASE_URL=file:/app/data/local.db restaurantos
```

---

## What NOT to commit / expose

- `local.db*` — local database (git-ignored; hosts create their own)
- `.env` — only add it to hosts' env-variable panels if you customize the DB path
- Never commit real credentials; this project ships with fictional demo data
