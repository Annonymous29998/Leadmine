#!/bin/sh
set -eu
echo "[entrypoint] node=$(node -v) cwd=$(pwd) PORT=${PORT:-} NODE_ENV=${NODE_ENV:-}"
echo "[entrypoint] listing dist:"
ls -la /app/apps/api/dist/index.js /app/apps/api/dist/attach.js /app/apps/web/dist/index.html
exec node /app/apps/api/dist/index.js
