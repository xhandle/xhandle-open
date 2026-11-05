import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { openDB, unwrap } from 'idb';
import { buildWorkspaceLLMContext } from './workspaceGraphContextBuilder';
import { migrateLegacyStorageToWorkspaceGraphIfStale as sync } from './legacyWorkspaceGraphMigrator';
import { runWorkspaceGraphIndexPass } from './workspaceGraphMigrationCore';
import { upsertArtifacts, listArtifacts, getArtifact } from './workspaceGraphRepository';
import { queryWorkspaceCandidates, workspaceGraphCounts } from './workspaceGraphQueries';
import { notifyBackupDataChanged } from '../../lib/localBackupEvents';
import { saveCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { writeRecord } from '../code-architecture-storage/chunkedRecord';
beforeAll(()=>{Object.assign(global,{TextEncoder,TextDecoder});Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(()=>{global.indexedDB=new IDBFactory();global.structuredClone=v=>deserialize(serialize(v));localStorage.clear();});
afterEach(()=>jest.restoreAllMocks());
const force=()=>sync({force:true});

test('fresh repository projections do not cause a second full-body rebuild',async()=>{
 await upsertArtifacts([{id:'ready',projectId:'p',type:'note',title:'Ready',content:'Complete evidence',createdAt:'2026-11-04',updatedAt:'2026-11-04'}]);
 const {ensureWorkspaceProjection}=require('./workspaceGraphQueries');
 const original=IDBObjectStore.prototype.getAll;
 const scan=jest.spyOn(IDBObjectStore.prototype,'getAll').mockImplementation(function(...args){if(this.name==='artifacts')throw Error('Redundant body scan');return original.apply(this,args);});
 try{await ensureWorkspaceProjection();expect(await getArtifact('ready')).toMatchObject({content:'Complete evidence'});}finally{scan.mockRestore();}
});

test('queries use compact indexes, exact counts and selected rows without loading artifact bodies',async()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'p',name:'P'}]));
 await upsertArtifacts(Array.from({length:500},(_,i)=>({id:'a'+i,projectId:'p',type:'code_architecture_edge',title:'Function '+i,sourceId:'source:'+i,structuredData:{padding:'x'.repeat(20000),_rowIndex:i},createdAt:'2026-11-04',updatedAt:'2026-11-04'})));
 await force();
 const get=IDBObjectStore.prototype.get,getAll=IDBObjectStore.prototype.getAll;
 jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(...args){if(this.name==='artifacts')throw Error('Hydrated an artifact body');return get.apply(this,args);});
 jest.spyOn(IDBObjectStore.prototype,'getAll').mockImplementation(function(...args){if(this.name==='artifacts')throw Error('Scanned artifact bodies');return getAll.apply(this,args);});
 const context=await buildWorkspaceLLMContext({projectId:'p',query:'function 1',areas:['functional'],activeView:{activeSelections:[{tableId:'code-architecture-functional-decomposition',selectedRows:[{rowIndex:499}]}]}});
 expect(context.relevantArtifacts.some(row=>row.id==='a499')).toBe(true);
 expect(context.workspaceSummary.artifactCount).toBe(501);
 expect(context.diagnostics.retrieval.fullBodiesLoaded).toBe(false);
 expect(JSON.stringify(context).length).toBeLessThan(100000);
});

test('source signatures survive a new indexing pass and skip every unchanged source',async()=>{
 localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'REQ-1',projectId:'p',title:'Stop'}]));await force();
 const get=IDBObjectStore.prototype.getAllKeys;
 jest.spyOn(IDBObjectStore.prototype,'getAllKeys').mockImplementation(function(...args){if(['hazardAnalysisRuns','artifactRows','code_index'].includes(this.name))throw Error('Read unchanged source');return get.apply(this,args);});
 const result=await runWorkspaceGraphIndexPass();
 expect(result.errors).toEqual([]);expect(result.skippedSteps).toHaveLength(12);expect(result.artifactCount).toBe(0);
});

test('a focused requirements lookup never scans unrelated source or hazard stores, and broader retrieval still does',async()=>{
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'p',name:'Vehicle'}]));
 const db=await openDB('xhandle-code-architecture-assurance',1,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'key'});}});
 await db.put('artifactRows',{key:'xhandle:cba-software-requirements:p:repo',revision:1,rows:[{id:'SW1',requirementText:'Stop safely'}]});db.close();
 const get=IDBObjectStore.prototype.getAllKeys;
 const scan=jest.spyOn(IDBObjectStore.prototype,'getAllKeys').mockImplementation(function(...args){if(['hazardAnalysisRuns','code_index','copilot_baseline'].includes(this.name))throw Error('Unrelated source scan');return get.apply(this,args);});
 const context=await buildWorkspaceLLMContext({projectId:'p',query:'Show all software requirements'});
 expect(context.diagnostics.migration.errors).toEqual([]);expect(context.diagnostics.migration.deferredSteps).toContain('indexedFeatureStores');
 expect(context.relevantArtifacts[0].type).toBe('code_architecture_software_requirement');
 expect(context.workspaceSummary.artifactCount).toBeNull();expect(context.sourceFiles).toEqual([]);
 scan.mockRestore();
 const all=await sync();expect(all.deferredSteps).toEqual([]);expect(all.skippedSteps).toEqual(expect.arrayContaining(['projects','codeArchitectureAssurance']));
 expect((await listProjectsForTest()).some(row=>row.id==='p'&&row.projectType==='code-based-architecture')).toBe(true);
});

async function listProjectsForTest(){return require('./workspaceGraphRepository').listProjects();}

test('a changed assurance source does not rescan unrelated hazards',async()=>{
 const db=await openDB('xhandle-code-architecture-assurance',1,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'key'});}});
 const key='xhandle:cba-software-requirements:p:repo';await db.put('artifactRows',{key,revision:1,rows:[{id:'SW1',title:'Before'}]});await force();
 await db.put('artifactRows',{key,revision:2,rows:[{id:'SW1',title:'After'}]});notifyBackupDataChanged({db:'xhandle-code-architecture-assurance'});
 const result=await sync();db.close();expect(result.skippedSteps).toContain('indexedFeatureStores');
 expect((await listArtifacts({type:'code_architecture_software_requirement'}))[0].title).toBe('After');
});

test('unchanged revisioned source records are retained without reading their chunk bodies',async()=>{
 const db=await openDB('xhandle',4,{upgrade(db){for(const name of ['code_index','copilot_baseline','diagram_positions'])db.createObjectStore(name,{keyPath:'key'});}});
 await writeRecord(unwrap(db),'copilot_baseline','functional-decomposition-checkpoint:cba:p:repo',{rows:[{from:'Checkpoint only'}],padding:'z'.repeat(30000)});
 const key='cba:p:repo';await writeRecord(unwrap(db),'copilot_baseline',key,Array.from({length:100},(_,i)=>({traceId:'T'+i,from:'From '+i,to:'To '+i,description:'d'.repeat(500)})));
 await force();notifyBackupDataChanged({db:'xhandle',stores:['copilot_baseline']});
 const get=IDBObjectStore.prototype.get;
 jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){if(this.name==='copilot_baseline'&&String(key).includes(':$part:'))throw Error('Read unchanged chunk');return get.call(this,key);});
 const result=await sync();db.close();expect(result.errors).toEqual([]);expect(await listArtifacts({type:'code_architecture_edge'})).toHaveLength(100);
});

test('chunked hazard indexing reads table pages without loading evidence payloads',async()=>{
 const run={id:'paged',projectId:'p',repoId:'r',createdAt:'2026-11-04',generatedSheets:{Summary:[['Hazard','Description'],...Array.from({length:230},(_,i)=>['Hazard '+i,'Details'])]},evidence:'PRIVATE_EVIDENCE '.repeat(25000)};
 await saveCodeArchitectureHazardRun(run);
 const result=await force();expect(result.errors).toEqual([]);
 expect(await listArtifacts({type:'code_architecture_hazard_row'})).toHaveLength(230);
 const {openWorkspaceGraphDB}=require('./workspaceGraphDb');const graph=await openWorkspaceGraphDB();const runs=await graph.getAll('runs');graph.close();
 expect(JSON.stringify(runs)).not.toContain('PRIVATE_EVIDENCE');
});

test('aborted indexing is retryable and does not publish a successful checkpoint',async()=>{
 const controller=new AbortController();const put=IDBObjectStore.prototype.put;
 localStorage.setItem('xhandle:requirements',JSON.stringify(Array.from({length:300},(_,i)=>({id:'R'+i,title:'Requirement '+i,projectId:'p'}))));
 const spy=jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(...args){const request=put.apply(this,args);if(this.name==='artifactIndex')controller.abort();return request;});
 await expect(sync({force:true,signal:controller.signal})).rejects.toHaveProperty('name','AbortError');spy.mockRestore();
 await force();expect(await listArtifacts({type:'requirement'})).toHaveLength(300);
// This verifies persisted retry correctness across hundreds of asynchronous IDB
// writes; the unit-test default is not a performance deadline under host load.
},30000);

test('explicit artifact access still returns a complete body after indexed retrieval',async()=>{
 await upsertArtifacts([{id:'full',projectId:'p',title:'Full body',type:'note',content:'complete '.repeat(5000),createdAt:'2026-11-04',updatedAt:'2026-11-04'}]);
 const result=await queryWorkspaceCandidates('full',{projectId:'p'});expect(result.rows[0].content.length).toBeLessThan(1000);
 expect((await getArtifact('full'))?.content).toHaveLength(45000);expect((await workspaceGraphCounts('p')).artifactCount).toBe(1);
});

test('a deleted and identically recreated revisioned root is indexed again',async()=>{
 const db=await openDB('xhandle-code-architecture-assurance',1,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'key'});}});
 const root={key:'xhandle:cba-software-requirements:p:repo',revision:1,rows:[{id:'SW1',title:'Restored'}]};
 await db.put('artifactRows',root);await force();await db.clear('artifactRows');notifyBackupDataChanged({db:'xhandle-code-architecture-assurance'});await sync();
 expect(await listArtifacts({type:'code_architecture_software_requirement'})).toHaveLength(0);
 await db.put('artifactRows',root);notifyBackupDataChanged({db:'xhandle-code-architecture-assurance'});await sync();db.close();
 expect(await listArtifacts({type:'code_architecture_software_requirement'})).toHaveLength(1);
});

test('version two graph upgrades and repairs compact projections without dropping full bodies',async()=>{
 const old=await openDB('xhandle-workspace-graph',2,{upgrade(db){db.createObjectStore('artifacts',{keyPath:'id'});}});
 await old.put('artifacts',{id:'legacy',projectId:'p',type:'note',title:'Legacy note',content:'retained '.repeat(5000),createdAt:'2026-11-04',updatedAt:'2026-11-04'});old.close();
 await force();const rows=await queryWorkspaceCandidates('legacy',{projectId:'p'});
 expect(rows.rows[0].id).toBe('legacy');expect(rows.rows[0].content.length).toBeLessThan(1000);expect((await getArtifact('legacy'))?.content.length).toBe(45000);
});

test('one aborted caller does not cancel indexing needed by another caller',async()=>{
 localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'shared',projectId:'p',title:'Shared'}]));
 const controller=new AbortController();const cancelled=sync({force:true,signal:controller.signal});const other=sync({force:true});controller.abort();
 await expect(cancelled).rejects.toHaveProperty('name','AbortError');expect((await other).errors).toEqual([]);expect(await listArtifacts({type:'requirement'})).toHaveLength(1);
});

test('source-file indexing reads a bounded text prefix and omits unused chunked payloads',async()=>{
 const {readSourceFileProjection}=require('./workspaceSourcePages');
 const db=await openDB('xhandle',4,{upgrade(db){db.createObjectStore('code_index',{keyPath:'key'});}});
 const value={path:'sample.js',content:'source '.repeat(100000),functions:Array.from({length:150},(_,i)=>'function'+i),unusedPayload:'PRIVATE_PAYLOAD '.repeat(100000)};
 const key='code:file:repo:sample.js';await writeRecord(unwrap(db),'code_index',key,value);
 const root=await db.get('code_index',key);const projected=await readSourceFileProjection(unwrap(db),'code_index',root.value);
 expect(projected.content).toHaveLength(4000);expect(projected.functions).toHaveLength(100);expect(projected.unusedPayload).toBeUndefined();db.close();
});

test('a committed Project hazard save refreshes its durable analysis, without scanning CBA hazards',async()=>{
 const db=await openDB('xhandle-project-hazard-analysis',1,{upgrade(db){db.createObjectStore('analyses',{keyPath:'projectId'});}});
 const row=updatedAt=>({projectId:'p',updatedAt,analysisResult:{Summary:[['Hazard'],[updatedAt]]}});
 await db.put('analyses',row('Before'));await force();await db.put('analyses',row('After'));
 window.dispatchEvent(new CustomEvent('xhandle:hazard-analysis-write',{detail:{ok:true,projectId:'p'}}));
 const result=await sync();expect(result.skippedSteps).toContain('indexedFeatureStores');
 expect((await listArtifacts({type:'hazard_analysis_row'}))[0].structuredData.row[0]).toBe('After');db.close();
});

test('report-save notifications refresh only report sources, and layout saves keep the index fresh',async()=>{
 await force();notifyBackupDataChanged({source:'generated-reports',projectId:'p'});
 const result=await sync();expect(result.skippedSteps).toContain('indexedFeatureStores');expect(result.skippedSteps).toContain('codeArchitecture');expect(result.skippedSteps).not.toContain('generatedReports');
 notifyBackupDataChanged({db:'xhandle',stores:['diagram_positions']});expect((await sync()).skipped).toBe(true);
});

test('attachment previews and recovery mirrors do not invalidate authoritative graph data',async()=>{
 localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'REQ-1',projectId:'p',title:'Before'}]));await force();
 for(const database of ['xhandle-collaborator-attachments','xhandle-recovery','TraceabilityMeta']){
  notifyBackupDataChanged({database});expect((await sync()).skipped).toBe(true);
 }
 // Ignoring mirror notifications must never hide a real authoritative change.
 localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'REQ-1',projectId:'p',title:'After'}]));
 notifyBackupDataChanged({database:'xhandle-recovery'});expect((await sync()).skipped).not.toBe(true);
 expect((await listArtifacts({type:'requirement'}))[0].title).toBe('After');
});

test('explicit repository reads retain global records without project ownership',async()=>{
 const {upsertRun,listRuns,upsertRelationship,listRelationships}=require('./workspaceGraphRepository');
 await upsertRun({id:'global-run',type:'analysis',title:'Global run',createdAt:'2026-11-04',updatedAt:'2026-11-04'});
 await upsertArtifacts([{id:'global-artifact',type:'note',title:'Global',createdAt:'2026-11-04',updatedAt:'2026-11-04'}]);
 await upsertRelationship({id:'global-link',type:'references',fromArtifactId:'global-artifact',toArtifactId:'target',createdAt:'2026-11-04',updatedAt:'2026-11-04'});
 expect(await listArtifacts({projectId:'p'})).toHaveLength(1);expect(await listRuns('p')).toHaveLength(1);expect(await listRelationships({projectId:'p'})).toHaveLength(1);
});

test('legacy projection initialization counts the body store once across index batches and still repairs missing rows',async()=>{
 const {openWorkspaceGraphDB}=require('./workspaceGraphDb');
 const {ensureWorkspaceProjection}=require('./workspaceGraphQueries');
 const db=await openWorkspaceGraphDB();
 await db.put('artifacts',{id:'legacy-unindexed',projectId:'p',type:'note',title:'Legacy evidence',content:'Retained original',createdAt:'2026-11-05',updatedAt:'2026-11-05'});
 db.close();
 const count=IDBObjectStore.prototype.count;let artifactCounts=0;
 const spy=jest.spyOn(IDBObjectStore.prototype,'count').mockImplementation(function(...args){if(this.name==='artifacts')artifactCounts++;return count.apply(this,args);});
 for(let i=0;i<3;i++)await upsertArtifacts([{id:'new-'+i,projectId:'p',type:'note',title:'New '+i,createdAt:'2026-11-05',updatedAt:'2026-11-05'}]);
 expect(artifactCounts).toBe(1);spy.mockRestore();
 const before=await openWorkspaceGraphDB();expect((await before.get('workspaces','artifact-projection-v1')).complete).toBe(false);before.close();
 await ensureWorkspaceProjection();
 const results=await queryWorkspaceCandidates('Legacy evidence',{projectId:'p'});
 expect(results.rows.some(row=>row.id==='legacy-unindexed')).toBe(true);
 expect((await getArtifact('legacy-unindexed')).content).toBe('Retained original');
});

test('an already-fresh pass never traverses project records for an empty reconciliation scope',async()=>{
 const {reconcileWorkspaceGraphSources}=require('./workspaceGraphRepository');
 const {IDBIndex}=require('fake-indexeddb');
 const cursor=jest.spyOn(IDBIndex.prototype,'openKeyCursor').mockImplementation(()=>{throw Error('Unnecessary reconciliation scan');});
 expect(await reconcileWorkspaceGraphSources({sourceStores:new Set(),ids:{},projectIds:['large']})).toBe(0);
 expect(cursor).not.toHaveBeenCalled();
});

test('scoped repair yields after 64 records, leaves no transaction open while paused, and resumes completely',async()=>{
 const {openWorkspaceGraphDB}=require('./workspaceGraphDb');
 const {ensureWorkspaceProjection}=require('./workspaceGraphQueries');
 const {acquireForegroundStoragePriority}=require('../../lib/foregroundStoragePriority');
 const db=await openWorkspaceGraphDB();
 for(let i=0;i<145;i++)await db.put('artifacts',{id:'legacy-'+String(i).padStart(3,'0'),projectId:i<130?'p':'other',type:'note',content:'Original '+i,title:'Evidence '+i});
 let release:()=>void=()=>{},notify:()=>void=()=>{};
 const paused=new Promise<void>(resolve=>{notify=resolve;});let writes=0;
 const put=IDBObjectStore.prototype.put;
 jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(...args){
  const result=put.apply(this,args);
  if(this.name==='artifactIndex'&&++writes===64){release=acquireForegroundStoragePriority();notify();}
  return result;
 });
 let complete=false;const repair=ensureWorkspaceProjection(undefined,['p']).then(()=>{complete=true;});
 try{
  await paused;
  // Queued after the current batch. Resolving proves that the paused pass
  // holds no write transaction across the wait.
  await db.put('artifactIndex',{id:'unrelated',projectId:'other',readableBody:false});
  expect(complete).toBe(false);expect(await db.countFromIndex('artifactIndex','by_project','p')).toBe(64);
 }finally{release();}
 await repair;
 expect(await db.countFromIndex('artifactIndex','by_project','p')).toBe(130);
 expect(await db.countFromIndex('artifactIndex','by_project','other')).toBe(1);
 expect(await db.get('artifacts','legacy-129')).toMatchObject({content:'Original 129'});
 expect(await db.get('artifactIndex','legacy-129')).toMatchObject({readableBody:true});
 expect(await db.get('workspaces','artifact-projection-project:p')).toMatchObject({complete:true});db.close();
});
