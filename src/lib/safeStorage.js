export function isStorageQuotaError(error) {
  return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014;
}

export function runStorageWrite(write, { onQuota, onError } = {}) {
  try {
    write();
    return true;
  } catch (error) {
    if (isStorageQuotaError(error)) onQuota?.(error);
    else onError?.(error);
    return false;
  }
}
