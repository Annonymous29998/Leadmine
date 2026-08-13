# Deploy: Vercel (frontend) + Railway (API)
#
# 1) Railway (new project) — API only
#    - New Project → Deploy from GitHub → this repo
#    - Uses Dockerfile.api (railway.toml)
#    - Variables:
#        SERPER_API_KEY=
#        SERPAPI_KEY=
#        SEARCH_ECONOMY=1
#        ADMIN_EMAIL=admin@leadmine.com
#        ADMIN_PASSWORD=...
#        CORS_ORIGIN=https://YOUR-APP.vercel.app
#        EXPORTS_DIR=/tmp/leadmin-exports
#    - Generate a public domain (e.g. https://xxx.up.railway.app)
#    - Health: GET /api/health → {"ok":true,...}
#
# 2) Vercel — frontend
#    - Import same GitHub repo
#    - Framework: Other (vercel.json at repo root)
#    - Env (Production + Preview):
#        VITE_API_URL=https://xxx.up.railway.app
#    - Redeploy after setting VITE_API_URL (build-time)
#
# 3) Update Railway CORS_ORIGIN to your real Vercel URL, redeploy API
#
# Local: leave VITE_API_URL unset (Vite proxies /api → :3002)
