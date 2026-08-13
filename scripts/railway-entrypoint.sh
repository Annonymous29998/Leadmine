#!/bin/sh
set -eu
echo "[entrypoint] node=$(node -v) cwd=$(pwd) PORT=${PORT:-} NODE_ENV=${NODE_ENV:-} SERVE_WEB=${SERVE_WEB:-}"
echo "[entrypoint] listing api dist:"
ls -la /app/apps/api/dist/index.js /app/apps/api/dist/attach.js
if [ -f /app/apps/web/dist/index.html ]; then
  echo "[entrypoint] web dist present (optional)"
else
  echo "[entrypoint] API-only mode (no web dist — expect Vercel frontend)"
fi
exec node /app/apps/api/dist/index.js
