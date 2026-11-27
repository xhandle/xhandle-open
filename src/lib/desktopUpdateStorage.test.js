import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';

const original = { indexedDB: global.indexedDB, IDBKeyRange: global.IDBKeyRange, structuredClone: global.structuredClone, crypto: global.crypto, TextEncoder: global.TextEncoder };
let source, storage, chunks;
beforeEach(() => {
  jest.resetModules();
  global.indexedDB = new IDBFactory(); global.IDBKeyRange = IDBKeyRange;
  global.structuredClone = value => deserialize(serialize(value)); global.crypto = webcrypto; global.TextEncoder = TextEncoder;
  source = require('../features/code-architecture-context/analysisSourceStorage');
  storage = require('../features/code-architecture-assurance/codeArchitectureStorage');
  chunks = require('../features/code-architecture-storage/chunkedRecord');
});
afterEach(() => { jest.restoreAllMocks(); Object.assign(global, original); });
const key = 'functional-decomposition-checkpoint:cba:synthetic-project:synthetic-repo:run';
const progress = { phase: 'extraction', completedPaths: ['controller.py'], totalFiles: 2, rows: [{ from: 'Controller', action: 'Request stop', to: 'Actuator' }] };

test('automatically retries the last failed checkpoint and reads it back from a new connection', async () => {
  const failed = jest.spyOn(chunks, 'writeRecord').mockRejectedValueOnce(new DOMException('Synthetic full disk', 'QuotaExceededError'));
  await expect(source.writeAnalysisSourceRecord('copilot_baseline', key, progress)).rejects.toThrow('full disk');
  failed.mockRestore();
  await source.flushAnalysisSourceWrites();
  expect(await source.readAnalysisSourceRecord('copilot_baseline', key)).toEqual(progress);
});

test('failed saving remains a failure until storage/manual saving recovers', async () => {
  const failed = jest.spyOn(chunks, 'writeRecord').mockRejectedValue(new DOMException('Synthetic full disk', 'QuotaExceededError'));
  await expect(source.writeAnalysisSourceRecord('copilot_baseline', key, progress)).rejects.toThrow();
  await expect(source.flushAnalysisSourceWrites()).rejects.toThrow('full disk');
  failed.mockRestore();
  await source.writeAnalysisSourceRecord('copilot_baseline', key, progress);
  await expect(source.flushAnalysisSourceWrites()).resolves.toBeUndefined();
});

test('an automatic retry cannot overwrite a newer manually saved checkpoint', async () => {
  const failed = jest.spyOn(chunks, 'writeRecord').mockRejectedValueOnce(new DOMException('Synthetic full disk', 'QuotaExceededError'));
  await expect(source.writeAnalysisSourceRecord('copilot_baseline', key, progress)).rejects.toThrow();
  failed.mockRestore();
  const db = await storage.openCbaIndexedDB();
  try { await chunks.putRawRecord(db, 'copilot_baseline', key, { manual: 'Retain this revision' }); } finally { db.close(); }
  await expect(source.flushAnalysisSourceWrites()).rejects.toMatchObject({ code: 'SOURCE_PUBLICATION_CONFLICT' });
  expect(await source.readAnalysisSourceRecord('copilot_baseline', key)).toEqual({ manual: 'Retain this revision' });
});

test('autosaving cannot resurrect a permanently deleted project checkpoint', async () => {
  const failed = jest.spyOn(chunks, 'writeRecord').mockRejectedValueOnce(new DOMException('Synthetic full disk', 'QuotaExceededError'));
  await expect(source.writeAnalysisSourceRecord('copilot_baseline', key, progress)).rejects.toThrow();
  failed.mockRestore(); storage.blockDeletedProjectArchitectureWrites('synthetic-project');
  await source.flushAnalysisSourceWrites();
  expect(await source.readAnalysisSourceRecord('copilot_baseline', key)).toBeUndefined();
});

test('completed memory-only publication becomes a durable recovery snapshot before update', async () => {
  const scope = 'cba:synthetic-project:synthetic-repo';
  const failed = jest.spyOn(chunks, 'putRawRecord').mockRejectedValueOnce(new DOMException('Synthetic full disk', 'QuotaExceededError'));
  await expect(storage.prepareArchitecturePublication(scope, progress.rows, { fingerprint: 'a'.repeat(64), scope }, { selectedFiles: 2 }, key, [])).rejects.toThrow();
  expect(await storage.readArchitectureCheckpoint(key)).toMatchObject({ durable: false });
  failed.mockRestore();
  await storage.saveArchitectureBeforeUpdate();
  expect(await storage.readLatestArchitectureCheckpoint(scope)).toMatchObject({ durable: true, publicationReady: true, rowCount: 1 });
});

test('failed architecture table edits are automatically saved before updating', async () => {
  const scope = 'cba:synthetic-project:synthetic-repo';
  const failed = jest.spyOn(chunks, 'writeRecord').mockRejectedValueOnce(new DOMException('Synthetic full disk', 'QuotaExceededError'));
  expect(await storage.writeCbaRowsToIndexedDB(scope, progress.rows)).toBe(false);
  failed.mockRestore();
  await storage.saveArchitectureBeforeUpdate();
  expect(await storage.readCbaRowsFromIndexedDB(scope)).toEqual(progress.rows);
});
