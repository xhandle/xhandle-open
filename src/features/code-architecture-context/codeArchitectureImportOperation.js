// An import can be abandoned even when a browser storage request never settles.
export function createCodeArchitectureImportOperation({ isCurrent = () => true, onProgress = () => {}, timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  let reason;
  const stop = error => { reason = error; controller.abort(error); };
  const check = () => {
    if (!isCurrent() && !controller.signal.aborted) stop(new Error('Import cancelled because the workspace changed.'));
    if (controller.signal.aborted) throw reason || controller.signal.reason || new Error('Import cancelled.');
  };
  return { signal: controller.signal, check,
    cancel: () => stop(new Error('Import cancelled. Existing project contents were preserved.')),
    async wait(label, work) {
      check(); onProgress(label);
      const timer = setTimeout(() => stop(new Error(`${label} timed out. Check browser storage availability and retry the import.`)), timeoutMs);
      let abort;
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(reason || controller.signal.reason || new Error('Import cancelled.'));
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      try { const result = await Promise.race([Promise.resolve().then(() => { check(); return work(); }), cancelled]); check(); return result; }
      finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
    },
  };
}
