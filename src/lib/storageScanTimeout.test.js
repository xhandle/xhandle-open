import { storageScanTimeout } from './storageScanTimeout';
afterEach(() => jest.useRealTimers());
test('returns successful scans', async () => {
  await expect(storageScanTimeout(() => Promise.resolve(123), 'scan')).resolves.toBe(123);
});
test('handles synchronous storage access failures', async () => {
  await expect(storageScanTimeout(() => { throw new Error('denied'); }, 'scan')).rejects.toThrow('denied');
});
test('releases a scan when the browser never responds', async () => {
  jest.useFakeTimers();
  const result = storageScanTimeout(() => new Promise(() => {}), 'Quota');
  const assertion = expect(result).rejects.toThrow('Quota timed out');
  jest.advanceTimersByTime(5000);
  await assertion;
});
