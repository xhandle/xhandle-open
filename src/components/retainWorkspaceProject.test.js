import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import * as graphDb from '../features/workspace-graph/workspaceGraphDb';
import { retainWorkspaceProject, persistWorkspaceProjectRemoval } from './retainWorkspaceProject';
import { listProjects } from '../features/workspace-graph/workspaceGraphRepository';
import { classifyStoredWorkspaceProjects } from './storageWorkspaceVisibility';

beforeEach(() => {
  jest.restoreAllMocks();
  global.indexedDB = new IDBFactory();
  global.structuredClone = value => deserialize(serialize(value));
});
const key = 'xhandle.codeArchitectureProjects';
test('fresh graph retains exact current repository settings without migration', async () => {
  const project = {id:'fresh',name:'Latest edit',repos:[{id:'repo',branch:'custom',settings:{mode:'local'}}]};
  expect(classifyStoredWorkspaceProjects([], [], [project])).toEqual([expect.objectContaining({active:true})]);
  await retainWorkspaceProject(project, key);
  const rows = classifyStoredWorkspaceProjects(await listProjects());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({active:false,recoverable:true,sourceData:project});
});
test('retention failure rejects before caller removes active registry', async () => {
  const project = {id:'same',name:'Functional'};
  await retainWorkspaceProject(project, 'xhandle.projects');
  const remove = jest.fn();
  await expect(retainWorkspaceProject({...project,name:'Code'}, key).then(remove)).rejects.toThrow('different workspace');
  expect(remove).not.toHaveBeenCalled();
  expect((await listProjects())[0].sourceData).toEqual(project);
});
test('authoritative registries merge by type and exact ID; current data wins', () => {
  const rows = classifyStoredWorkspaceProjects([{id:'x',name:'stale',sourceStore:`localStorage:${key}`}], [{id:'x',name:'Functional'}], [{id:'x',name:'Code'}]);
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.active && !row.recoverable)).toBe(true);
  expect(rows.map(row=>row.name).sort()).toEqual(['Code','Functional']);
});
test('a failed durable put leaves the caller active and creates no retained row', async () => {
  const put = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Synthetic quota failure'); });
  const remove = jest.fn();
  try {
    await expect(retainWorkspaceProject({id:'failed',name:'Keep active'}, key).then(remove)).rejects.toThrow('Synthetic quota failure');
    expect(remove).not.toHaveBeenCalled();
  } finally { put.mockRestore(); }
  expect(await listProjects()).toEqual([]);
});

test.each([null, {}, {id:''}, {id:NaN}, {id:{} }])('invalid snapshot is rejected before opening storage: %p', async project => {
  const open = jest.spyOn(indexedDB, 'open');
  await expect(Promise.resolve().then(() => retainWorkspaceProject(project, key))).rejects.toThrow('Invalid project');
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

test('blocked retention times out and closes a late connection without writing', async () => {
  jest.useFakeTimers();
  let resolveOpen;
  const open = jest.spyOn(graphDb, 'openWorkspaceGraphDB').mockReturnValue(new Promise(resolve => { resolveOpen = resolve; }));
  const result = retainWorkspaceProject({id:'late'}, key);
  const rejected = expect(result).rejects.toThrow(/timed out|blocked/i);
  await Promise.resolve(); await Promise.resolve();
  jest.advanceTimersByTime(10001);
  await rejected;
  const db = {close:jest.fn(), transaction:jest.fn()};
  resolveOpen(db);
  await Promise.resolve();
  expect(db.close).toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  open.mockRestore(); jest.useRealTimers();
});

test('removal refuses a newer project object and preserves registry on write failure', () => {
  const project = {id:'p',name:'Original'};
  const storage = {setItem:jest.fn(() => {throw new Error('quota');})};
  expect(() => persistWorkspaceProjectRemoval(project, [{...project,name:'Edited'}], key, storage)).toThrow(/changed/);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(() => persistWorkspaceProjectRemoval(project, [project], key, storage)).toThrow('quota');
});

test('string ID cannot overwrite or duplicate a numeric retained ID owned by another workspace', async () => {
  const db = await graphDb.openWorkspaceGraphDB();
  await db.put('projects', {id:123,sourceStore:'localStorage:xhandle.projects',sourceData:{id:123}});
  db.close();
  await expect(retainWorkspaceProject({id:'123'}, key)).rejects.toThrow(/different workspace/);
  expect(await listProjects()).toHaveLength(1);
});
