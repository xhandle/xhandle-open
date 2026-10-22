import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { encodeWorkspace, decodeWorkspace, workspaceDigest } from './workspaceTransferCodec';
import { createWorkspaceTransfer, inspectWorkspaceTransfer, importWorkspaceTransfer, getWorkspaceRecovery, recoverPreviousWorkspace } from './fullWorkspaceTransfer';
import { readTransferDatabases, preflightTransferDatabases } from './workspaceTransferStorage';
jest.mock('./localBackupService', () => ({ pauseBackupsForWorkspaceTransfer: jest.fn(() => jest.fn()) }));
jest.mock('./api/backendConfig', () => ({ backendURL: 'http://local.test', ACCOUNT_ID: 'xhandle-local' }));
// fake-indexeddb needs a clone implementation in JSDOM. Keep Blob/File values
// immutable and clone the remaining structured fixture types in this realm.
function clone(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Blob) return value.slice(0, value.size, value.type);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  const result = value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : {};
  seen.set(value, result);
  if (value instanceof Map) for (const [k,v] of value) result.set(clone(k,seen),clone(v,seen));
  else if (value instanceof Set) for (const v of value) result.add(clone(v,seen));
  else for (const key of Object.keys(value)) Object.defineProperty(result,key,{value:clone(value[key],seen),enumerable:true,writable:true,configurable:true});
  return result;
}
let backend, apiFailure;
const emptyBackend = () => ({ version: 1, includeCredentials: true, baselines: [], repo: null, providerKeys: [], openai: null });
beforeEach(() => {
  global.indexedDB = new IDBFactory(); global.structuredClone = value => clone(value);
  global.crypto = webcrypto;
  global.TextEncoder = TextEncoder;
  localStorage.clear(); sessionStorage.clear(); backend = emptyBackend(); apiFailure = null;
  global.fetch = jest.fn(async (url, options) => {
    const action = url.split('/').at(-1), data = JSON.parse(options.body);
    if (apiFailure?.(action)) throw new Error('Disconnected');
    if (action === 'export') {
      const result = clone(backend); result.includeCredentials = data.includeCredentials;
      if (!data.includeCredentials) { delete result.providerKeys; delete result.openai; if (result.repo) delete result.repo.token; }
      return { ok: true, json: async () => result };
    }
    if (action === 'import') { const oldKeys = backend.providerKeys, oldOpenai = backend.openai, oldToken = backend.repo?.token; backend = clone(data); if (!data.includeCredentials) { backend.providerKeys = oldKeys; backend.openai = oldOpenai; if (backend.repo) backend.repo.token = oldToken; } }
    return { ok: true, json: async () => ({ ok: true }) };
  });
});
async function seed(name, store, records, options = {}) {
  const db = await openDB(name, options.version || 1, { upgrade(db) { const target = db.createObjectStore(store, { keyPath: options.keyPath ?? null }); if (options.index) target.createIndex('by_name','name'); } });
  const tx = db.transaction(store,'readwrite');
  for (const { key, value } of records) await (options.keyPath ? tx.store.put(value) : tx.store.put(value,key));
  await tx.done; db.close();
}
const file = envelope => ({ text: async () => JSON.stringify(envelope) });

test('structured values, binary evidence, cyclic references and typed keys survive portable JSON', async () => {
  const binary = new Uint8Array([1,2,255]); const cyclic = { name: 'test' }; cyclic.self = cyclic;
  const original = { date: new Date('2024-01-02'), binary, view: new DataView(binary.buffer), map: new Map([[new Date(1),new Set([1n,undefined,NaN])]]), evidence: new File(['evidence'], 'proof.txt', {type:'text/plain',lastModified:5}), cyclic };
  const restored = decodeWorkspace(JSON.parse(JSON.stringify(await encodeWorkspace(original))));
  expect(restored.date.getTime()).toBe(original.date.getTime()); expect([...restored.binary]).toEqual([1,2,255]);
  expect(restored.binary.buffer).toBe(restored.view.buffer); expect(restored.cyclic.self).toBe(restored.cyclic);
  expect([...restored.map.values()][0].has(1n)).toBe(true); expect(restored.evidence.name).toBe('proof.txt');
  expect(await new Promise(resolve => { const r = new FileReader(); r.onload=()=>resolve(r.result); r.readAsText(restored.evidence); })).toBe('evidence');
});

test('full export restores fresh browser/desktop storage including stores omitted by v1', async () => {
  localStorage.setItem('xhandle.projects', JSON.stringify([{id:'p',name:'Project'}]));
  localStorage.setItem('githubToken','source-secret'); localStorage.setItem('xhandle.backup.settings.v1','source-folder');
  sessionStorage.setItem('xhandle:requirements','draft');
  backend.baselines = [{id:7,name:'baseline',created_at:'now',decomposition_data:'[{"id":1}]'}];
  backend.repo = {owner:'source',repo:'repo',token:'server-secret'};
  await seed('xhandle-code-architecture-hazard-analysis','hazardAnalysisRuns',[{key:'p',value:{rows:[['hazard']],date:new Date(1)}}],{version:3});
  await seed('SafetyCaseEvidenceDB','Attachments',[{key:new Uint8Array([9]).buffer,value:{file:new Blob(['evidence']),bytes:new Uint8Array([3,4])}}]);
  await seed('xhandle-results-review','items',[{key:'r',value:{decision:'accepted'}}]);
  await seed('unrelated-app','items',[{key:'keep',value:'unrelated'}]);
  await seed('xhandle_local_source_handles','handles',[{key:'folder',value:{permission:'not portable'}}]);
  const exported = await createWorkspaceTransfer();
  const preview = await inspectWorkspaceTransfer(file(exported));
  expect(preview.summary).toMatchObject({projects:1,records:3,baselines:1});
  expect(preview.data.indexedDB['unrelated-app']).toBeUndefined(); expect(preview.data.indexedDB.xhandle_local_source_handles).toBeUndefined();
  expect(JSON.stringify(exported)).not.toContain('source-secret'); expect(preview.data.backend.repo.token).toBeUndefined();
  global.indexedDB = new IDBFactory(); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('githubToken','destination-secret'); localStorage.setItem('xhandle.backup.settings.v1','destination-folder');
  backend=emptyBackend();
  await importWorkspaceTransfer(exported);
  expect(localStorage.getItem('githubToken')).toBe('destination-secret'); expect(localStorage.getItem('xhandle.backup.settings.v1')).toBe('destination-folder');
  expect(JSON.parse(localStorage.getItem('xhandle.projects'))[0].id).toBe('p'); expect(sessionStorage.getItem('xhandle:requirements')).toBe('draft');
  const records = await readTransferDatabases();
  expect(records['xhandle-results-review'].stores.items.records[0].value.decision).toBe('accepted');
  const attachment = records.SafetyCaseEvidenceDB.stores.Attachments.records[0];
  expect([...new Uint8Array(attachment.key)]).toEqual([9]); expect(attachment.value.file.size).toBe(8);
  expect([...attachment.value.bytes]).toEqual([3,4]); expect(backend.baselines[0].id).toBe(7); expect(await getWorkspaceRecovery()).toBeNull();
});

test('credentials require export inclusion and explicit restore; omitted keys preserve destination', async () => {
  localStorage.setItem('githubToken','source'); backend.providerKeys=[{provider:'openai',api_key:'key',is_active:1,created_at:'now',updated_at:'now'}];
  const exported = await createWorkspaceTransfer({includeCredentials:true});
  localStorage.setItem('githubToken','destination'); backend.providerKeys=[];
  await importWorkspaceTransfer(exported);
  expect(localStorage.getItem('githubToken')).toBe('destination'); expect(backend.providerKeys).toEqual([]);
  await importWorkspaceTransfer(exported,{restoreCredentials:true});
  expect(localStorage.getItem('githubToken')).toBe('source'); expect(backend.providerKeys[0].api_key).toBe('key');
});

test('corrupt, future or malformed files cannot mutate destination data', async () => {
  const exported=await createWorkspaceTransfer(); localStorage.setItem('keep','safe');
  const bad=clone(exported); bad.manifest.version=99;
  await expect(importWorkspaceTransfer(bad)).rejects.toThrow('Unsupported');
  const corrupt=clone(exported); corrupt.sha256='wrong'; await expect(importWorkspaceTransfer(corrupt)).rejects.toThrow('integrity');
  await expect(inspectWorkspaceTransfer({text:async()=>'{bad'})).rejects.toThrow('readable');
  expect(localStorage.getItem('keep')).toBe('safe'); expect(await getWorkspaceRecovery()).toBeNull();
});

test('empty source replaces stale destination records; incompatible schema is rejected before writes', async () => {
  const exported=await createWorkspaceTransfer();
  await seed('xhandle-results-review','items',[{key:'old',value:'stale'}]);
  await importWorkspaceTransfer(exported);
  expect((await readTransferDatabases())['xhandle-results-review'].stores.items.records).toEqual([]);
  const data={'xhandle-results-review':{version:1,stores:{items:{keyPath:'id',autoIncrement:false,indexes:[],records:[]}}}};
  await expect(preflightTransferDatabases(data)).rejects.toThrow('schema');
});

test('failed multi-store import rolls back data and keeps recoverable checkpoint if backend remains offline', async () => {
  localStorage.setItem('xhandle.projects','[{"id":"incoming"}]');
  await seed('xhandle-results-review','items',[{key:'incoming',value:'new'}]);
  const exported=await createWorkspaceTransfer();
  localStorage.setItem('xhandle.projects','[{"id":"existing"}]');
  const db=await openDB('xhandle-results-review'); await db.clear('items'); await db.put('items','old','existing'); db.close();
  let failures=0; apiFailure=action=>action==='import' && ++failures===1;
  await expect(importWorkspaceTransfer(exported)).rejects.toThrow('previous workspace was restored');
  expect(localStorage.getItem('xhandle.projects')).toContain('existing');
  expect((await readTransferDatabases())['xhandle-results-review'].stores.items.records[0].key).toBe('existing');
  apiFailure=action=>action==='import';
  await expect(importWorkspaceTransfer(exported)).rejects.toThrow('recovery is pending');
  expect(await getWorkspaceRecovery()).not.toBeNull();
  await expect(createWorkspaceTransfer()).rejects.toThrow('Recover');
  apiFailure=null; await recoverPreviousWorkspace();
  expect(await getWorkspaceRecovery()).toBeNull(); expect(localStorage.getItem('xhandle.projects')).toContain('existing');
});

test('server unavailability prevents a misleading incomplete full export', async () => {
  apiFailure=()=>true; await expect(createWorkspaceTransfer()).rejects.toThrow('Disconnected');
});

test('export reports ordered stage percentages while reading databases and preparing the file',async()=>{
  await seed('xhandle-results-review','items',[{key:'record',value:'data'}]);
  const updates=[];
  await createWorkspaceTransfer({onProgress:(message,percent)=>updates.push({message,percent})});
  const percentages=updates.map(update=>update.percent);
  expect(percentages[0]).toBe(5);
  expect(percentages[percentages.length-1]).toBe(95);
  expect(percentages).toEqual([...percentages].sort((a,b)=>a-b));
  expect(updates.some(update=>update.message==='Creating integrity checksum…' && update.percent===85)).toBe(true);
});
