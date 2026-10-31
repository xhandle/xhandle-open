import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { openDB } from 'idb';
import { permanentlyDeleteStoredProject } from './permanentlyDeleteStoredProject';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
  localStorage.clear();
});

test('permanently deletes a retained project with absent optional databases', async () => {
  const db = await openDB('xhandle-workspace-graph', 1, {upgrade(db) {
    db.createObjectStore('projects', {keyPath:'id'});
    db.createObjectStore('artifacts', {keyPath:'id'});
  }});
  await db.put('projects', {id:'p1'});
  await db.put('projects', {id:'p2'});
  await db.put('artifacts', {id:'a1',projectId:'p1'});
  db.close();
  await permanentlyDeleteStoredProject({id:'p1',workspaceType:'code-architecture',active:false});
  const reopened = await openDB('xhandle-workspace-graph');
  expect(await reopened.get('projects','p1')).toBeUndefined();
  expect(await reopened.get('projects','p2')).toEqual({id:'p2'});
  expect(await reopened.getAll('artifacts')).toEqual([]);
  reopened.close();
});

test('deletes chunked analysis without hydrating stores whose keys encode ownership', async () => {
  const architecture = await openDB('xhandle', 1, {upgrade(db) {
    db.createObjectStore('copilot_baseline', {keyPath:'key'});
    db.createObjectStore('code_index', {keyPath:'key'});
  }});
  await architecture.put('copilot_baseline', {key:'cba:p1:repo',value:{rows:[1]}});
  await architecture.put('copilot_baseline', {key:'cba:p1:repo:$part:0',value:{rows:[1]}});
  await architecture.put('copilot_baseline', {key:'cba:p2:repo',value:{rows:[2]}});
  await architecture.put('code_index', {key:'shared-source'});
  architecture.close();
  const hazard = await openDB('xhandle-code-architecture-hazard-analysis', 1, {upgrade(db) {
    db.createObjectStore('hazardAnalysisRuns', {keyPath:'id'}).createIndex('projectId','projectId');
  }});
  await hazard.put('hazardAnalysisRuns', {id:'run1',projectId:'p1',payload:[1]});
  await hazard.put('hazardAnalysisRuns', {id:'run2',projectId:'p2',payload:[2]});
  hazard.close();
  const { IDBObjectStore } = require('fake-indexeddb');
  const originalGet=IDBObjectStore.prototype.get;
  const get=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key) {
    if (['copilot_baseline','code_index','diagram_positions','checkpoints','artifactRows'].includes(this.name)) throw new Error('Hydrated a key-owned payload');
    return originalGet.call(this,key);
  });
  const storeCursor = jest.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(() => {throw new Error('Payload read during cleanup');});
  try {
    await permanentlyDeleteStoredProject({id:'p1',workspaceType:'code-architecture',active:false});
  } finally {storeCursor.mockRestore();get.mockRestore();}
  const remaining = await openDB('xhandle');
  expect((await remaining.getAllKeys('copilot_baseline'))).toEqual(['cba:p2:repo']);
  expect(await remaining.getAllKeys('code_index')).toEqual(['shared-source']);
  remaining.close();
  const remainingHazards = await openDB('xhandle-code-architecture-hazard-analysis');
  expect(await remainingHazards.getAllKeys('hazardAnalysisRuns')).toEqual(['run2']);
  remainingHazards.close();
});

test('removes retained projects whose legacy IDs are numbers', async () => {
  const db = await openDB('xhandle-workspace-graph', 2, {upgrade(db) {
    db.createObjectStore('projects', {keyPath:'id'});
    db.createObjectStore('artifacts', {keyPath:'id'}).createIndex('by_project','projectId');
  }});
  await db.put('projects', {id:123,sourceStore:'localStorage:xhandle.projects'});
  await db.put('artifacts', {id:'a',projectId:123});
  db.close();
  await permanentlyDeleteStoredProject({id:123,workspaceType:'functional',active:false});
  const reopened = await openDB('xhandle-workspace-graph');
  expect(await reopened.getAll('projects')).toEqual([]);
  expect(await reopened.getAll('artifacts')).toEqual([]);
  reopened.close();
});

test('exact owned keys are cleaned despite incomplete indexes and conflicting payload ownership', async () => {
  const db = await openDB('xhandle-results-review', 1, {upgrade(db) {
    db.createObjectStore('rows', {keyPath:'key'}).createIndex('projectId','projectId');
  }});
  await db.put('rows', {key:'cba:p1:repo:chunk:0'});
  await db.put('rows', {key:'cba:p1:repo',projectId:'p2'});
  await db.put('rows', {key:'other',projectId:'p1'});
  await db.put('rows', {key:'keep',projectId:'p2'});
  db.close();
  await permanentlyDeleteStoredProject({id:'p1',workspaceType:'code-architecture',active:false});
  const reopened = await openDB('xhandle-results-review');
  expect(await reopened.getAllKeys('rows')).toEqual(['keep']);
  reopened.close();
});

test('failed prerequisite preserves retained row and identifies corrupt storage for retry', async () => {
  const db = await openDB('xhandle-workspace-graph', 1, {upgrade(db) {db.createObjectStore('projects',{keyPath:'id'});}});
  await db.put('projects',{id:'p1'});
  localStorage.setItem('xhandle:results-review:items','invalid JSON');
  await expect(permanentlyDeleteStoredProject({id:'p1',workspaceType:'code-architecture'})).rejects.toThrow(/xhandle:results-review:items/);
  expect(await db.get('projects','p1')).toEqual({id:'p1'});
  localStorage.setItem('xhandle:results-review:items','[]');
  await permanentlyDeleteStoredProject({id:'p1',workspaceType:'code-architecture'});
  expect(await db.get('projects','p1')).toBeUndefined();
  db.close();
});

test('cursor callback failure aborts cleanup and preserves the retained row for retry', async () => {
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'cursor-project'});
  const db=await openDB('xhandle',1,{upgrade(db){db.createObjectStore('copilot_baseline',{keyPath:'key'});}});
  await db.put('copilot_baseline',{key:'cba:cursor-project:repo',value:[]});
  db.close();
  const {IDBCursor}=require('fake-indexeddb');
  const cursor=jest.spyOn(IDBCursor.prototype,'continue').mockImplementationOnce(()=>{throw new Error('Synthetic cursor failure');});
  try {
    await expect(permanentlyDeleteStoredProject({id:'cursor-project',workspaceType:'code-architecture'})).rejects.toThrow(/xhandle.*copilot_baseline.*Synthetic cursor failure/);
    expect(await graph.get('projects','cursor-project')).toBeDefined();
  } finally {cursor.mockRestore();}
  await permanentlyDeleteStoredProject({id:'cursor-project',workspaceType:'code-architecture'});
  expect(await graph.get('projects','cursor-project')).toBeUndefined();
  graph.close();
});

test('database connection failure names the database, keeps the row and permits retry', async () => {
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'failed-open'});
  const original=indexedDB.open.bind(indexedDB);
  const open=jest.spyOn(indexedDB,'open').mockImplementation((name,...args)=>{
    if(name==='xhandle-results-review') throw new Error('Synthetic connection denied');
    return original(name,...args);
  });
  try {
    await expect(permanentlyDeleteStoredProject({id:'failed-open',workspaceType:'code-architecture'})).rejects.toThrow(/xhandle-results-review.*Synthetic connection denied/);
    expect(await graph.get('projects','failed-open')).toBeDefined();
  } finally {open.mockRestore();}
  await permanentlyDeleteStoredProject({id:'failed-open',workspaceType:'code-architecture'});
  expect(await graph.get('projects','failed-open')).toBeUndefined();
  graph.close();
});

test('drains queued artifact writes and blocks late writes after successful deletion', async () => {
  const {saveArtifactRowsAsync}=require('../features/code-architecture-assurance/artifactUtils');
  const pending=saveArtifactRowsAsync('software','queued-project','repo',[{id:'owned'}]);
  await permanentlyDeleteStoredProject({id:'queued-project',workspaceType:'code-architecture'});
  await pending;
  const artifacts=await openDB('xhandle-code-architecture-assurance');
  expect(await artifacts.getAllKeys('artifactRows')).toEqual([]);
  expect(localStorage.getItem('xhandle:cba-software:queued-project:repo')).toBeNull();
  await expect(saveArtifactRowsAsync('software','queued-project','repo',[])).rejects.toThrow(/discarded/);
  await saveArtifactRowsAsync('software','unrelated-project','repo',[{id:'keep'}]);
  expect(await artifacts.getAllKeys('artifactRows')).toContain('xhandle:cba-software:unrelated-project:repo');
  artifacts.close();
});

test('waits for an in-flight graph migration before deleting its retained snapshot', async () => {
  const {withWorkspaceGraphMigrationPaused}=require('../features/workspace-graph/legacyWorkspaceGraphMigrator');
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  let release;
  const ready=new Promise(resolve=>{release=resolve;});
  const migration=withWorkspaceGraphMigrationPaused(async()=>{
    await ready;
    await graph.put('projects',{id:'migration-project'});
  });
  const deletion=permanentlyDeleteStoredProject({id:'migration-project',workspaceType:'code-architecture'});
  release();
  await migration;
  await deletion;
  expect(await graph.get('projects','migration-project')).toBeUndefined();
  graph.close();
});

test('drains recovery queued before its database exists and retains other project checkpoints', async () => {
  const {saveRecoveryRecord}=require('../lib/durableRecovery');
  const pending=saveRecoveryRecord('decomposition:queued-recovery',{rows:[1]});
  await saveRecoveryRecord('decomposition:other-recovery',{rows:[2]});
  await permanentlyDeleteStoredProject({id:'queued-recovery',workspaceType:'functional'});
  await pending;
  const db=await openDB('xhandle-recovery');
  expect(await db.get('checkpoints','decomposition:queued-recovery')).toBeUndefined();
  expect(await db.get('checkpoints','decomposition:other-recovery')).toEqual({rows:[2]});
  await expect(saveRecoveryRecord('decomposition:queued-recovery',{})).rejects.toThrow(/discarded/);
  db.close();
});

test('a timed-out migration wait never starts delayed cleanup', async () => {
  const {withWorkspaceGraphMigrationPaused}=require('../features/workspace-graph/legacyWorkspaceGraphMigrator');
  let release;
  const busy=withWorkspaceGraphMigrationPaused(()=>new Promise(resolve=>{release=resolve;}));
  await Promise.resolve();
  const cleanup=jest.fn(async()=>{});
  await expect(withWorkspaceGraphMigrationPaused(cleanup,5)).rejects.toThrow(/migration is still busy/);
  release();
  await busy;
  await withWorkspaceGraphMigrationPaused(async()=>{});
  expect(cleanup).not.toHaveBeenCalled();
});

test('a timed-out database open closes a late connection without starting deletion', async () => {
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'open-timeout'});
  let opened;
  const opening=new Promise(resolve=>{opened=resolve;});
  const lateDb={close:jest.fn(),transaction:jest.fn()};
  const request={result:lateDb};
  const original=indexedDB.open.bind(indexedDB);
  const open=jest.spyOn(indexedDB,'open').mockImplementation((name,...args)=>{
    if(name==='xhandle') {opened();return request;}
    return original(name,...args);
  });
  jest.useFakeTimers();
  try {
    const deletion=permanentlyDeleteStoredProject({id:'open-timeout',workspaceType:'code-architecture'});
    const rejected=expect(deletion).rejects.toThrow(/xhandle.*timed out/);
    await opening;
    jest.advanceTimersByTime(10000);
    await rejected;
    request.onsuccess();
    expect(lateDb.close).toHaveBeenCalled();
    expect(lateDb.transaction).not.toHaveBeenCalled();
  } finally {jest.useRealTimers();open.mockRestore();}
  expect(await graph.get('projects','open-timeout')).toBeDefined();
  await permanentlyDeleteStoredProject({id:'open-timeout',workspaceType:'code-architecture'});
  expect(await graph.get('projects','open-timeout')).toBeUndefined();
  graph.close();
});

test('does not report success if a completed graph transaction leaves the project persisted', async () => {
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'retained-after-transaction'});
  const {IDBObjectStore}=require('fake-indexeddb');
  const originalDelete=IDBObjectStore.prototype.delete;
  const remove=jest.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(key) {
    // Simulate a missed deletion while still allowing the transaction to finish.
    if(this.name==='projects' && key==='retained-after-transaction') return this.get(key);
    return originalDelete.call(this,key);
  });
  try {
    await expect(permanentlyDeleteStoredProject({id:'retained-after-transaction',workspaceType:'functional'})).rejects.toThrow(/retained project still exists/);
    expect(await graph.get('projects','retained-after-transaction')).toBeDefined();
  } finally {remove.mockRestore();}
  await permanentlyDeleteStoredProject({id:'retained-after-transaction',workspaceType:'functional'});
  expect(await graph.get('projects','retained-after-transaction')).toBeUndefined();
  graph.close();
});

test('reports completed cleanup stages and finishes only after persisted deletion is verified', async () => {
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'progress'});
  const updates=[];
  await permanentlyDeleteStoredProject({id:'progress',workspaceType:'functional'}, {onProgress: update=>updates.push(update)});
  expect(updates[0]).toMatchObject({completed:0,label:'Waiting for current workspace updates'});
  expect(updates.some(update=>update.label==='Deleting the retained project record')).toBe(true);
  expect(updates[updates.length-1]).toMatchObject({label:'Verifying permanent deletion'});
  expect(updates[updates.length-1].completed).toBe(updates[updates.length-1].total);
  expect(updates.every((update,index)=>index===0 || update.completed>=updates[index-1].completed)).toBe(true);
  expect(await graph.get('projects','progress')).toBeUndefined();
  graph.close();
});

test('failed cleanup leaves progress incomplete and retains the project for retry', async () => {
  const graph=await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'progress-failure'});
  localStorage.setItem('xhandle.projectData','invalid');
  const updates=[];
  await expect(permanentlyDeleteStoredProject({id:'progress-failure',workspaceType:'functional'}, {onProgress:update=>updates.push(update)})).rejects.toThrow(/invalid JSON/);
  const last=updates[updates.length-1];
  expect(last.label).toBe('Deleting project settings and local records');
  expect(last.completed).toBeLessThan(last.total);
  expect(await graph.get('projects','progress-failure')).toBeDefined();
  graph.close();
});

test('same numeric/string ID retained in another workspace prevents all destructive cleanup', async () => {
  const graph = await openDB('xhandle-workspace-graph', 1, {upgrade(db) {db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects', {id:'123',sourceStore:'localStorage:xhandle.codeArchitectureProjects'});
  await graph.put('projects', {id:123,sourceStore:'localStorage:xhandle.projects'});
  localStorage.setItem('cba:123:repo','keep');
  await expect(permanentlyDeleteStoredProject({id:'123',workspaceType:'code-architecture'})).rejects.toThrow(/different workspace/);
  expect(await graph.count('projects')).toBe(2);
  expect(localStorage.getItem('cba:123:repo')).toBe('keep');
  graph.close();
});

test('failed repeat cleanup cannot release guards installed by completed deletion', async () => {
  const {saveArtifactRowsAsync} = require('../features/code-architecture-assurance/artifactUtils');
  const project = {id:'guard-repeat',workspaceType:'code-architecture'};
  await permanentlyDeleteStoredProject(project);
  localStorage.setItem('xhandle:results-review:items','invalid');
  await expect(permanentlyDeleteStoredProject(project)).rejects.toThrow(/invalid JSON/);
  await expect(saveArtifactRowsAsync('software',project.id,'repo',[])).rejects.toThrow(/discarded/);
});

test('ambiguous colon-delimited project namespaces preserve another retained project and its artifacts', async () => {
  const graph = await openDB('xhandle-workspace-graph',1,{upgrade(db){db.createObjectStore('projects',{keyPath:'id'});}});
  await graph.put('projects',{id:'prefix',sourceStore:'localStorage:xhandle.projects'});
  await graph.put('projects',{id:'prefix:nested',sourceStore:'localStorage:xhandle.projects'});
  localStorage.setItem('cba:prefix:nested:repo','keep');
  await expect(permanentlyDeleteStoredProject({id:'prefix',workspaceType:'functional'})).rejects.toThrow(/ambiguous/i);
  expect(localStorage.getItem('cba:prefix:nested:repo')).toBe('keep');
  expect(await graph.count('projects')).toBe(2);
  graph.close();
});
