import { describeStorageItem, readStoragePage } from './storageCategoryItems';
const projectId = '12d76b3e-adf3-4fee-a67c-80ce05dd57bb';
const repoId = 'babf3e1b-134b-4f1a-8003-aec6e2c81a45';
const key = `cba:${projectId}:${repoId}`;
const context = {projects:[{id:projectId,name:'Vulnerable App',repos:[{id:repoId,owner:'SasanLabs',repo:'VulnerableApp'}]}], category:'Code architecture analysis'};
test('chunked decomposition gets a project and repository label without hydrating it', () => {
  expect(describeStorageItem(key,{value:{format:'xhandle-json-tree-v1'}},context)).toEqual({key,label:'Vulnerable App — Functional decomposition',detail:'SasanLabs/VulnerableApp'});
});
test('distinguishes run details and checkpoints without showing hashes', () => {
  expect(describeStorageItem(`${key}:metadata`,{},context).label).toContain('Analysis details');
  const result=describeStorageItem(`${key}:run:abc123`,{value:{publishedAt:'2026-10-08T12:00:00Z'}},context);
  expect(result.label).toBe('Vulnerable App — Saved analysis checkpoint');
  expect(result.detail).toContain('Saved ');
  expect(result.detail).not.toContain(repoId);
});
test('removed projects can use sibling repository metadata; unknown items use neutral names', () => {
  expect(describeStorageItem(key,{}, {},{repoName:'SasanLabs/VulnerableApp'}).label).toBe('SasanLabs/VulnerableApp — Functional decomposition');
  expect(describeStorageItem(projectId,{projectId},{category:'Hazard analyses',ordinal:3})).toEqual({key:projectId,label:'Hazard analyses — saved item 3',detail:''});
});

// Deliberately forbid value access: even a single legacy row can be enormous.
function pageFixture() {
  const request={};
  const store={openKeyCursor:jest.fn(()=>request),get:()=>{throw new Error('No payload reads');}};
  const tx={objectStore:()=>store,abort:jest.fn()};
  const db={transaction:()=>tx};
  return {request,store,tx,db};
}
test('key-only pages skip chunks and preserve the continuation key',async()=>{
  const f=pageFixture();const result=readStoragePage(f.db,'rows',undefined,2,context);
  for(const key of ['a','a:$part:0','b','c']) {
    f.request.result={primaryKey:key,get value(){throw new Error('Read payload');},continue:jest.fn()};
    f.request.onsuccess();
  }
  f.tx.oncomplete();
  expect(await result).toMatchObject({items:[{key:'a'},{key:'b'}],nextKey:'b'});
});
test('cancelled listing ignores queued cursor callbacks',async()=>{
  const f=pageFixture(),controller=new AbortController();
  const result=readStoragePage(f.db,'rows',undefined,50,{signal:controller.signal});
  const rejection=expect(result).rejects.toThrow('cancelled');
  controller.abort();
  const advance=jest.fn();f.request.result={primaryKey:'late',continue:advance};f.request.onsuccess();f.tx.oncomplete();
  await rejection;expect(advance).not.toHaveBeenCalled();expect(f.tx.abort).toHaveBeenCalledTimes(1);
});
test('listing timeout aborts pending reads',async()=>{
  jest.useFakeTimers();
  try {
    const f=pageFixture();const result=readStoragePage(f.db,'rows');
    const rejection=expect(result).rejects.toThrow('timed out');jest.advanceTimersByTime(5000);
    await rejection;expect(f.tx.abort).toHaveBeenCalledTimes(1);
  } finally {jest.useRealTimers();}
});
