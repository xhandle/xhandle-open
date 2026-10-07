// Keep all cursor advancement inside the request callback. In particular, a
// queued success event may still arrive after our timeout has aborted the scan.
export function inspectStorageStore(db, storeName, byteLength, timeoutMs = 5000) {
  return new Promise(resolve => {
    let count = 0;
    let bytes = 0;
    let sampleKey = '';
    let tx;
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { db.close(); } catch {}
      resolve({ count, bytes, sampleKey, error });
    };
    const timer = setTimeout(() => {
      finish('Store scan timed out; totals may be incomplete.');
      try { tx?.abort(); } catch {}
    }, timeoutMs);
    try {
      tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).openCursor();
      request.onsuccess = () => {
        if (finished) return;
        try {
          const cursor = request.result;
          if (!cursor) return;
          count += 1;
          if (!sampleKey) sampleKey = String(cursor.key || '');
          try { bytes += byteLength(cursor.value); } catch {}
          cursor.continue();
        } catch (error) {
          finish(`Store scan stopped; totals may be incomplete. ${error?.message || String(error)}`);
          try { tx.abort(); } catch {}
        }
      };
      request.onerror = () => finish(request.error?.message || 'Unable to inspect store.');
      tx.oncomplete = () => finish('');
      tx.onerror = () => finish(tx.error?.message || 'Unable to inspect store.');
      tx.onabort = () => finish(tx.error?.message || 'Store scan was aborted.');
    } catch (error) {
      finish(error?.message || String(error));
    }
  });
}
