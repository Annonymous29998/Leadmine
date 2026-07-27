/**
 * Live API smoke — expects API on PORT (default 3002).
 * Run: npm run smoke
 */
import assert from 'node:assert/strict';

const BASE = process.env.SMOKE_BASE || `http://127.0.0.1:${process.env.PORT || 3002}`;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { res, text, json };
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function main() {
  console.log(`Smoke → ${BASE}`);

  const health = await get('/api/health');
  assert.equal(health.res.status, 200);
  assert.equal(health.json.ok, true);
  console.log('✓ GET /api/health');

  const settings = await get('/api/settings');
  assert.equal(settings.res.status, 200);
  assert.equal(typeof settings.json.hasSerpapi, 'boolean');
  console.log(
    `✓ GET /api/settings (provider=${settings.json.searchProvider ?? '?'}, ready=${settings.json.hasSerpapi})`,
  );

  const idle = await get('/api/get_progress');
  assert.equal(idle.res.status, 200);
  assert.ok(
    ['idle', 'running', 'completed', 'stopped', 'error', 'starting'].includes(idle.json.status),
  );
  console.log(`✓ GET /api/get_progress (status=${idle.json.status})`);

  const extract = await post('/api/extract', {
    subject: 'smoke',
    location: '',
    domains: '',
    maxResults: 3,
    mode: 'urls',
    fileContent: '<p>Contact: alice.wonder@gmail.com</p>',
    fileName: 'smoke.html',
  });
  assert.ok(extract.res.status === 200, `extract failed: ${JSON.stringify(extract.json)}`);
  const emails = extract.json.emails ?? [];
  assert.ok(emails.some((e) => e.email === 'alice.wonder@gmail.com'));
  console.log(`✓ POST /api/extract (urls/file) → ${emails.length} email(s)`);

  const stop = await post('/api/stop_extraction', {});
  assert.ok(stop.res.status === 200);
  console.log('✓ POST /api/stop_extraction');

  // UI reachable when Vite or static serve is up (optional)
  try {
    const ui = await fetch(process.env.SMOKE_UI || 'http://127.0.0.1:5174/');
    if (ui.ok) console.log('✓ GET UI / (Vite)');
    else console.log(`· UI check skipped (status ${ui.status})`);
  } catch {
    console.log('· UI check skipped (not running)');
  }

  console.log('\nSmoke passed.');
}

main().catch((err) => {
  console.error('\nSmoke FAILED:', err);
  process.exit(1);
});
