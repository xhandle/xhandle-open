// Regression coverage for preexisting incomplete assurance schemas.
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { loadArtifactRowsAsync, saveArtifactRowsAsync, ensureArtifactStorageReady } from './artifactUtils';
const name = 'xhandle-code-architecture-assurance';
const kind = 'software-requirements';
const originalDb = global.indexedDB, originalClone = global.structuredClone;
beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
  localStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {global.indexedDB=originalDb;global.structuredClone=originalClone;jest.restoreAllMocks();});
async function genericOpen() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(name);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
test('preexisting version 1 without stores is repaired on feature load',async()=>{
  const db=await genericOpen();
  expect(db.version).toBe(1);expect(db.objectStoreNames.length).toBe(0);db.close();
  expect(await loadArtifactRowsAsync(kind,'missing-schema','repo')).toEqual([]);
  const reopened=await genericOpen();expect(reopened.objectStoreNames.contains('artifactRows')).toBe(true);reopened.close();
});
test('small saves repair the missing schema',async()=>{
  const db=await genericOpen();db.close();
  const rows=[{id:'SWR-001',requirementText:'The software shall validate commands.'}];
  await saveArtifactRowsAsync(kind,'small-schema','repo',rows);
  expect(await loadArtifactRowsAsync(kind,'small-schema','repo')).toEqual(rows);
  const reopened=await genericOpen();expect(reopened.objectStoreNames.contains('artifactRows')).toBe(true);reopened.close();
});
test('large generated results persist and reload after repairing the missing store',async()=>{
  const db=await genericOpen();db.close();
  const rows=Array.from({length:463},(_,index)=>({id:`SWR-${index}`,requirementText:'x'.repeat(2000)}));
  await saveArtifactRowsAsync(kind,'large-schema','repo',rows);
  expect(await loadArtifactRowsAsync(kind,'large-schema','repo')).toEqual(rows);
});

test('repair retains unrelated stores and data with concurrent callers',async()=>{
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,4);
  request.onupgradeneeded=()=>request.result.createObjectStore('keep').put('retained','key');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });db.close();
 await Promise.all([ensureArtifactStorageReady(),ensureArtifactStorageReady(),ensureArtifactStorageReady()]);
 const reopened=await genericOpen();
 expect(reopened.version).toBe(5);
 const value=await new Promise(resolve=>{const req=reopened.transaction('keep').objectStore('keep').get('key');req.onsuccess=()=>resolve(req.result);});
 expect(value).toBe('retained');reopened.close();
});
test('blocked repair reports an actionable error and can be retried after the other tab closes',async()=>{
 const blocking=await genericOpen();
 await expect(ensureArtifactStorageReady()).rejects.toThrow(/blocked/);
 blocking.close();
 await ensureArtifactStorageReady();
});
