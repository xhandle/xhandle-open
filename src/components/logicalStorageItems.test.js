import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { IDBFactory } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { buildArchitectureLogicalItems, deleteLogicalStorageItem, inventoryLogicalStorage, logicalKeys, logicalTransaction, openLogicalStorage } from './logicalStorageItems';
import { readFirstCbaRowsFromIndexedDB, beginArchitectureStorageWork, writeCbaRowsToIndexedDB } from '../features/code-architecture-assurance/codeArchitectureStorage';
Object.defineProperty(global, 'crypto', {value:webcrypto, configurable:true});
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.Blob = Blob;
global.structuredClone = value => deserialize(serialize(value));
const scope = 'cba:0:r';
const projects = [{id:0, workspaceType:'code-architecture', sourceData:{id:0,repos:[{id:'r',name:'Repository'}]}}];
const opts = extra => ({getProjects:async()=>projects, ...extra});
const fingerprint='f'.repeat(64);
const completeMetadata={storageSaved:true,coverage:{acquisition:'complete',selected:1,analyzed:1,failed:0,skippedByLimits:0},sourceAnalysis:{scope,status:'selected-files-analyzed',fingerprint,manifestKey:`${scope}:run:${fingerprint}`}};
const root = `${scope}:$part:root`, shared = `${scope}:$part:shared`;
async function seed(records) {
  const db = await new Promise((resolve,reject)=>{
    const r=indexedDB.open('xhandle',4);
    r.onupgradeneeded=()=>{for(const n of ['copilot_baseline','code_index','diagram_positions'])r.result.createObjectStore(n,{keyPath:'key'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  try { await logicalTransaction(db,'copilot_baseline','readwrite',tx=>records.forEach(([key,value])=>tx.objectStore('copilot_baseline').put({key,value}))); } finally { db.close(); }
}
async function keys() { const db=await openLogicalStorage('xhandle');try{return await logicalKeys(db,'copilot_baseline');}finally{db.close();} }
const item = type => ({scope,projectId:0,repoId:'r',workspaceType:'code-architecture',type});
beforeEach(async()=>{
  localStorage.clear();
  for(const name of ['xhandle','xhandle-workspace-graph','xhandle-recovery','xhandle-code-architecture-assurance','xhandle-code-architecture-hazard-analysis','xhandle-project-reports'])await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
});
test('thousands of parts and request records produce three recognizable logical items without value reads',()=>{
  const list=[scope,`${scope}:history:old`,...Array.from({length:1112},(_,i)=>`${scope}:functional-work:${i}`),...Array.from({length:1000},(_,i)=>`${scope}:$part:${i}`)];
  expect(buildArchitectureLogicalItems(list,projects).items.map(x=>x.type)).toEqual(['architecture','history','temporary']);
});
test('whole saved deletion removes roots and exclusive parts, keeps shared parts and unrelated roots; reload remains empty without removing connection',async()=>{
  await seed([[scope,{format:'xhandle-json-tree-v1',root}], [root,JSON.stringify(['array',[{ref:shared},{value:'saved'}]])], [shared,JSON.stringify(['value','shared'])],
    ['cba:other:r',{format:'xhandle-json-tree-v1',root:shared}], [`${scope}:run`,{}], [`${scope}:history:old`,[]], [`${scope}:metadata`,{}]]);
  const reconcile=jest.fn();await deleteLogicalStorageItem(item('architecture'),opts({reconcile}));
  expect(await keys()).toEqual(expect.arrayContaining([shared,'cba:other:r',`${scope}:storage-deleted`]));
  expect(await keys()).not.toContain(root);expect(await keys()).not.toContain(scope);
  expect((await inventoryLogicalStorage(projects)).items).toHaveLength(0);
  expect(await readFirstCbaRowsFromIndexedDB([scope,'cba:other:r'])).toMatchObject({rows:[],found:true});
  expect(projects[0].sourceData.repos).toHaveLength(1);expect(reconcile).toHaveBeenCalledTimes(1);
});
test('completed cache cleanup preserves saved output, history, provenance and credentials',async()=>{
  await seed([[scope,[]],[`${scope}:metadata`,completeMetadata],
    [`${scope}:run:${fingerprint}`,{}],[`${scope}:run`,{}],[`${scope}:functional-work:1`,{response:'cached'}],[`${scope}:history:old`,[]]]);
  localStorage.setItem('githubToken','secret');
  await deleteLogicalStorageItem(item('temporary'),opts());
  expect(await keys()).not.toContain(`${scope}:functional-work:1`);
  expect(await keys()).toEqual(expect.arrayContaining([scope,`${scope}:history:old`,`${scope}:run:${fingerprint}`]));
  expect(localStorage.getItem('githubToken')).toBe('secret');
});
test.each(['extraction','ready-to-publish'])('protects %s work and request caches',async phase=>{
  await seed([[scope,[]],[`functional-decomposition-checkpoint:${scope}:f`,{phase}],[`${scope}:functional-work:1`,{}]]);
  const before=await keys();await expect(deleteLogicalStorageItem(item('temporary'),opts())).rejects.toThrow(/Interrupted|unpublished/);expect(await keys()).toEqual(before);
});
test('refuses unverifiable publication and stays discoverable for retry',async()=>{
  await seed([[scope,[]],[`${scope}:functional-work:1`,{}]]);
  await expect(deleteLogicalStorageItem(item('temporary'),opts())).rejects.toThrow(/publication/);
  expect((await inventoryLogicalStorage(projects)).items.some(x=>x.type==='temporary')).toBe(true);
});
test('active analysis and owning state guard reject before mutation',async()=>{
  await seed([[scope,[]]]);const release=beginArchitectureStorageWork(scope);
  await expect(deleteLogicalStorageItem(item('architecture'),opts())).rejects.toThrow(/progress/);release();
  await expect(deleteLogicalStorageItem(item('architecture'),opts({isBusy:()=>true}))).rejects.toThrow(/running/);
  expect(await keys()).toContain(scope);
});
test('cross-workspace aliases and overlapping namespaces fail closed, unassigned roots remain visible',async()=>{
  await seed([[scope,[]],['cba:orphan:r',[]]]);
  const collision=[...projects,{id:'0',workspaceType:'functional'}];
  expect(buildArchitectureLogicalItems(await keys(),collision).unassigned).toBe(true);
  await expect(deleteLogicalStorageItem(item('architecture'),{getProjects:async()=>collision})).rejects.toThrow(/ownership/);
  const overlapping=[...projects,{id:'0:r',workspaceType:'code-architecture',repos:[{id:'other'}]}];
  await expect(deleteLogicalStorageItem(item('architecture'),{getProjects:async()=>overlapping})).rejects.toThrow(/ownership/);
});
test('history deletion preserves current result and shared chunks',async()=>{
  await seed([[scope,{format:'xhandle-json-tree-v1',root:shared}],[`${scope}:history:old`,{format:'xhandle-json-tree-v1',root:shared}],[shared,JSON.stringify(['value',[]])]]);
  await deleteLogicalStorageItem(item('history'),opts());expect(await keys()).toContain(shared);expect(await keys()).toContain(scope);expect(await keys()).not.toContain(`${scope}:history:old`);
});
test('new intentional save clears deletion marker',async()=>{
  await seed([[scope,[]]]);await deleteLogicalStorageItem(item('architecture'),opts());
  await writeCbaRowsToIndexedDB(scope,[{from:'new'}]);
  expect(await keys()).not.toContain(`${scope}:storage-deleted`);
  expect((await readFirstCbaRowsFromIndexedDB([scope])).rows).toEqual([{from:'new'}]);
});

test('failed state reconciliation leaves a discoverable retry item; retry finishes safely',async()=>{
  await seed([[scope,[]],[`${scope}:run`,{}]]);
  await expect(deleteLogicalStorageItem(item('architecture'),opts({reconcile:()=>{throw new Error('state failure');}}))).rejects.toThrow('state failure');
  expect((await inventoryLogicalStorage(projects)).items.some(item=>item.type==='architecture')).toBe(true);
  await deleteLogicalStorageItem(item('architecture'),opts());
  expect((await inventoryLogicalStorage(projects)).items).toHaveLength(0);
});
test('generic recovery roots make uncertain chunk reclamation conservative',async()=>{
  await seed([[scope,{format:'xhandle-json-tree-v1',root}],[root,JSON.stringify(['value','saved'])]]);
  const recovery=await new Promise(resolve=>{const r=indexedDB.open('xhandle-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('checkpoints');r.onsuccess=()=>resolve(r.result);});
  await logicalTransaction(recovery,'checkpoints','readwrite',tx=>tx.objectStore('checkpoints').put({rowRecord:{format:'xhandle-json-tree-v1',root}},'unknown-recovery'));
  recovery.close();
  await deleteLogicalStorageItem(item('architecture'),opts());
  expect(await keys()).toContain(root);expect(await keys()).not.toContain(scope);
});
test('requirements inventory and deletion use complete collections, including pages and local fallback',async()=>{
  const {storageKeyFor,saveArtifactRowsAsync,loadArtifactRowsAsync}=require('../features/code-architecture-assurance/artifactUtils');
  const key=storageKeyFor('software-requirements',0,'r');
  await seed([]);
  await saveArtifactRowsAsync('software-requirements',0,'r',[{id:'SWR-1',requirementText:'Keep me visible as a collection'}]);
  const inventory=await inventoryLogicalStorage(projects), collection=inventory.items.find(item=>item.type==='artifact');
  expect(collection.key).toBe(key);
  await deleteLogicalStorageItem(collection,opts());
  expect(localStorage.getItem(key)).toBeNull();
  const db=await openLogicalStorage('xhandle-code-architecture-assurance');
  expect(await logicalKeys(db,'artifactRows')).toEqual([]);db.close();
  expect(await loadArtifactRowsAsync('software-requirements',0,'r')).toEqual([]);
});

async function seedHazards(checkpoint=false) {
  const db=await new Promise(resolve=>{const r=indexedDB.open('xhandle-code-architecture-hazard-analysis',5);r.onupgradeneeded=()=>{for(const name of ['hazardAnalysisRuns','runMetadata','generationCheckpoints','hazardRunChunks','hazardRunStaging'])r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);});
  await logicalTransaction(db,['runMetadata','hazardAnalysisRuns','generationCheckpoints','hazardRunChunks'],'readwrite',tx=>{
    for(const row of [{id:'hazard-owned',projectId:0,repoId:'r'},{id:'hazard-other',projectId:'other',repoId:'r'}]){
      tx.objectStore('runMetadata').put(row);tx.objectStore('hazardAnalysisRuns').put(row);
    }
    tx.objectStore('hazardRunChunks').put({id:'shared-generation:0',runId:'hazard-owned',tokens:['shared']});
    if(checkpoint)tx.objectStore('generationCheckpoints').put({id:'pending',scope:JSON.stringify({projectId:0,repoId:'r'})});
  });db.close();
}
test('hazard inventory uses metadata, whole deletion preserves unrelated results and uncertain shared pages',async()=>{
  await seed([]);await seedHazards();
  const hazard=(await inventoryLogicalStorage(projects)).items.find(item=>item.type==='hazards');expect(hazard.eligible).toBe(true);
  await deleteLogicalStorageItem(hazard,opts());
  const db=await openLogicalStorage('xhandle-code-architecture-hazard-analysis');
  expect(await logicalKeys(db,'runMetadata')).toEqual(['hazard-other']);expect(await logicalKeys(db,'hazardAnalysisRuns')).toEqual(['hazard-other']);
  expect(await logicalKeys(db,'hazardRunChunks')).toEqual(['shared-generation:0']);db.close();
});
test('unpublished hazard checkpoints disable and refuse whole-result deletion',async()=>{
  await seedHazards();
  const db=await openLogicalStorage('xhandle-code-architecture-hazard-analysis');
  await logicalTransaction(db,'generationCheckpoints','readwrite',tx=>tx.objectStore('generationCheckpoints').put({id:'pending',scope:'{}'}));db.close();
  await expect(deleteLogicalStorageItem({type:'hazards',scope,projectId:0,repoId:'r',workspaceType:'code-architecture'},opts())).rejects.toThrow(/Recoverable/);
});

test('inventory never reads saved analysis, hazard payload or artifact page values',async()=>{
  await seed([[scope,[]]]);await seedHazards();
  const spy=jest.spyOn(IDBObjectStore.prototype,'get');
  try {
    await inventoryLogicalStorage(projects);
    expect(spy.mock.calls.every(([key])=>String(key).endsWith(':metadata'))).toBe(true);
  }finally{spy.mockRestore();}
});
test('a surviving unpublished result in another scope keeps shared immutable chunks',async()=>{
  await seed([[scope,{format:'xhandle-json-tree-v1',root}], [root,JSON.stringify(['array',[]])],
    ['functional-decomposition-checkpoint:cba:other:r:f',{phase:'ready-to-publish',rowRecord:{format:'xhandle-json-tree-v1',root}}]]);
  await deleteLogicalStorageItem(item('architecture'),opts());expect(await keys()).toContain(root);
});

test('a published result with failed work keeps request caches for recovery',async()=>{
  await seed([[scope,[]],[`${scope}:run`,{}],[`${scope}:run:${fingerprint}`,{}],[`${scope}:metadata`,{...completeMetadata,failedFileCount:1}],[`${scope}:functional-work:1`,{}]]);
  expect((await inventoryLogicalStorage(projects)).items.find(item=>item.type==='temporary').eligible).toBe(false);
  await expect(deleteLogicalStorageItem(item('temporary'),opts())).rejects.toThrow(/publication/);
  expect(await keys()).toContain(`${scope}:functional-work:1`);
});
test('mutation exceptions abort atomically, keep the useful cause, and remain retryable',async()=>{
  await seed([[scope,{format:'xhandle-json-tree-v1',root}],[root,JSON.stringify(['array',[]])]]);
  const original=IDBObjectStore.prototype.delete;
  const spy=jest.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(key){if(key===scope)throw new Error('Synthetic delete failure');return original.call(this,key);});
  try{await expect(deleteLogicalStorageItem(item('architecture'),opts())).rejects.toThrow('Synthetic delete failure');}finally{spy.mockRestore();}
  expect(await keys()).toContain(scope);expect(await keys()).toContain(root);
  await deleteLogicalStorageItem(item('architecture'),opts());expect(await keys()).not.toContain(scope);
});

test('foreign graph workspace ownership cannot be hidden by authoritative active metadata',async()=>{
  const {classifyStoredWorkspaceProjects}=require('./storageWorkspaceVisibility');
  const merged=classifyStoredWorkspaceProjects([{id:0,workspaceId:'another-workspace',sourceStore:'localStorage:xhandle.codeArchitectureProjects',sourceData:{id:0,repos:[{id:'r'}]}}],[],[{id:0,repos:[{id:'r'}]}]);
  await seed([[scope,[]]]);
  await expect(deleteLogicalStorageItem(item('architecture'),{getProjects:async()=>merged})).rejects.toThrow(/ownership/);
  expect(await keys()).toContain(scope);
});
test('legacy reports are recognizable but explicitly unavailable for whole-item deletion without reading report payloads',async()=>{
  await seed([]);
  const db=await new Promise(resolve=>{const r=indexedDB.open('xhandle-project-reports',1);r.onupgradeneeded=()=>r.result.createObjectStore('safetyIssueReports',{keyPath:'projectId'});r.onsuccess=()=>resolve(r.result);});
  await logicalTransaction(db,'safetyIssueReports','readwrite',tx=>tx.objectStore('safetyIssueReports').put({projectId:0,markdown:'large report '.repeat(10000)}));db.close();
  const spy=jest.spyOn(IDBObjectStore.prototype,'get');
  try {
    const result=await inventoryLogicalStorage([{id:0,workspaceType:'functional'}]);
    expect(result.items).toEqual([expect.objectContaining({label:'Safety issue report',eligible:false,type:'legacy'})]);
    expect(spy).not.toHaveBeenCalled();
  }finally{spy.mockRestore();}
});

test('hazard ownership follows explicit repository identity separately from connection ID and rejects shared ambiguous connections',async()=>{
  await seed([]);await seedHazards();
  const db=await openLogicalStorage('xhandle-code-architecture-hazard-analysis');
  await logicalTransaction(db,['runMetadata','hazardAnalysisRuns'],'readwrite',tx=>{for(const store of ['runMetadata','hazardAnalysisRuns'])tx.objectStore(store).put({id:'hazard-owned',projectId:0,repoId:'external/repository'});});db.close();
  const configured=[{...projects[0],sourceData:{id:0,repos:[{id:'r',repoId:'external/repository'}]}}];
  const hazard=(await inventoryLogicalStorage(configured)).items.find(item=>item.type==='hazards');
  expect(hazard).toMatchObject({repoId:'r',analysisRepoId:'external/repository',eligible:true});
  const ambiguous=[{...configured[0],sourceData:{id:0,repos:[...configured[0].sourceData.repos,{id:'other-connection',repoId:'external/repository'}]}}];
  expect((await inventoryLogicalStorage(ambiguous)).unassigned).toBe(true);
  await expect(deleteLogicalStorageItem(hazard,{getProjects:async()=>ambiguous})).rejects.toThrow(/ownership/);
  await deleteLogicalStorageItem(hazard,{getProjects:async()=>configured});
});

test('the hazard producer refuses saves during whole-item cleanup',async()=>{
  const {withHazardStorageCleanup,saveCodeArchitectureHazardRun}=require('../features/code-architecture-hazard-analysis/codeArchitectureHazardStore');
  await withHazardStorageCleanup(0,'r',async()=>{
    await expect(saveCodeArchitectureHazardRun({id:'late-run',projectId:0,repoId:'r'})).rejects.toThrow(/cleanup/);
  });
});

test('artifact cleanup follows explicit page references and parent ownership, preserving similarly named foreign roots',async()=>{
  await seed([]);
  const key='xhandle:cba-software-requirements:0:r';
  const db=await new Promise(resolve=>{const r=indexedDB.open('xhandle-code-architecture-assurance',1);r.onupgradeneeded=()=>r.result.createObjectStore('artifactRows',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);});
  await logicalTransaction(db,'artifactRows','readwrite',tx=>{
    const store=tx.objectStore('artifactRows');
    store.put({key,chunked:true,chunkKeys:['custom-page'],rows:[],rowCount:1});
    store.put({key:'custom-page',parentKey:key,rows:[{id:'SWR-1'}]});
    store.put({key:`${key}:chunk:foreign`,rows:[{id:'other collection'}]});
  });db.close();
  const collection=(await inventoryLogicalStorage(projects)).items.find(item=>item.type==='artifact');
  await deleteLogicalStorageItem(collection,opts());
  const reopened=await openLogicalStorage('xhandle-code-architecture-assurance');
  expect(await logicalKeys(reopened,'artifactRows')).toEqual([`${key}:chunk:foreign`]);reopened.close();
});

test('numeric project export/import preserves intentional deletion and suppresses legacy alias resurrection',async()=>{
  const {exportProjectArchive,importProjectArchive}=require('../features/code-architecture-transfer/projectArchive');
  const project={id:0,name:'Numeric archive fixture',repos:[{id:'r',repoId:'test/source',owner:'test',repo:'source'}]};
  const alias='cba:0:test/source';
  await seed([[scope,[]],[alias,[{from:'Legacy alias'}]]]);
  await deleteLogicalStorageItem(item('architecture'),{getProjects:async()=>[{...project,workspaceType:'code-architecture',sourceData:project}]});
  const archive=await exportProjectArchive(project);
  global.indexedDB=new IDBFactory();localStorage.clear();
  await importProjectArchive(archive);
  expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].id).toBe(0);
  expect(await readFirstCbaRowsFromIndexedDB([scope,alias])).toMatchObject({rows:[],found:true});
  expect(await keys()).toContain(`${scope}:storage-deleted`);
});
