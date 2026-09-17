import { isStorageQuotaError, runStorageWrite } from './safeStorage';

test('recognizes browser quota errors without relying on one browser message', () => {
  expect(isStorageQuotaError({ name: 'QuotaExceededError' })).toBe(true);
  expect(isStorageQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
  expect(isStorageQuotaError({ code: 22 })).toBe(true);
  expect(isStorageQuotaError(new Error('network failed'))).toBe(false);
});

test('contains quota failures and reports them once to the caller', () => {
  const onQuota = jest.fn();
  const result = runStorageWrite(() => {
    throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  }, { onQuota });
  expect(result).toBe(false);
  expect(onQuota).toHaveBeenCalledTimes(1);
});

test('returns true for a successful storage write', () => {
  const write = jest.fn();
  expect(runStorageWrite(write)).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
});
