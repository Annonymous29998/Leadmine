/**
 * LeadMine API entry for Railway / local.
 *
 * Railway healthchecks hit the container over IPv6. Bind host "::" with
 * ipv6Only:false (dual-stack). Never use 0.0.0.0 alone on Railway.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const ENV_PATH = path.join(ROOT, '.env');

if (existsSync(ENV_PATH)) {
  const envResult = config({ path: ENV_PATH });
  if (envResult.error) {
    console.warn(`Could not load .env from ${ENV_PATH}:`, envResult.error.message);
  } else {
    console.log(`.env loaded from ${ENV_PATH}`);
  }
} else {
  console.log('No .env file (using process env — normal on Railway)');
}

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err);
});

const parsedPort = Number.parseInt(String(process.env.PORT || '3002'), 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3002;

/** Dual-stack IPv6 — required for Railway edge / healthchecks */
const HOST = '::';

const DEFAULT_EXPORTS =
  process.env.EXPORTS_DIR?.trim() ||
  (process.env.RAILWAY_ENVIRONMENT ? '/tmp/leadmin-exports' : path.join(ROOT, 'exports'));

try {
  mkdirSync(DEFAULT_EXPORTS, { recursive: true });
} catch (err) {
  console.warn('Could not create exports dir (non-fatal):', DEFAULT_EXPORTS, err);
}

console.log('[boot]', {
  PORT,
  HOST,
  cwd: process.cwd(),
  root: ROOT,
  exports: DEFAULT_EXPORTS,
  node: process.version,
  railway: Boolean(process.env.RAILWAY_ENVIRONMENT),
  hasSerper: Boolean(process.env.SERPER_API_KEY?.trim()),
  hasSerpapi: Boolean(process.env.SERPAPI_KEY?.trim()),
  searchEconomy: process.env.SEARCH_ECONOMY !== '0',
  loginConfigured: Boolean(
    process.env.ADMIN_EMAIL?.trim() && process.env.ADMIN_PASSWORD,
  ),
});

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({
  ok: true,
  name: 'LeadMine Extractor',
  phase: 'ready',
}));
app.get('/health', async () => ({ ok: true }));

try {
  const { registerApp } = await import('./attach.js');
  await registerApp(app, { root: ROOT, exportsDir: DEFAULT_EXPORTS });
} catch (err) {
  console.error('Failed to register app routes:', err);
  process.exit(1);
}

try {
  await app.listen({
    port: PORT,
    host: HOST,
    // Accept IPv4-mapped clients on the same socket (Railway + local curl)
    ipv6Only: false,
  });
} catch (err) {
  console.error('Failed to bind HTTP server', { PORT, HOST, err });
  process.exit(1);
}

console.log(`LeadMine listening on [${HOST}]:${PORT} (dual-stack)`);
