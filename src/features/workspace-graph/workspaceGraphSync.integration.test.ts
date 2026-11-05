import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { openDB } from 'idb';
import { migrateLegacyStorageToWorkspaceGraphIfStale as sync } from './legacyWorkspaceGraphMigrator';
import { listArtifacts, listProjects, listRelationships, upsertArtifact, upsertArtifacts, reconcileWorkspaceGraphSources } from './workspaceGraphRepository';
import { buildWorkspaceLLMContext } from './workspaceGraphContextBuilder';
import { notifyBackupDataChanged } from '../../lib/localBackupEvents';
import { saveGeneratedReport, deleteGeneratedReport } from '../project-hazard-analysis/generatedReportStorage';

beforeEach(() => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  localStorage.clear();
});
afterEach(() => jest.restoreAllMocks());
const requirements = title => localStorage.setItem('xhandle:requirements', JSON.stringify([{ id: 'REQ-1', projectId: 'p', title }]));
const force = () => sync({ force: true });

test('full-refresh key pages prune only obsolete mirrors and preserve retained or unreadable sources',async()=>{
 const make=(id,sourceStore='source',extra={})=>({id,type:'note',title:id,sourceStore,createdAt:'2026-11-04',updatedAt:'2026-11-04',...extra});
 await upsertArtifacts([
  ...Array.from({length:520},(_,i)=>make('desired-'+String(i).padStart(3,'0'))),
  make('obsolete'),make('unreadable','failed-source'),make('canonical','canonical'),
  make('retained-root','source',{sourceKey:'unchanged'}),make('retained-project','source',{type:'project'}),
 ]);
 const get=IDBObjectStore.prototype.get;
 const guard=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){
  if(this.name==='artifacts'&&String(key).startsWith('desired-'))throw Error('Loaded a freshly indexed body');
  return get.call(this,key);
 });
 try{
  expect(await reconcileWorkspaceGraphSources({fullRefresh:true,sourceStores:new Set(['source']),ids:{artifacts:new Set(Array.from({length:520},(_,i)=>'desired-'+String(i).padStart(3,'0')))},retainedKeys:new Map([['source',new Set(['unchanged'])]])})).toBe(2);
 }finally{guard.mockRestore();}
 expect((await listArtifacts()).map(row=>row.id)).toEqual(expect.arrayContaining(['unreadable','canonical','retained-root','retained-project','desired-000','desired-519']));
 expect((await listArtifacts()).some(row=>row.id==='obsolete')).toBe(false);
});

test('equal-length edits invalidate a fresh snapshot; deleting a source prunes its mirror and links', async () => {
  requirements('Alpha'); await force();
  expect((await sync()).skipped).toBe(true);
  requirements('Bravo'); expect((await sync()).skipped).not.toBe(true);
  expect((await listArtifacts({type:'requirement'})).map(row=>row.title)).toEqual(['Bravo']);
  localStorage.setItem('xhandle:requirements', '[]'); await sync();
  expect(await listArtifacts({type:'requirement'})).toEqual([]);
  expect(await listRelationships()).toEqual([]);
});

test('a failed source scan keeps previous evidence, reports the failure and retries', async () => {
  requirements('Keep me'); await force();
  localStorage.setItem('xhandle:requirements', '{broken');
  const failed = await sync();
  expect(failed.errors).toEqual(expect.arrayContaining([expect.objectContaining({step:'requirements'})]));
  expect((await listArtifacts({type:'requirement'}))[0].title).toBe('Keep me');
  requirements('Fixed'); await sync();
  expect((await listArtifacts({type:'requirement'}))[0].title).toBe('Fixed');
});

test('reconciliation preserves retained workspace identities and unrelated canonical records', async () => {
  localStorage.setItem('xhandle.projects', JSON.stringify([{id:'p',name:'Retained'}]));
  await force();
  await upsertArtifact({id:'manual',type:'note',title:'Manual',sourceStore:'canonical',createdAt:'2026-11-04',updatedAt:'2026-11-04'});
  localStorage.setItem('xhandle.projects', '[]'); await sync();
  expect((await listProjects()).map(row=>row.id)).toContain('p');
  expect((await listArtifacts()).map(row=>row.id)).toContain('manual');
  expect((await listArtifacts({type:'project'})).some(row=>row.projectId==='p')).toBe(true);
});

test('saved report versions refresh immediately and delete without copying images or resurrecting tombstones', async () => {
  await force();
  const a = await saveGeneratedReport('p', {report:'# Alpha report',title:'Alpha',functionalDiagramImage:'data:image/png;base64,PRIVATE_IMAGE'});
  const b = await saveGeneratedReport('p', {report:'# Bravo report',title:'Bravo',status:'draft'});
  await sync();
  let rows=await listArtifacts({type:'generated_report'});
  expect(rows.map(row=>row.title).sort()).toEqual(['Alpha','Bravo']);
  expect(JSON.stringify(rows)).not.toContain('PRIVATE_IMAGE');
  expect(rows.find(row=>row.title==='Bravo')?.status).toBe('draft');
  expect(rows.find(row=>row.title==='Alpha')?.sourceId).toBe(a.libraryId);
  await deleteGeneratedReport('p', a.libraryId); await sync();
  rows=await listArtifacts({type:'generated_report'});
  expect(rows.map(row=>row.sourceId)).toEqual([b.libraryId]);
});

test('unreadable report bodies keep the previous mirror and a later successful scan removes a deleted version', async () => {
  const a=await saveGeneratedReport('p',{report:'Evidence',title:'Evidence'}); await force();
  const get=IDBObjectStore.prototype.get;
  const spy=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){
    if(this.name==='reports') throw new Error('Unavailable report storage');
    return get.call(this,key);
  });
  const failed=await force();
  expect(failed.errors.some(row=>row.step==='generatedReports')).toBe(true);
  expect(await listArtifacts({type:'generated_report'})).toHaveLength(1);
  spy.mockRestore(); await deleteGeneratedReport('p',a.libraryId); await sync();
  expect(await listArtifacts({type:'generated_report'})).toEqual([]);
});

test('committed IndexedDB change notifications invalidate cached requirements, including deletions', async () => {
  const db=await openDB('xhandle-code-architecture-assurance',1,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'key'});}});
  const key='xhandle:cba-software-requirements:p:repo';
  await db.put('artifactRows',{key,rows:[{id:'SW-1',title:'Alpha',requirementText:'Stop safely'}]});
  await force();
  await db.put('artifactRows',{key,rows:[{id:'SW-1',title:'Bravo',requirementText:'Stop safely'}]});
  notifyBackupDataChanged({db:'xhandle-code-architecture-assurance'}); await sync();
  expect((await listArtifacts({type:'code_architecture_software_requirement'}))[0].title).toBe('Bravo');
  await db.clear('artifactRows'); notifyBackupDataChanged(); await sync(); db.close();
  expect(await listArtifacts({type:'code_architecture_software_requirement'})).toEqual([]);
});

test('System Test documents and legacy tests are indexed without duplicating cached document tests', async () => {
  localStorage.setItem('xhandle:vnv-test-case-documents',JSON.stringify([{id:'doc',sourceProjectId:'p',testCases:[{id:'TC-1',title:'Brake test',status:'Passed',requirementId:'REQ-1'}]}]));
  localStorage.setItem('xhandle.projectData',JSON.stringify({p:{vnvArtifacts:{testCaseDocument:{id:'doc'},tests:[{id:'TC-1',title:'Cached duplicate'}]}},q:{vnvArtifacts:{testCases:[{id:'TC-1',title:'Legacy test'}]}}}));
  await force();
  expect((await listArtifacts({type:'test_case'})).map(row=>row.title).sort()).toEqual(['Brake test','Legacy test']);
  localStorage.setItem('xhandle:vnv-test-case-documents','[]'); await sync();
  expect((await listArtifacts({type:'test_case'})).map(row=>row.title)).toEqual(['Legacy test']);
});

test('domain indexing reconciles shared projectData writers together and preserves verification targets',async()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'p',name:'P'}]));
 localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'REQ-1',projectId:'p',title:'Stop safely'}]));
 const data={p:{responseRows:[{fromFunction:'Sense',toFunction:'Stop'}],vnvArtifacts:{tests:[{id:'TC-1',title:'Brake',requirementId:'REQ-1'}]}}};
 localStorage.setItem('xhandle.projectData',JSON.stringify(data));
 const result=await sync({force:true,steps:['projectData']});
 for(const step of ['requirements','traceability','verificationTests'])expect(result.deferredSteps).not.toContain(step);
 expect(await listArtifacts({type:'functional_decomposition_row'})).toHaveLength(1);
 expect(await listArtifacts({type:'test_case'})).toHaveLength(1);
 expect((await listRelationships()).some(row=>row.type==='verifies')).toBe(true);
 data.p.responseRows[0].fromFunction='Changed';localStorage.setItem('xhandle.projectData',JSON.stringify(data));
 await sync({steps:['projectData']});
 expect(await listArtifacts({type:'test_case'})).toHaveLength(1);
 expect((await listArtifacts({type:'functional_decomposition_row'}))[0].title).toContain('Changed');
});

test('scope filtering happens before candidate limits and project totals are not capped', async () => {
  localStorage.setItem('xhandle.projects',JSON.stringify(Array.from({length:31},(_,i)=>({id:'p'+i,name:'Project '+i}))));
  localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'REQ-1',projectId:'p0',title:'Target requirement'}]));
  localStorage.setItem('xhandle.projectData',JSON.stringify({p0:{responseRows:Array.from({length:60},(_,i)=>({fromFunction:'Function '+i,toFunction:'Other '+i}))}}));
  const context=await buildWorkspaceLLMContext({projectId:'p0',query:'requirement',areas:['requirements'],tokenBudget:5000});
  expect(context.workspaceSummary.projectCount).toBe(31);
  expect(context.diagnostics.truncation.projects).toMatchObject({total:31,truncated:true});
  expect(context.relevantArtifacts).toHaveLength(1);
  expect(context.relevantArtifacts[0].title).toBe('Target requirement');
});

test('internal diagnostic and UI broadcasts do not invalidate a fresh source snapshot', async () => {
  requirements('Stable'); await force();
  window.dispatchEvent(new StorageEvent('storage',{key:'xhandle.workspaceGraph.lastMigration',newValue:'diagnostics'}));
  window.dispatchEvent(new Event('xhandle:data-changed'));
  notifyBackupDataChanged({db:'xhandle-workspace-graph'});
  expect((await sync()).skipped).toBe(true);
});

test('a save during indexing causes one fresh retry instead of caching the older snapshot', async () => {
  requirements('Alpha');
  const put=IDBObjectStore.prototype.put;
  let changed=false;
  jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(...args){
    if(this.name==='artifactIndex'&&!changed){changed=true;requirements('Bravo');}
    return put.apply(this,args);
  });
  const result=await sync({force:true});
  expect(result.sourceChangedDuringMigration).toBe(false);
  expect((await listArtifacts({type:'requirement'}))[0].title).toBe('Bravo');
  expect((await sync()).skipped).toBe(true);
});

test('a small named project does not index unrelated CBA sources or repair foreign legacy bodies',async()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'small',name:'Human perception'}]));
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'large',name:'Large CBA'}]));
 localStorage.setItem('xhandle.projectData',JSON.stringify({small:{responseRows:Array.from({length:23},(_,i)=>({fromFunction:'Observe '+i,toFunction:'Decide '+i,description:'ACTUAL_SAVED_EVIDENCE'}))}}));
 const {openWorkspaceGraphDB}=require('./workspaceGraphDb');const db=await openWorkspaceGraphDB();
 await db.put('artifacts',{id:'foreign-legacy',projectId:'large',type:'code_architecture_edge',title:'Legacy',sourceStore:'indexedDB:xhandle/copilot_baseline',content:'FOREIGN_LEGACY_BODY',createdAt:'old',updatedAt:'old'});db.close();
 const get=IDBObjectStore.prototype.get;
 jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){if(key==='foreign-legacy'||['copilot_baseline','artifactRows','code_index'].includes(this.name))throw Error('Unrelated heavy source was read');return get.call(this,key);});
 const context=await buildWorkspaceLLMContext({query:'Summarize Human perception',projectId:'large',areas:['projects','functional','requirements'],contextOnDemand:true});
 expect(context.scope.projectId).toBe('small');expect(context.diagnostics.migration.errors).toEqual([]);
 expect(context.diagnostics.migration.projectIds).toEqual(['small']);
 expect(context.diagnostics.migration.deferredSteps).toEqual(expect.arrayContaining(['codeArchitecture','codeArchitectureAssurance','codeIndex']));
 expect(JSON.stringify(context.diagnostics.overview.rows)).toContain('ACTUAL_SAVED_EVIDENCE');
 expect(context.diagnostics.overview.rows).toHaveLength(23);
 expect(JSON.stringify(context.relevantArtifacts)).not.toContain('FOREIGN_LEGACY_BODY');
 const reopened=await openWorkspaceGraphDB();expect(await reopened.count('artifacts')).toBeLessThan(23);expect(await reopened.getKey('artifacts','foreign-legacy')).toBe('foreign-legacy');reopened.close();
});

test('project-scoped CBA indexing skips foreign root payloads, preserves their mirrors, and supports later wider indexing',async()=>{
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'p',name:'Target'},{id:'q',name:'Other'}]));
 const db=await openDB('xhandle',4,{upgrade(db){db.createObjectStore('copilot_baseline',{keyPath:'key'});}});
 await db.put('copilot_baseline',{key:'cba:p:repo',updatedAt:'first',value:[{from:'Observe',to:'Act',description:'TARGET_EVIDENCE'}]});
 await db.put('copilot_baseline',{key:'cba:q:repo',value:[{from:'Other',to:'Elsewhere'}]});db.close();
 await upsertArtifact({id:'foreign-mirror',projectId:'q',type:'code_architecture_edge',sourceStore:'indexedDB:xhandle/copilot_baseline',title:'Retained foreign',createdAt:'old',updatedAt:'old'});
 const get=IDBObjectStore.prototype.get;const guard=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){if(key==='cba:q:repo')throw Error('Foreign root read');return get.call(this,key);});
 const result=await sync({steps:['projects','codeArchitecture'],projectIds:['p']});
 expect(result.errors).toEqual([]);expect((await listArtifacts({projectId:'p'})).some(r=>r.summary?.includes('TARGET_EVIDENCE'))).toBe(true);
 expect((await listArtifacts({projectId:'q'})).some(r=>r.id==='foreign-mirror')).toBe(true);
 guard.mockRestore();
 // Re-scan the store while the target root is unchanged: its checkpoint must retain the rows.
 const changed=await openDB('xhandle',4);await changed.put('copilot_baseline',{key:'cba:q:repo',value:[{from:'Other',to:'Elsewhere'}]});changed.close();notifyBackupDataChanged({db:'xhandle'});
 const repeat=await sync({steps:['projects','codeArchitecture'],projectIds:['p']});expect(repeat.errors).toEqual([]);
 expect((await listArtifacts({projectId:'p'})).some(r=>r.summary?.includes('TARGET_EVIDENCE'))).toBe(true);
 const removed=await openDB('xhandle',4);await removed.put('copilot_baseline',{key:'cba:p:repo',updatedAt:'second',value:[]});removed.close();notifyBackupDataChanged({db:'xhandle'});
 await sync({steps:['projects','codeArchitecture'],projectIds:['p']});expect((await listArtifacts({projectId:'p'})).filter(r=>r.type==='code_architecture_edge')).toEqual([]);
 const wider=await sync({steps:['projects','codeArchitecture']});expect(wider.errors).toEqual([]);
 expect((await listArtifacts({projectId:'q'})).some(r=>r.title==='Other -> Elsewhere')).toBe(true);
 expect((await listArtifacts({projectId:'q'})).some(r=>r.id==='foreign-mirror')).toBe(false);
});

test('root enumeration seeks past internal chunk ranges without missing later project roots',async()=>{
 const db=await openDB('xhandle',4,{upgrade(db){db.createObjectStore('copilot_baseline',{keyPath:'key'});}});
 const tx=db.transaction('copilot_baseline','readwrite');
 for(const project of ['p','q']){
  tx.store.put({key:`cba:${project}:repo`,value:[{from:project,to:'Saved function'}]});
  for(let i=0;i<600;i++){tx.store.put({key:`cba:${project}:repo:$part:${String(i).padStart(5,'0')}`,value:'unused historical part'});tx.store.put({key:`cba:${project}:repo:functional-work:${i}`,value:{response:'Cached processing, not saved diagram rows'}});tx.store.put({key:`functional-decomposition-checkpoint:cba:${project}:repo:${i}`,value:{rows:[{from:'Not published'}]}});}
 }
 await tx.done;db.close();
 const getAllKeys=IDBObjectStore.prototype.getAllKeys;let pages=0;
 jest.spyOn(IDBObjectStore.prototype,'getAllKeys').mockImplementation(function(...args){if(this.name==='copilot_baseline')pages++;return getAllKeys.apply(this,args);});
 const result=await sync({force:true,steps:['codeArchitecture']});expect(result.errors).toEqual([]);
 expect((await listArtifacts({type:'code_architecture_edge'})).map(row=>row.projectId).sort()).toEqual(['p','q']);
 expect(pages).toBeLessThanOrEqual(6);
});

test('shared architecture source files are indexed once while every reference remains available',async()=>{
 const db=await openDB('xhandle',4,{upgrade(db){db.createObjectStore('copilot_baseline',{keyPath:'key'});}});
 await db.put('copilot_baseline',{key:'cba:p:repo',value:Array.from({length:300},(_,i)=>({traceId:'edge-'+i,from:'Source '+i,to:'Target',fromFile:'shared.cpp',toFile:'shared.cpp'}))});db.close();
 const put=IDBObjectStore.prototype.put;let fileWrites=0;
 jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(row,...args){if(this.name==='artifacts'&&row.type==='source_file')fileWrites++;return put.call(this,row,...args);});
 const result=await sync({force:true,steps:['codeArchitecture'],projectIds:['p']});expect(result.errors).toEqual([]);
 expect(fileWrites).toBe(1);expect(await listArtifacts({type:'code_architecture_edge'})).toHaveLength(300);
 expect((await listRelationships()).filter(row=>row.type==='references')).toHaveLength(300);
});

test('context reports real persisted batches before indexing finishes, then search stages',async()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'progress',name:'Progress project'}]));
 localStorage.setItem('xhandle:requirements',JSON.stringify(Array.from({length:700},(_,i)=>({id:`progress-${i}`,projectId:'progress',title:`Requirement ${i}`}))));
 let now=Date.now();jest.spyOn(Date,'now').mockImplementation(()=>now+=600);
 const events=[];
 const result=await buildWorkspaceLLMContext({projectId:'progress',query:'requirements',onProgress:event=>events.push(event)});
 expect(result.diagnostics.migration.errors).toEqual([]);
 const batches=events.filter(e=>e.step==='requirements'&&!e.complete&&e.recordsPrepared>0);
 expect(batches.length).toBeGreaterThan(1);
 expect(batches[1].recordsPrepared).toBeGreaterThan(batches[0].recordsPrepared);
 expect(events.findIndex(e=>e.step==='requirements'&&e.complete)).toBeGreaterThan(events.indexOf(batches[0]));
 expect(events.slice(-2).map(e=>e.step)).toEqual(['searching','relationships']);
 expect(Object.keys(batches[0]).sort()).toEqual(['complete','durationMs','recordsPrepared','step']);
});
