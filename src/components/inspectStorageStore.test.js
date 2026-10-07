import { inspectStorageStore } from './inspectStorageStore';

function fixture() {
  const request = {};
  const tx = { objectStore: jest.fn(() => ({ openCursor: () => request })), abort: jest.fn() };
  const db = { transaction: jest.fn(() => tx), close: jest.fn() };
  return { db, tx, request };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a queued cursor success after timeout neither continues nor changes partial totals', async () => {
  const { db, tx, request } = fixture();
  const scan = inspectStorageStore(db, 'rows', value => value.length);
  const advance = jest.fn();
  request.result = { key: 'one', value: 'abc', continue: advance };
  request.onsuccess();
  jest.advanceTimersByTime(5000);
  const result = await scan;
  expect(result).toMatchObject({ count: 1, bytes: 3, sampleKey: 'one', error: expect.stringContaining('timed out') });
  // Reproduce Safari delivering an already queued event after abort.
  request.result = { key: 'two', value: 'def', continue: () => { throw new DOMException('Transaction is inactive', 'TransactionInactiveError'); } };
  expect(() => request.onsuccess()).not.toThrow();
  tx.onabort(); tx.oncomplete();
  expect(result.count).toBe(1);
  expect(advance).toHaveBeenCalledTimes(1);
  expect(tx.abort).toHaveBeenCalledTimes(1);
  expect(db.close).toHaveBeenCalledTimes(1);
  expect(db.transaction).toHaveBeenCalledWith('rows', 'readonly');
});

test('cursor errors are reported as partial scans instead of uncaught browser errors', async () => {
  const { db, tx, request } = fixture();
  const scan = inspectStorageStore(db, 'rows', () => 10);
  request.result = { key: 'a', value: {}, continue: () => { throw new DOMException('Transaction is inactive', 'TransactionInactiveError'); } };
  expect(() => request.onsuccess()).not.toThrow();
  expect(await scan).toMatchObject({ count: 1, bytes: 10, error: expect.stringContaining('totals may be incomplete') });
  expect(tx.abort).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('normal completion returns full totals and cancels the timeout', async () => {
  const { db, tx, request } = fixture();
  const scan = inspectStorageStore(db, 'rows', value => value.length);
  const advance = jest.fn();
  for (const [key, value] of [['a', 'abc'], ['b', 'de']]) {
    request.result = { key, value, continue: advance }; request.onsuccess();
  }
  request.result = null; request.onsuccess(); tx.oncomplete();
  expect(await scan).toEqual({ count: 2, bytes: 5, sampleKey: 'a', error: '' });
  jest.advanceTimersByTime(5000);
  expect(tx.abort).not.toHaveBeenCalled();
});

test('transaction abort and cursor request failure settle without a later continuation', async () => {
  for (const event of ['abort', 'error']) {
    const { db, tx, request } = fixture();
    const scan = inspectStorageStore(db, 'rows', () => 0);
    if (event === 'abort') tx.onabort(); else request.onerror();
    expect((await scan).error).toBeTruthy();
    const advance = jest.fn(); request.result = { key: 'late', continue: advance };
    request.onsuccess(); expect(advance).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
});
