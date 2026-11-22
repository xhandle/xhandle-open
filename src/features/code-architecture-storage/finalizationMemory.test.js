import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { openCbaIndexedDB, prepareArchitecturePublication, recoverArchitecturePublication, readLatestArchitectureCheckpoint, readCbaRowsFromIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { stageRecord, putRawRecord, rawRecord, hydrateRecord, iterateRecordArray, inspectRecord } from './chunkedRecord';
import { enrichCodeEvidenceRows } from '../code-architecture-context/codeEvidenceEnrichment';
import { createByteCache, mapFinalizationBatches } from '../code-architecture-context/finalizationBatches';
import { collectFunctionalSourceFunctions } from '../code-architecture-context/functionalModel';

const store = 'copilot_baseline', scope = 'cba:memory:test', checkpoint = `functional-decomposition-checkpoint:${scope}:run`;
const original = {indexedDB:global.indexedDB, IDBKeyRange:global.IDBKeyRange, structuredClone:global.structuredClone, crypto:global.crypto, TextEncoder:global.TextEncoder};
beforeEach(() => { global.indexedDB = new IDBFactory(); global.IDBKeyRange = IDBKeyRange; global.structuredClone = v => deserialize(serialize(v)); global.crypto = webcrypto; global.TextEncoder = TextEncoder; localStorage.clear(); });
afterEach(() => Object.assign(global, original));
jest.setTimeout(30000);

const fixture = (count = 130) => {
  const fn = {functionName:'validate', filePath:'a.py', startLine:1, endLine:2, content:'Distinct immutable source. '.repeat(250)};
  const file = {filePath:'a.py', sourceFunctions:[fn]};
  return Array.from({length:count}, (_,i) => ({traceId:`t${i}`, from:'validate', to:'apply', codeEvidence:{files:[file], sourceFunctions:[fn]}, sourceEvidence:{functions:[fn]}}));
};

test('bounded decoder preserves independent default values and explicitly shared frozen evidence', async () => {
  const db = await openCbaIndexedDB();
  try {
    const rows = fixture(), record = await stageRecord(db, store, scope, rows), metrics = [];
    const normal = await hydrateRecord(db, store, record, {cacheBytes:20000, onMetrics:sample => metrics.push(sample)});
    expect(normal).toEqual(rows);
    normal[0].codeEvidence.files[0].sourceFunctions[0].content = 'edit';
    expect(normal[1].codeEvidence.files[0].sourceFunctions[0].content).toBe(rows[1].codeEvidence.files[0].sourceFunctions[0].content);
    expect(Math.max(...metrics.map(sample => sample.peakCacheBytes))).toBeLessThanOrEqual(20000);
    const shared = await hydrateRecord(db, store, record, {immutableEvidence:true});
    expect(shared).toEqual(rows);
    expect(shared[0].codeEvidence.files[0]).toBe(shared[1].codeEvidence.files[0]);
    expect(Object.isFrozen(shared[0].codeEvidence.files[0].sourceFunctions[0])).toBe(true);
    shared[0].from = 'edited row'; expect(shared[1].from).toBe('validate');
    const batches = [];
    for await (const batch of iterateRecordArray(db, store, record, {batchRows:3, batchBytes:30000, offset:62, limit:9})) batches.push(batch);
    expect(batches.flat()).toEqual(rows.slice(62,71));
    expect(batches.every(batch => batch.length <= 3)).toBe(true);
  } finally { db.close(); }
});

test('summary publication validates chunks without hydrating their repeated evidence; reload and preview retain every row', async () => {
  const rows = fixture(140), run = {fingerprint:'memory-run', scope};
  await prepareArchitecturePublication(scope, rows, run, {selectedFiles:6000}, checkpoint, []);
  const preview = await readLatestArchitectureCheckpoint(scope);
  expect(preview).toMatchObject({publicationReady:true, rowCount:140, total:6000});
  expect(preview.rows).toHaveLength(50);
  const saved = await recoverArchitecturePublication(scope, checkpoint, undefined, {summaryOnly:true});
  expect(saved).toMatchObject({rowCount:140, metadata:{storageSaved:true}});
  expect(saved).not.toHaveProperty('rows');
  expect(await readCbaRowsFromIndexedDB(scope)).toEqual(rows);
  expect(await readLatestArchitectureCheckpoint(scope)).toBeNull();
});

test('immutable readers share repeated arrays of short inline function evidence', async () => {
  const db=await openCbaIndexedDB();
  try {
    const functions=Array.from({length:25},(_,i)=>({functionName:`op${i}`,filePath:'source.cpp',content:`body ${i} `+'state validation '.repeat(70)}));
    const rows=Array.from({length:100},(_,i)=>({traceId:`short-${i}`,codeEvidence:{sourceFunctions:functions},sourceEvidence:{functions}}));
    const record=await stageRecord(db,store,scope,rows);
    const shared=await hydrateRecord(db,store,record,{immutableEvidence:true});
    expect(shared).toEqual(rows);
    expect(shared[0].codeEvidence.sourceFunctions).toBe(shared[99].sourceEvidence.functions);
    expect(Object.isFrozen(shared[0].sourceEvidence.functions[0])).toBe(true);
    const ordinary=await hydrateRecord(db,store,record);
    ordinary[0].sourceEvidence.functions[0].content='edited';
    expect(ordinary[1].sourceEvidence.functions[0].content).toBe(functions[0].content);
  } finally {db.close();}
});

test.each(['missing','corrupt','wrong-count','wrong-run','cancelled'])('%s publication preserves the previous result and ready checkpoint', async fault => {
  const db = await openCbaIndexedDB();
  try {
    await putRawRecord(db, store, scope, [{traceId:'previous', manual:'keep'}]);
    const ready = await prepareArchitecturePublication(scope, fixture(2), {fingerprint:'run',scope}, {}, checkpoint, [{traceId:'previous',manual:'keep'}]);
    const controller = new AbortController();
    if (fault === 'missing') { const tx = db.transaction(store,'readwrite'); tx.objectStore(store).delete(ready.rowRecord.root); await new Promise((resolve,reject) => {tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);}); }
    if (fault === 'corrupt') await putRawRecord(db, store, ready.rowRecord.root, JSON.stringify(['array',[]]));
    if (fault === 'wrong-count') await putRawRecord(db, store, checkpoint, {...ready, rowCount:50});
    if (fault === 'wrong-run') await putRawRecord(db, store, checkpoint, {...ready, fingerprint:'different'});
    if (fault === 'cancelled') controller.abort();
    await expect(recoverArchitecturePublication(scope, checkpoint, controller.signal, {summaryOnly:true})).rejects.toBeDefined();
    expect(await readCbaRowsFromIndexedDB(scope)).toEqual([{traceId:'previous',manual:'keep'}]);
    expect(await rawRecord(db, store, checkpoint)).toBeDefined();
  } finally { db.close(); }
});

test('incremental validator rejects cross-scope, cyclic and malformed graphs', async () => {
  const db = await openCbaIndexedDB();
  try {
    const record = await stageRecord(db,store,scope,fixture(2));
    await expect(inspectRecord(db,store,record,{prefix:'another'})).rejects.toThrow(/another/);
    const root = `${scope}:$part:cycle`;
    await putRawRecord(db,store,root,JSON.stringify(['pages',[root]]));
    await expect(inspectRecord(db,store,{...record,root})).rejects.toThrow(/Cyclic/);
    await putRawRecord(db,store,root,JSON.stringify(['array',[null]]));
    await expect(inspectRecord(db,store,{...record,root})).rejects.toThrow(/Invalid/);
  } finally {db.close();}
});

test('enrichment shares exact immutable catalogs and snippets across cache eviction, with independent row fields', async () => {
  const rows = Array.from({length:300}, (_,i) => ({from:`f${i%5}`, fromFile:`${i%5}.py`, to:'apply', toFile:''}));
  const readFile = jest.fn(async path => ({content:'def apply():\n  return 1', sourceFunctions:[{filePath:path,functionName:'apply',startLine:1,endLine:2}]}));
  const onBatch = jest.fn();
  const result = await enrichCodeEvidenceRows({rows,readFile,splitFiles:path=>path?[path]:[],selectFunctions:f=>f,snippet:lines=>lines.join('\n'),onBatch,cacheOptions:{maxEntries:1,maxBytes:1024}});
  expect(result).toHaveLength(300);
  expect(readFile.mock.calls.length).toBeLessThanOrEqual(10);
  expect(result[0].codeEvidence.files[0]).toBe(result[5].codeEvidence.files[0]);
  expect(result[0].sourceEvidence.functions[0]).toBe(result[5].sourceEvidence.functions[0]);
  expect(result[299].sourceEvidence.functions[0].content).toBe('def apply():\n  return 1');
  expect(() => {result[0].sourceEvidence.functions[0].content='mutated';}).toThrow();
  expect(onBatch).toHaveBeenLastCalledWith({completed:300,total:300});
});

test('batch backpressure, cancellation and byte cache ceilings are enforced', async () => {
  const cache = createByteCache({maxBytes:100,maxEntries:2});
  cache.set('a',1,60); cache.set('b',2,60); expect(cache.get('a')).toBeUndefined();
  cache.set('huge',3,101); expect(cache.bytes).toBe(60);
  const controller = new AbortController(), batches = [];
  await expect(mapFinalizationBatches([1,2,3,4],async row=>row,{signal:controller.signal,maxRows:2,onBatch:async batch=>{batches.push(batch);controller.abort();}})).rejects.toMatchObject({name:'AbortError'});
  expect(batches).toEqual([{completed:2,total:4}]);
});

test('functional evidence collection retains distinct citations while eliminating repeated catalogs', () => {
  const first={filePath:'a.py',functionName:'apply',startLine:1,content:'source one'};
  const second={...first,startLine:20,content:'source two'};
  const file={filePath:'a.py',sourceFunctions:[first,second]};
  const row={from:'read',fromFile:'a.py',to:'apply',toFile:'a.py',codeEvidence:{files:[file],sourceFunctions:[first]},sourceEvidence:{functions:[first]}};
  const evidence=collectFunctionalSourceFunctions(Array.from({length:400},()=>row));
  expect(evidence).toEqual([{filePath:'a.py',functionName:'read'},{filePath:'a.py',functionName:'apply'},first,second]);
  expect(row.codeEvidence.files[0].sourceFunctions).toEqual([first,second]);
});
