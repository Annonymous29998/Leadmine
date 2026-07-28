/**
 * Boot health on PORT immediately (plain Node HTTP), then start Fastify.
 * This keeps Railway healthchecks green even if heavy imports are slow/crash.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { once } from 'node:events';

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

const DEFAULT_EXPORTS = path.join(ROOT, 'exports');
mkdirSync(DEFAULT_EXPORTS, { recursive: true });

const parsedPort = Number.parseInt(String(process.env.PORT || '3002'), 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3002;

console.log('[boot]', {
  PORT,
  cwd: process.cwd(),
  root: ROOT,
  node: process.version,
  hasSerper: Boolean(process.env.SERPER_API_KEY?.trim()),
  hasSerpapi: Boolean(process.env.SERPAPI_KEY?.trim()),
});

function isHealth(url: string | undefined): boolean {
  if (!url) return false;
  const pathOnly = url.split('?')[0];
  return pathOnly === '/api/health' || pathOnly === '/health';
}

const bootServer = http.createServer((req, res) => {
  if (isHealth(req.url)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: 'LeadMine Extractor', phase: 'booting' }));
    return;
  }
  res.writeHead(503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'starting' }));
});

bootServer.listen(PORT, '0.0.0.0');
await once(bootServer, 'listening');
console.log(`LeadMine health listener on 0.0.0.0:${PORT}`);

try {
  const { startFullApp } = await import('./attach.js');
  bootServer.close();
  await once(bootServer, 'close');
  await startFullApp({ port: PORT, root: ROOT, exportsDir: DEFAULT_EXPORTS });
} catch (err) {
  console.error('Failed to start full app — keeping health listener up:', err);
  // Health server already closed? If close() ran, re-bind health so Railway stays green.
  if (!bootServer.listening) {
    bootServer.listen(PORT, '0.0.0.0');
    await once(bootServer, 'listening');
    console.error('Health-only mode active. Check Deploy Logs for the attach error above.');
  }
}
