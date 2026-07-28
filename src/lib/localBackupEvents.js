export const BACKUP_DATA_CHANGED_EVENT = "xhandle:backup-data-changed";

export function notifyBackupDataChanged(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BACKUP_DATA_CHANGED_EVENT, { detail }));
}
