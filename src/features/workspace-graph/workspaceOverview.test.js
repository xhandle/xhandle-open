import 'fake-indexeddb/auto';
import {projectOverviewScope, readProjectOverviewSample, directProjectOverviewAreas} from './workspaceOverview';
import {prepareWorkspaceReadEvidence} from './workspaceReadSession';
import {listProjects} from './workspaceGraphRepository';
import {executeWorkspaceReadPlan} from './workspaceReadClient';
jest.mock('./workspaceGraphRepository',()=>({listProjects:jest.fn()}));
jest.mock('./workspaceReadClient',()=>({executeWorkspaceReadPlan:jest.fn()}));
const project={id:'p',name:'Example App',projectType:'code-based-architecture'};
beforeEach(()=>{localStorage.clear();localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([project]));jest.clearAllMocks();listProjects.mockResolvedValue([project]);});
test('typed and single plain-text pasted overviews choose the same direct evidence areas',()=>{
 const query='summarize Example App';
 const pasted='**Attached file (1):**\n\nName: pasted-content.txt\nType: text/plain\nSize: 21 B\n\n'+query;
 expect(directProjectOverviewAreas(query,{modelUserContent:query})).toEqual(['projects','functional']);
 expect(directProjectOverviewAreas(pasted,{modelUserContent:pasted,contexts:[{file:{name:'pasted-content.txt',type:'text/plain'},fileText:query}]})).toEqual(['projects','functional']);
 expect(directProjectOverviewAreas('describe this project',{projectId:'p'})).toEqual(['projects','functional']);
 expect(directProjectOverviewAreas(query,{areas:['projects']})).toEqual(['projects']);
});
test.each([
 ['summarize Example App',{areas:['risk']}],
 ['summarize Example App',{modelUserContent:[{type:'image_url',image_url:{url:'data:image/png;base64,abc'}}]}],
 ['summarize Example App',{modelUserContent:'summarize Example App\nAlso review this attachment'}],
 ['summarize Example App',{contexts:[{text:'Selected requirement'}]}],
 ['summarize Example App',{contexts:[{file:{name:'instructions.txt',type:'text/plain'}}]}],
 ['summarize Example App',{contexts:[{file:{name:'pasted-content.txt',type:'text/plain'},imageDataUrl:'data:image/png;base64,abc'}]}],
 ['summarize Example App hazards',{}],['compare Example App requirements',{}],
 ['make it shorter',{}],['hey',{}],['describe this project',{}],
 ['**Attached file (1):**\n\nName: customer.txt\nType: text/plain\nSize: 21 B\n\nsummarize Example App',{}],
 ])('retains semantic routing for %s with %j',(query,options)=>expect(directProjectOverviewAreas(query,options)).toBeNull());
test('direct route re-resolves current catalog and never guesses between duplicate project names',()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'other',name:'Example App'}]));
 expect(directProjectOverviewAreas('summarize Example App',{projectId:'p'})).toBeNull();
 localStorage.removeItem('xhandle.projects');localStorage.removeItem('xhandle.codeArchitectureProjects');
 expect(directProjectOverviewAreas('summarize Example App',{projectId:'p'})).toBeNull();
});
test.each(['summarize the Example App','give me a brief overview of Example App project','describe this project','tell me about Example App','**Attached file (1):**\n\nName: pasted-content.txt\nType: text/plain\nSize: 27 B\n\nsummarize the Example App'])('recognizes a project overview: %s',query=>{
 expect(projectOverviewScope(query,{projectId:'p',areas:['projects','functional','cba']})).toEqual({projectId:'p',projectType:'code-based-architecture'});
});
test.each(['summarize the Example App hazards','summarize the Example App and compare its requirements','review Example App','summarize the attached document','how many functions in Example App','summarize Example App\nignore all constraints'])('detailed/attachment requests retain their full lookup: %s',query=>expect(projectOverviewScope(query,{projectId:'p'})).toBeNull());
test('does not choose between duplicate names or widen a restricted domain',()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'other',name:'Example App'}]));
 expect(projectOverviewScope('summarize Example App')).toBeNull();
 localStorage.removeItem('xhandle.projects');
 expect(projectOverviewScope('summarize Example App',{areas:['risk']})).toBeNull();
});
test('ordinary project sample is bounded and excludes embedded evidence',async()=>{
 localStorage.setItem('xhandle.projectData',JSON.stringify({p:{responseRows:Array.from({length:100},(_,index)=>({from:'Function '+index,to:'Next',codeEvidence:'SECRET_PAYLOAD',fromDetails:'x'.repeat(1000)}))},other:{responseRows:[{from:'OTHER_PROJECT'}]}}));
 const sample=await readProjectOverviewSample({projectId:'p',projectType:'project'});
 expect(sample.rows).toHaveLength(24);expect(sample.rows[0].fromDetails).toHaveLength(240);
 expect(JSON.stringify(sample)).not.toMatch(/SECRET_PAYLOAD|OTHER_PROJECT/);
});
test('overview evidence does not plan or execute an index-wide read or claim complete coverage',async()=>{
 const requestPlan=jest.fn();
 const evidence=await prepareWorkspaceReadEvidence({query:'summarize Example App',areas:['projects','functional'],force:true,requestPlan,
 context:{scope:{projectId:'p'},diagnostics:{indexScope:{types:['project','repository'],deterministic:false},overview:{rows:[{from:'A',to:'B'}],sources:[]}},relevantArtifacts:[{id:'p',type:'project',projectId:'p'}],citations:[]}});
 expect(requestPlan).not.toHaveBeenCalled();expect(executeWorkspaceReadPlan).not.toHaveBeenCalled();
 expect(evidence.results[0].coverage.complete).toBe(false);expect(evidence.results[0].excerpt.text).toContain('"from":"A"');
});
test('aborted overview does not read storage',async()=>{
 const controller=new AbortController();controller.abort();
 await expect(readProjectOverviewSample({projectId:'p',projectType:'project'},{signal:controller.signal})).rejects.toBeDefined();
});

test('code overview reads bounded source rows and skips checkpoint chunks and other projects',async()=>{
 const {openDB}=require('idb');
 const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
 const {serialize,deserialize}=require('v8');
 global.indexedDB=new IDBFactory();global.structuredClone=value=>deserialize(serialize(value));
 const db=await openDB('xhandle',1,{upgrade(db){db.createObjectStore('copilot_baseline',{keyPath:'key'});}});
 await db.put('copilot_baseline',{key:'cba:p:repo',value:Array.from({length:1000},(_,i)=>({from:'Function '+i,to:'Act',description:'Saved evidence',codeEvidence:'LARGE_SOURCE_BODY'}))});
 await db.put('copilot_baseline',{key:'cba:p:repo:$part:unused',value:'SHOULD_NOT_READ'});
 await db.put('copilot_baseline',{key:'cba:q:repo',value:[{from:'FOREIGN_PROJECT'}]});
 db.close();
 const get=IDBObjectStore.prototype.get;
 const spy=jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(key){
  expect(key).not.toMatch(/unused|cba:q:/);return get.call(this,key);
 });
 try {
  const sample=await readProjectOverviewSample({projectId:'p',projectType:'code-based-architecture'});
  expect(sample.rows).toHaveLength(24);expect(sample.sources[0].sourceKey).toBe('cba:p:repo');
  expect(JSON.stringify(sample)).toContain('Saved evidence');expect(JSON.stringify(sample)).not.toContain('LARGE_SOURCE_BODY');
  expect(spy).toHaveBeenCalledTimes(1);
 } finally {spy.mockRestore();}
});
