import { spawn } from 'node:child_process';

const child = spawn('node', ['/app/apps/api/dist/index.js'], {
  env: {
    ...process.env,
    PORT: '3099',
    NODE_ENV: 'production',
    EXPORTS_DIR: '/tmp/leadmin-exports',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
child.stdout.on('data', (d) => {
  log += d;
  process.stdout.write(d);
});
child.stderr.on('data', (d) => {
  log += d;
  process.stderr.write(d);
});

const deadline = Date.now() + 25_000;
let ok = false;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400));
  try {
    const res = await fetch('http://127.0.0.1:3099/api/health');
    const body = await res.text();
    console.log('smoke health', res.status, body);
    if (res.ok && body.includes('"ok":true')) {
      ok = true;
      break;
    }
  } catch {
    // not up yet
  }
}

child.kill('SIGTERM');
await new Promise((r) => child.on('exit', r));

if (!ok) {
  console.error('SMOKE TEST FAILED. Server log:\n', log);
  process.exit(1);
}
console.log('smoke test passed');
