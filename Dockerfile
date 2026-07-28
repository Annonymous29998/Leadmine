# LeadMine — production image for Railway
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --include=dev

COPY . .

RUN npm run build \
  && test -f /app/apps/api/dist/index.js \
  && test -f /app/apps/api/dist/attach.js \
  && test -f /app/apps/web/dist/index.html \
  && npm prune --omit=dev \
  && node -e "import('fastify').then(()=>console.log('fastify ok'))"

ENV NODE_ENV=production
# Railway injects PORT. HOST=:: so healthchecks reach the process over IPv6.
ENV HOST=::
EXPOSE 3000

CMD ["node", "/app/apps/api/dist/index.js"]
