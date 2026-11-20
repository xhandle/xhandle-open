import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { readAnalysisSourceRecord, writeAnalysisSourceRecord, retryAnalysisStorage, analysisStorageError } from './analysisSourceStorage';
import { openCbaIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { putRawRecord } from '../code-architecture-storage/chunkedRecord';

const original = { indexedDB:global.indexedDB, crypto:global.crypto, TextEncoder:global.TextEncoder, structuredClone:global.structuredClone };
beforeEach(() => {
  global.indexedDB = new IDBFactory(); global.crypto = webcrypto; global.TextEncoder = TextEncoder;
  global.structuredClone = value => deserialize(serialize(value));
});
afterEach(() => { Object.assign(global, original); jest.restoreAllMocks(); });

test('a 24-file run survives a final checkpoint-commit abort after 13 completed files', async () => {
  const key = 'functional-decomposition-checkpoint:cba:fixture:repo:abort';
  const put = IDBObjectStore.prototype.put, onRetry = jest.fn(); let armed = false, aborts = 0;
  jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (entry, ...args) {
    const result = put.call(this, entry, ...args);
    if (armed && entry.key === key) { armed = false; aborts++; this.transaction.abort(); }
    return result;
  });
  for (let i = 1; i <= 24; i++) {
    await writeAnalysisSourceRecord('code_index', `source-${i}`, { path:`${i}.py`, content:'def control(): return command()' });
    if (i === 14) armed = true;
    await writeAnalysisSourceRecord('copilot_baseline', key, {
      phase:'extraction', totalFiles:24, completedPaths:Array.from({length:i}, (_, j) => `${j + 1}.py`),
      failedFiles:[], rows:[{from:'control',action:'Call command',to:'command'}],
    }, { onRetry, wait:async () => {} });
  }
  expect(aborts).toBe(1); expect(onRetry).toHaveBeenCalledTimes(1);
  expect(await readAnalysisSourceRecord('copilot_baseline', key)).toMatchObject({phase:'extraction',totalFiles:24,failedFiles:[]});
  expect((await readAnalysisSourceRecord('copilot_baseline', key)).completedPaths).toHaveLength(24);
  expect((await readAnalysisSourceRecord('code_index', 'source-24')).path).toBe('24.py');
});

test('a competing edit during recovery remains protected by the original baseline', async () => {
  const key = 'cba:fixture:competing', put = IDBObjectStore.prototype.put; let armed = true;
  jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (entry, ...args) {
    const result = put.call(this, entry, ...args);
    if (armed && entry.key === key) { armed = false; this.transaction.abort(); }
    return result;
  });
  await expect(writeAnalysisSourceRecord('copilot_baseline', key, [{from:'automatic'}], { wait:async () => {
    const db = await openCbaIndexedDB();
    try { await putRawRecord(db, 'copilot_baseline', key, [{from:'human edit'}]); } finally { db.close(); }
  } })).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
  expect(await readAnalysisSourceRecord('copilot_baseline', key)).toEqual([{from:'human edit'}]);
});

test('persistent aborts are bounded, quota errors are not retried and DOMExceptions are not mutated', async () => {
  const aborted = new DOMException('The operation was aborted.', 'AbortError');
  const operation = jest.fn().mockRejectedValue(aborted), wait = jest.fn(async () => {});
  await expect(retryAnalysisStorage(operation, { wait })).rejects.toBe(aborted);
  expect(operation).toHaveBeenCalledTimes(3); expect(wait).toHaveBeenCalledTimes(2);
  const quota = new DOMException('Storage is full.', 'QuotaExceededError'); operation.mockReset().mockRejectedValue(quota); wait.mockClear();
  await expect(retryAnalysisStorage(operation, { wait })).rejects.toBe(quota);
  expect(operation).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  const wrapped = analysisStorageError(aborted, 'Unable to save progress');
  expect(wrapped).toMatchObject({code:'SOURCE_STORAGE_FAILED',cause:aborted});
  expect(aborted.name).toBe('AbortError'); expect(aborted.code).not.toBe('SOURCE_STORAGE_FAILED');
});

test('user cancellation stops recovery before another transaction', async () => {
  const controller = new AbortController(), operation = jest.fn().mockRejectedValue(new DOMException('Transient.', 'AbortError'));
  await expect(retryAnalysisStorage(operation, { signal:controller.signal, wait:async () => controller.abort() })).rejects.toThrow(/cancelled|aborted/i);
  expect(operation).toHaveBeenCalledTimes(1);
});
