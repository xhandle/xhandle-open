// Inventory must never materialize analysis records just to count them.
export function inspectStorageStore(db, storeName, { signal, timeoutMs = 5000 } = {}) {
  return new Promise(resolve => {
    let count = null;
    let tx;
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      try { db.close(); } catch {}
      resolve({ count, bytes: null, error });
    };
    const stop = message => {
      finish(message);
      try { tx?.abort(); } catch {}
    };
    const cancel = () => stop('Storage scan cancelled.');
    const timer = setTimeout(() => stop('Store count timed out; count is unavailable.'), timeoutMs);
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).count();
      request.onsuccess = () => { if (!finished) count = request.result; };
      request.onerror = () => stop(request.error?.message || 'Unable to count store.');
      tx.oncomplete = () => finish('');
      tx.onerror = () => stop(tx.error?.message || 'Unable to count store.');
      tx.onabort = () => finish(tx.error?.message || 'Store count was aborted.');
    } catch (error) { stop(error?.message || String(error)); }
  });
}
