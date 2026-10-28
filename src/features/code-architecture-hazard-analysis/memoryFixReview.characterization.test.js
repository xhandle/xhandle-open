// Regression coverage for the workspace memory review findings.
import { getLatestCodeArchitectureHazardRun } from './codeArchitectureHazardStore';
import { openHazardSchema } from './hazardSchema';

jest.mock('./hazardSchema', () => ({
  ...jest.requireActual('./hazardSchema'), openHazardSchema: jest.fn(),
}));

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test.each(['metadata', 'root'])('abort retires a pending %s transaction and allows the next load', async phase => {
  localStorage.clear();
  const previous = global.indexedDB;
  global.indexedDB = {};
  let retire;
  const done = new Promise((resolve, reject) => { retire = () => reject(new DOMException('Aborted', 'AbortError')); });
  const read = jest.fn(() => new Promise(() => {}));
  const blocked = {done, abort: jest.fn(() => retire()), objectStore: () => ({get: read, index: () => ({getAll: read})})};
  const ready = {done: Promise.resolve(), abort: jest.fn(), objectStore: () => ({index: () => ({getAll: async () => [{id: 'run', projectId: 'p', storageRevision: 'revision'}]})})};
  const db = {transaction: jest.fn().mockReturnValue(blocked), close: jest.fn()};
  if (phase === 'root') db.transaction.mockReturnValueOnce(ready);
  openHazardSchema.mockResolvedValue(db);
  const controller = new AbortController();
  const pending = getLatestCodeArchitectureHazardRun({projectId: 'p'}, {signal: controller.signal});
  const result = expect(pending).rejects.toMatchObject({name: 'AbortError'});
  try {
    await flush(); expect(read).toHaveBeenCalledTimes(1);
    controller.abort(); await result;
    expect(blocked.abort).toHaveBeenCalled(); expect(db.close).toHaveBeenCalledTimes(1);
    db.transaction.mockReturnValue({done: Promise.resolve(), objectStore: () => ({index: () => ({getAll: async () => []})})});
    expect(await getLatestCodeArchitectureHazardRun({projectId: 'other'})).toBeNull();
  } finally { controller.abort(); await result; global.indexedDB = previous; }
});
