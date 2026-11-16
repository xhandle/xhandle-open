/* global globalThis */
export const BACKUP_DATA_CHANGED_EVENT = "xhandle:backup-data-changed";

export function notifyBackupDataChanged(detail = {}) {
  if (typeof window === "undefined") {
    if (typeof globalThis !== "undefined" && typeof globalThis.postMessage === "function") globalThis.postMessage({ event: BACKUP_DATA_CHANGED_EVENT, detail });
    return;
  }
  window.dispatchEvent(new CustomEvent(BACKUP_DATA_CHANGED_EVENT, { detail }));
}
