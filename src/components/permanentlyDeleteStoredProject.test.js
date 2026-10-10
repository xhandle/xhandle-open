import { assertRemovedProject, deleteProjectLocalRecords, projectOwnsRecord, projectOwnsStorageKey, permanentlyDeleteStoredProject } from './permanentlyDeleteStoredProject';

beforeEach(()=>localStorage.clear());
const project={id:'p1',workspaceType:'code-architecture',active:false};
it('requires a removed project and rechecks both active workspace lists',async()=>{
  expect(()=>assertRemovedProject(project)).not.toThrow();
  for (const key of ['xhandle.projects','xhandle.codeArchitectureProjects']) {
    localStorage.setItem(key,JSON.stringify([{id:'p1'}]));
    await expect(permanentlyDeleteStoredProject(project)).rejects.toThrow(/active/);
    localStorage.removeItem(key);
  }
  expect(()=>assertRemovedProject({...project,active:true})).toThrow(/removed/);
  expect(()=>assertRemovedProject({...project,id:''})).toThrow(/Invalid/);
  localStorage.setItem('xhandle.projects','{}');
  expect(()=>assertRemovedProject(project)).toThrow(/verify/);
});
it('matches project key boundaries without matching another project or shared repository',()=>{
  for (const key of ['cba:p1:repo','cba:p1:repo:run:hash','cba:p1:repo:functional-work:hash','functional-decomposition-checkpoint:cba:p1:repo:hash','cbaMeta:p1:repo','diagram:positions:p1:nodes','diagram:github:p1:repo:main','xhandle:cba-software:p1:repo:chunk:0','xhandle:code-architecture-hazard-contexts:v1:p1:repo','hazard-run:p1']) expect(projectOwnsStorageKey(key,'p1')).toBe(true);
  for (const key of ['cba:p10:repo','cba:p1-extra:repo','cba:owner/repo','code-index:owner/repo:p1','githubToken','xhandle.apiKey','diagram:positions:p10','unrelated:p1']) expect(projectOwnsStorageKey(key,'p1')).toBe(false);
});
it('uses ownership, never names, descriptions or incidental mentions',()=>{
  expect(projectOwnsRecord('random',{projectId:'p1'},'p1','db','rows')).toBe(true);
  expect(projectOwnsRecord('random',{value:{projectId:'p1'}},'p1','db','rows')).toBe(true);
  expect(projectOwnsRecord('cba:p1:repo',{projectId:'p2'},'p1','db','rows')).toBe(false);
  expect(projectOwnsRecord('random',{description:'p1',repoId:'p1'},'p1','db','rows')).toBe(false);
  expect(projectOwnsRecord('p1',{id:'p1'},'p1','xhandle-workspace-graph','projects')).toBe(true);
  expect(projectOwnsRecord('p1',{id:'p1'},'p1','xhandle-workspace-graph','folders')).toBe(false);
});
it('cleans project-specific local data and shared fallback entries without clearing other projects or credentials',()=>{
  localStorage.setItem('xhandle.projectData',JSON.stringify({p1:{rows:[1]},p2:{rows:[2]}}));
  localStorage.setItem('cbaMeta:p1:repo','delete');
  localStorage.setItem('cbaMeta:p10:repo','keep');
  localStorage.setItem('githubToken','secret');
  localStorage.setItem('xhandle:results-review:items',JSON.stringify([{id:'a',projectId:'p1'},{id:'b',projectId:'p2'}]));
  localStorage.setItem('xhandle:safety-remediation:v1',JSON.stringify({safetyFindings:[{projectId:'p1'},{projectId:'p2'}],other:'keep'}));
  deleteProjectLocalRecords('p1');
  expect(JSON.parse(localStorage.getItem('xhandle.projectData'))).toEqual({p2:{rows:[2]}});
  expect(localStorage.getItem('cbaMeta:p1:repo')).toBeNull();
  expect(localStorage.getItem('cbaMeta:p10:repo')).toBe('keep');
  expect(localStorage.getItem('githubToken')).toBe('secret');
  expect(JSON.parse(localStorage.getItem('xhandle:results-review:items'))).toEqual([{id:'b',projectId:'p2'}]);
  expect(JSON.parse(localStorage.getItem('xhandle:safety-remediation:v1'))).toEqual({safetyFindings:[{projectId:'p2'}],other:'keep'});
  expect(deleteProjectLocalRecords('p1')).toBe(0);
});
