/**
 * LeadMine API entry — listen once on :: (IPv6 dual-stack) for Railway.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

// Railway edge talks to containers over IPv6. Binding 0.0.0.0 (IPv4-only)
// makes healthchecks return "service unavailable" even when the app is up.
const HOST = process.env.HOST || '::';

console.log('[boot]', {
  PORT,
  HOST,
  cwd: process.cwd(),
  root: ROOT,
  node: process.version,
  hasSerper: Boolean(process.env.SERPER_API_KEY?.trim()),
  hasSerpapi: Boolean(process.env.SERPAPI_KEY?.trim()),
});

try {
  const { startFullApp } = await import('./attach.js');
  await startFullApp({ port: PORT, host: HOST, root: ROOT, exportsDir: DEFAULT_EXPORTS });
} catch (err) {
  console.error('Failed to start LeadMine:', err);
  process.exit(1);
}
