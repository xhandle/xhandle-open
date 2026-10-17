const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installDevProcessDiagnostics } = require('./dev-process-diagnostics');
const { spawnSync } = require('node:child_process');
test('real signals preserve cleanup installed before or after diagnostics', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) for (const before of [true, false]) {
    const cleanup = `process.once('${signal}', () => { console.log('CLEANUP_RAN'); process.exit(0); });`;
    const script = `${before ? cleanup : ''} require(${JSON.stringify(require.resolve('./dev-process-diagnostics'))}).installDevProcessDiagnostics('WEB'); ${before ? '' : cleanup} process.kill(process.pid, '${signal}'); setTimeout(() => {}, 100);`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0); assert.match(result.stdout, /CLEANUP_RAN/);
  }
});
test('logs crash and signal diagnostics without swallowing fatal exceptions or exposing payloads', () => {
  const runtime = new EventEmitter(); runtime.pid = 42;
  runtime.exit = code => runtime.emit('exit', code);
  const logs = [];
  installDevProcessDiagnostics('API', runtime, line => logs.push(line));
  runtime.emit('uncaughtExceptionMonitor', Object.assign(new Error('secret payload'), { code: 'TEST' }), 'unhandledRejection');
  assert.equal(runtime.listenerCount('uncaughtException'), 0);
  runtime.emit('SIGTERM');
  assert.equal(logs.some(line => line.includes('secret payload')), false);
  assert.equal(logs.some(line => line.includes('"code":143')), true);
  assert.equal(logs.some(line => line.includes('"event":"fatal-error"')), true);
});
