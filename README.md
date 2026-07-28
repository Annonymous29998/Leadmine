# LeadMine Extractor

Web app for extracting publicly available emails (Sniffy-style crawl + validation).

**Stack:** Vite + React + TypeScript · Fastify API · Node 20+

## Local development

```bash
cp .env.example .env
# add SERPER_API_KEY and/or SERPAPI_KEY

npm install
npm run dev
```

- Web: http://localhost:5174  
- API: http://localhost:3002  

## Production (one process)

```bash
npm run build
npm start
```

API serves the SPA and listens on `0.0.0.0:$PORT` (default `3002`).

## Deploy on Railway

See steps below after pushing to GitHub. Required files already in the repo:

- `Dockerfile` — Node 20 multi-stage build (Railway uses this)
- `railway.toml` — Dockerfile builder + healthcheck + start command
- `Procfile` — `web: node apps/api/dist/index.js`
- `.nvmrc` — Node 20 

### Railway checklist

1. Push this repo to GitHub (`Annonymous29998/Leadmine`).
2. Open [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select **Leadmine**.
3. Open the service → **Variables** and add:
   - `SERPER_API_KEY` = your Serper key (recommended)
   - `SERPAPI_KEY` = your SerpAPI key (optional; both = more URLs)
   - Do **not** set `PORT` — Railway injects it automatically.
4. **Settings → Networking** → **Generate Domain** (public HTTPS URL).
5. Wait for deploy. Image builds via `Dockerfile`; healthcheck hits `/api/health`.
6. Open the Railway URL — UI + API are on the same origin.

### If the build / healthcheck fails

- Confirm deploy uses **Dockerfile** (not Nixpacks).
- Confirm root `package-lock.json` is committed.
- Check **Deploy Logs** (not only Build Logs) for crash messages.
- Rebuild after env vars are set (keys are runtime-only).

## Env vars

| Variable | Required | Notes |
|----------|----------|--------|
| `SERPER_API_KEY` | Recommended | [serper.dev](https://serper.dev/) |
| `SERPAPI_KEY` | Optional | [serpapi.com](https://serpapi.com/) |
| `ADMIN_EMAIL` | Required for login | e.g. `admin@leadmine.com` |
| `ADMIN_PASSWORD` | Required for login | Your login password |
| `AUTH_SECRET` | Optional | Session signing secret |
| `PORT` | Auto on Railway | Local default `3002` |
| `ENABLE_SMTP_CHECK` | Optional | Set `1` for SMTP probe |

Never commit `.env`.
