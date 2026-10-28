import {readHazardTransaction} from './readHazardTransaction';

test('an already-aborted load never opens a transaction', async () => {
  const controller = new AbortController(); controller.abort();
  const db = {transaction: jest.fn()};
  await expect(readHazardTransaction(db, 'rows', jest.fn(), {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
  expect(db.transaction).not.toHaveBeenCalled();
});

test('successful reads wait for completion and remove their timer and abort listener', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  let complete;
  const tx = {done: new Promise(resolve => {complete = resolve;}), objectStore: () => ({}), abort: jest.fn()};
  let settled = false;
  const pending = readHazardTransaction({transaction: () => tx}, 'rows', async () => 'saved', {signal: controller.signal});
  pending.then(() => {settled = true;});
  try {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toBe(false);
    complete(); expect(await pending).toBe('saved');
    expect(jest.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalled();
    controller.abort(); expect(tx.abort).not.toHaveBeenCalled();
  } finally {complete(); await pending; remove.mockRestore(); jest.useRealTimers();}
});

test('a synchronous read failure aborts and retires its transaction without masking the error', async () => {
  let retire;
  const tx = {done: new Promise((resolve, reject) => {retire = reject;}), objectStore: () => ({}), abort: jest.fn(() => retire(new Error('aborted')))};
  await expect(readHazardTransaction({transaction: () => tx}, 'rows', () => {throw new Error('read failed');})).rejects.toThrow('read failed');
  expect(tx.abort).toHaveBeenCalled();
});

test('timeout aborts a queued read and waits for transaction retirement', async () => {
  jest.useFakeTimers();
  let retire;
  const done = new Promise((resolve, reject) => {retire = () => reject(new DOMException('Aborted', 'AbortError'));});
  const tx = {done, abort: jest.fn(), objectStore: () => ({})};
  let settled = false;
  const pending = readHazardTransaction({transaction: () => tx}, 'rows', () => new Promise(() => {}), {readTimeoutMs: 20});
  const rejection = expect(pending).rejects.toThrow('timed out');
  pending.catch(() => {settled = true;});
  try {
    await Promise.resolve(); jest.advanceTimersByTime(20);
    for(let i=0;i<10;i++) await Promise.resolve();
    expect(tx.abort).toHaveBeenCalled(); expect(settled).toBe(false);
    retire(); await rejection; expect(jest.getTimerCount()).toBe(0);
  } finally {retire(); await rejection; jest.useRealTimers();}
});
