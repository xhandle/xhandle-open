// Production storage adapter with IndexedDB transactions supplied by fake-indexeddb.
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { loadArtifactRowsAsync, saveArtifactRowsAsync, storageKeyFor } from './artifactUtils';
const kind = 'software-requirements';
const fresh = [{ id: 'SWR-001', requirementText: 'The software shall retain the command.' }];
const key = storageKeyFor(kind, 'audit', 'repo');
const load = () => loadArtifactRowsAsync(kind, 'audit', 'repo');
const save = rows => saveArtifactRowsAsync(kind, 'audit', 'repo', rows);
const originalIndexedDB = global.indexedDB;
const originalClone = global.structuredClone;
beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
  localStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); global.indexedDB = originalIndexedDB; global.structuredClone = originalClone; });
async function editRecords(edit) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('xhandle-code-architecture-assurance', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('artifactRows', 'readwrite');
      edit(tx.objectStore('artifactRows'));
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function failWrites() {
  const original = IDBDatabase.prototype.transaction;
  return jest.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (store, mode, ...rest) {
    if (mode === 'readwrite') throw new Error('Injected write failure');
    return original.call(this, store, mode, ...rest);
  });
}
test('new fallback supersedes old empty database data, including after module reload', async () => {
  await save([]);
  const failure = failWrites();
  await save(fresh);
  expect(await load()).toEqual(fresh);
  jest.resetModules();
  const reloaded = require('./artifactUtils');
  expect(await reloaded.loadArtifactRowsAsync(kind, 'audit', 'repo')).toEqual(fresh);
  failure.mockRestore();
});
test('repeated fallback writes, explicit clearing and database recovery preserve newest revision', async () => {
  await save(fresh);
  const failure = failWrites();
  await save([{ ...fresh[0], requirementText: 'Changed' }]);
  await save([]);
  expect(await load()).toEqual([]);
  failure.mockRestore();
  await save(fresh);
  expect(await load()).toEqual(fresh);
});
test('missing chunk rejects instead of silently returning empty rows', async () => {
  await save(fresh); localStorage.removeItem(key);
  await editRecords(store => store.delete(`${key}:chunk:0`));
  await expect(load()).rejects.toThrow(/incomplete or damaged/);
});
test('row count mismatch rejects and a matching complete fallback recovers a missing chunk', async () => {
  await save(fresh);
  await editRecords(store => store.delete(`${key}:chunk:0`));
  expect(await load()).toEqual(fresh);
  localStorage.removeItem(key);
  await editRecords(store => store.put({key:`${key}:chunk:0`, parentKey:key, rows:[]}));
  await expect(load()).rejects.toThrow(/incomplete or damaged/);
});
test('serialized writes and save notifications observe the last complete result', async () => {
  const notifications = [];
  const listener = () => notifications.push(load());
  window.addEventListener('xhandle:code-architecture-assurance:changed', listener);
  try {
    await Promise.all([save(fresh), save([]), save(fresh)]);
    expect(await load()).toEqual(fresh);
    expect((await Promise.all(notifications)).every(rows => rows.length === 1)).toBe(true);
  } finally { window.removeEventListener('xhandle:code-architecture-assurance:changed', listener); }
});
test('multi-chunk results reload without a local cache', async () => {
  const large = Array.from({length:4}, (_,index) => ({id:`SWR-${index}`,requirementText:'x'.repeat(250000)}));
  await save(large);
  expect(localStorage.getItem(key)).toBeNull();
  expect(await load()).toEqual(large);
});
test('legacy array records remain readable', async () => {
  await save([]);
  await editRecords(store => store.put({key, rows:fresh}));
  localStorage.removeItem(key);
  expect(await load()).toEqual(fresh);
});
test('failed clear rejects if neither backend can commit and retains prior data', async () => {
  await save(fresh);
  failWrites();
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
  await expect(save([])).rejects.toThrow(/could not be saved/);
  expect(JSON.parse(localStorage.getItem(key)).rows).toEqual(fresh);
  expect(await load()).toEqual([]);
});
