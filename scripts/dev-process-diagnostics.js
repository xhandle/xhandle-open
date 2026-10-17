// Observe process failures without suppressing Node's normal crash behavior.
function installDevProcessDiagnostics(role, runtime = process, log = line => console.error(line)) {
  let stoppingSignal = null;
  const emit = (event, extra = {}) => log(`[xhandle-process] ${JSON.stringify({ event, role, pid: runtime.pid, at: new Date().toISOString(), ...extra })}`);
  emit('started');
  runtime.on('uncaughtExceptionMonitor', (error, origin) => {
    // Avoid serializing request objects, credentials, or source payloads.
    emit('fatal-error', { origin, errorName: error?.name, errorCode: error?.code });
  });
  ['SIGINT', 'SIGTERM'].forEach(signal => runtime.once(signal, () => {
    stoppingSignal = signal;
    emit('stopping', { signal });
    // once() removes this listener before invocation. Let existing shutdown
    // handlers run; only supply default termination when none are installed.
    if (runtime.listenerCount(signal) === 0) runtime.exit(signal === 'SIGINT' ? 130 : 143);
  }));
  runtime.once('exit', code => emit('exited', { code, signal: stoppingSignal,
    message: 'If started with npm run dev, either process exiting stops both. Restart npm run dev to restore the app.' }));
}
module.exports = { installDevProcessDiagnostics };
