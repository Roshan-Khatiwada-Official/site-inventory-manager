# Deployment Report — Site & Inventory Manager

A short record of how and where this app is hosted, so anyone picking this
up later doesn't have to reverse-engineer it.

## Live URLs

| Layer | Provider | URL |
|---|---|---|
| Frontend | Vercel (free) | https://site-inventory-manager.vercel.app |
| Backend API | Render (free) | https://site-inventory-backend-mc1y.onrender.com |
| Database | Neon Postgres (free) | managed via the Neon dashboard |

## Architecture

```
Browser → Vercel (static React/Vite build)
            │  fetch() calls, with x-api-token header
            ▼
          Render (Node/Express API, auto-deploys from `main`)
            │  Prisma ORM
            ▼
          Neon (managed Postgres)
```

- **Frontend** (`frontend/`): built with `npm run build`, served as static
  files by Vercel's CDN. Config: `frontend/vercel.json`. Root directory on
  Vercel is set to `frontend`.
- **Backend** (`backend/`): Node + Express + Prisma. Deployed from
  `render.yaml` at the repo root (a Render "Blueprint" — Render reads this
  file to know how to build/start the service). Root directory on Render is
  `backend`.
- **Database**: Neon's free tier (0.5 GB storage). The schema and all
  existing data (users, sites, inventory, assignments, logs) were migrated
  from the local development database at setup time.

## Auto-deploy

Both Vercel and Render are connected directly to the `main` branch of this
GitHub repo. Every push to `main` triggers a new build and deploy on both
sides automatically — no manual redeploy step needed after a code change.

## Environment variables

Actual secret values live only in the Render/Vercel dashboards, never in
this repo. Names and purpose, for reference:

**Render (backend) → Environment tab:**
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string (pooled) |
| `CORS_ORIGIN` | Locked to `https://site-inventory-manager.vercel.app` — only this origin may call the API from a browser |
| `API_TOKEN` | Shared-secret header the frontend must send on every request |

**Vercel (frontend) → Project Settings → Environment Variables:**
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Points at the Render backend URL above |
| `VITE_API_TOKEN` | Must match `API_TOKEN` on Render exactly |

To rotate the API token: change `API_TOKEN` on Render and `VITE_API_TOKEN`
on Vercel to the same new value, save both (each redeploys on save).

## Known limitation: cold starts

The backend is on Render's **free** tier, which sleeps after ~15 minutes of
no traffic. The first request after that wakes it up, taking roughly
10–50 seconds before the app responds. Every request after that is normal
speed until it goes idle again.

To remove this entirely, upgrade only the Render service to the Starter
plan (~$7/month) — the frontend (Vercel) and database (Neon) can stay free
either way.

## Free-tier limits to watch

- **Neon**: 0.5 GB database storage (current usage is well under this).
- **Render free web service**: sleeps when idle (see above); no storage
  limit concern since it holds no persistent data itself.
- **Vercel free (Hobby)**: generous bandwidth/build limits for a project
  this size — not a practical concern here.
