import { describeStorageItem } from './storageCategoryItems';
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
