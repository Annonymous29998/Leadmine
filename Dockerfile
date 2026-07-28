# LeadMine — production image for Railway
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tmp/leadmin-exports

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --include=dev

COPY . .

RUN npm run build \
  && test -f /app/apps/api/dist/index.js \
  && test -f /app/apps/api/dist/attach.js \
  && test -f /app/apps/web/dist/index.html \
  && chmod +x /app/scripts/railway-entrypoint.sh

ENV NODE_ENV=production
ENV EXPORTS_DIR=/tmp/leadmin-exports

EXPOSE 3000

# Fails the image build if the server cannot serve /api/health
RUN node /app/scripts/smoke-health.mjs

CMD ["/app/scripts/railway-entrypoint.sh"]
