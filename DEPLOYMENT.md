# RestaurantOS — Going Live (GitHub Pages & Friends)

## GitHub Pages (free, recommended)

One-time setup:
1. Push the project to a GitHub repository (see README).
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Push anything to `main` (or run the workflow manually via **Actions → Deploy → Run workflow**).
4. Visit `https://<username>.github.io/<repo>/` — the restaurant opens, self-initializes, done.

The workflow (`.github/workflows/deploy-pages.yml`) sets `VITE_BASE=/<repo-name>/`
automatically. Routing is hash-based, so page refreshes and direct links always work.

## Local static build (any static host / folder)

```powershell
npm run build:vite        # outputs ./dist
npm run preview:vite      # test the production build locally
```

Upload `dist/` to literally any static host (Netlify Drop, Cloudflare Pages, S3, a USB stick + `npx serve dist`).

## Data portability

- Export/Import via **Storage & Backup** page in the app (JSON, schema-validated).
- Move between devices by exporting on one and importing on the other.
