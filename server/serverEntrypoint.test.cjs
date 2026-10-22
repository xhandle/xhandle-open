const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('development launcher starts the exported API and serves requests', { timeout: 20000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-server-test-'));
  const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/dev-server.js')], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: 'development', PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let timer;
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      timer = setTimeout(() => reject(new Error('API startup timed out')), 15000);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`API exited early (${code})`)));
      child.stderr.on('data', () => {});
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/localhost:(\d+)/);
        if (match) resolve(Number(match[1]));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/chat/ping`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    const transfer = await fetch(`http://127.0.0.1:${port}/api/workspace-transfer/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(transfer.status, 200);
    assert.deepEqual((await transfer.json()).baselines, []);
  } finally {
    clearTimeout(timer);
    child.kill();
    await closed;
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
