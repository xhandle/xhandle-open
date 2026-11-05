import { BACKUP_DATA_CHANGED_EVENT } from './localBackupEvents';

// One transaction-free connection keeps Chromium from repeatedly reopening the
// origin's backing store between short-lived reads in different databases.
// This owns no application records and never creates or upgrades a schema.
export function startWorkspaceStorageSession({
  factory = typeof window === 'undefined' ? undefined : window.indexedDB,
  backgroundMs = 60000,
  retryMs = 5000,
} = {}) {
  let stopped = false, connection = null, pending = null, backgroundTimer;
  let nextAttempt = 0;
  const close = () => {
    if (pending) pending.retired = true;
    connection?.close();
    connection = null;
  };
  const ensure = () => {
    if (stopped || document.visibilityState === 'hidden' || connection || pending || Date.now() < nextAttempt || !factory) return;
    const attempt = { retired: false };
    pending = attempt;
    let request;
    const failed = () => {
      if (pending === attempt) pending = null;
      nextAttempt = Date.now() + retryMs;
    };
    try { request = factory.open('xhandle'); } catch { failed(); return; }
    request.onupgradeneeded = () => {
      // A new workspace's normal storage owner must create its actual schema.
      request.transaction.abort();
    };
    request.onblocked = () => { attempt.retired = true; };
    request.onerror = failed;
    request.onsuccess = () => {
      pending = null;
      const db = request.result;
      if (stopped || attempt.retired || document.visibilityState === 'hidden') {
        db.close(); nextAttempt = Date.now() + retryMs; return;
      }
      connection = db;
      const release = () => {
        db.close();
        if (connection === db) connection = null;
        // Let the upgrading/deleting owner finish before a later interaction.
        nextAttempt = Date.now() + retryMs;
      };
      db.onversionchange = release;
      db.onclose = release;
    };
  };
  const visibility = () => {
    clearTimeout(backgroundTimer);
    if (document.visibilityState === 'hidden') backgroundTimer = setTimeout(close, backgroundMs);
    else ensure();
  };
  const pagehide = () => { clearTimeout(backgroundTimer); close(); };
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('pageshow', ensure);
  window.addEventListener('pointerdown', ensure, { passive: true });
  window.addEventListener('keydown', ensure);
  window.addEventListener(BACKUP_DATA_CHANGED_EVENT, ensure);
  document.addEventListener('visibilitychange', visibility);
  ensure();
  return () => {
    stopped = true; pagehide();
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('pageshow', ensure);
    window.removeEventListener('pointerdown', ensure);
    window.removeEventListener('keydown', ensure);
    window.removeEventListener(BACKUP_DATA_CHANGED_EVENT, ensure);
    document.removeEventListener('visibilitychange', visibility);
  };
}
