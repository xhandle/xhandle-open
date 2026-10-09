import { reconcileStorageCleanup } from './storageCleanupWorkspace';
const item={dbName:'xhandle',storeName:'copilot_baseline'};
const key='xhandle.codeArchitectureProjects';
const projects=[{id:'a',activeRepoId:'r1',repos:[{id:'r1'},{id:'r2'}]},{id:'b',repos:[{id:'r3'}]}];
beforeEach(()=>localStorage.setItem(key,JSON.stringify(projects)));
const read=()=>JSON.parse(localStorage.getItem(key));
test('category deletion removes all architecture workspace entries',()=>{
 reconcileStorageCleanup(item,null);expect(read()).toEqual([]);
});
test('root deletion removes only the selected repository and chooses remaining active repository',()=>{
 reconcileStorageCleanup(item,['cba:a:r1']);
 expect(read()).toEqual([{...projects[0],activeRepoId:'r2',repos:[{id:'r2'}]},projects[1]]);
 reconcileStorageCleanup(item,['cba:a:r2']);expect(read()).toEqual([projects[1]]);
});
test('metadata, runs and layouts do not remove workspace projects',()=>{
 reconcileStorageCleanup(item,['cba:a:r1:metadata','cba:a:r1:run:hash']);expect(read()).toEqual(projects);
 reconcileStorageCleanup({dbName:'xhandle',storeName:'diagram_positions'},null);expect(read()).toEqual(projects);
});
test('deleting the local workspace registry leaves an explicit empty list to suppress legacy migration',()=>{
 localStorage.removeItem(key);
 reconcileStorageCleanup({kind:'localStorage',keys:[key]},null);
 expect(read()).toEqual([]);
});
