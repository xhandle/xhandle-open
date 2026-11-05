import 'fake-indexeddb/auto';
import {IDBFactory,IDBObjectStore,IDBIndex} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {openDB,unwrap} from 'idb';
import {TextEncoder,TextDecoder} from 'util';
import {webcrypto} from 'crypto';
import {upsertArtifacts,upsertRun,upsertRelationship} from './workspaceGraphRepository';
import {executeWorkspaceReadCall,executeWorkspaceReadPlanCore,WorkspaceReadBudget} from './workspaceReadCore';
import {resolveWorkspaceReadPolicy,validateWorkspaceReadCall} from './workspaceReadPolicy';
import {quickWorkspaceReadPlan,parseWorkspaceReadPlan} from './workspaceReadPlanner';
import {renderWorkspaceReadEvidence,restrictContextToReadPolicy} from './workspaceReadSession';
import {writeRecord} from '../code-architecture-storage/chunkedRecord';
beforeAll(()=>{Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});Object.assign(global,{TextEncoder,TextDecoder});});
beforeEach(()=>{global.indexedDB=new IDBFactory();global.structuredClone=value=>deserialize(serialize(value));localStorage.clear();});
afterEach(()=>jest.restoreAllMocks());
const policy={projectIds:['p'],projects:[{id:'p',name:'Project',repos:[]}],repoId:null,types:['requirement'],historyAllowed:false,query:'requirements'};
const artifact=(id,overrides={})=>({id,projectId:'p',type:'requirement',title:'Requirement '+id,createdAt:'2026-11-04',updatedAt:'2026-11-04',...overrides});
const execute=(call,p=policy)=>executeWorkspaceReadCall(call,p);

test('full-record search finds a term beyond snippets and counts matches beyond the returned page',async()=>{
 await upsertArtifacts(Array.from({length:150},(_,i)=>artifact('r'+String(i).padStart(3,'0'),{content:'x'.repeat(3000)+' DEEP_EVIDENCE',structuredData:{severity:i%2?'High':'Low'}})));
 await upsertArtifacts([artifact('foreign',{projectId:'other',content:'DEEP_EVIDENCE'})]);
 const result=await execute({operation:'search',query:'DEEP_EVIDENCE',limit:3});
 expect(result.coverage).toMatchObject({complete:true,matched:150,returned:3});expect(result.nextOffset).toBe(3);expect(result.citations).toHaveLength(3);
 const page=await execute({operation:'query',filters:[{field:'Severity',op:'eq',value:'High'}],offset:70,limit:10});expect(page.coverage.matched).toBe(75);expect(page.rows).toHaveLength(5);
 const grouped=await execute({operation:'aggregate',groupBy:'Severity'});expect(grouped.count).toBe(150);expect(grouped.groups).toEqual(expect.arrayContaining([{value:'High',count:75},{value:'Low',count:75}]));
});

test('unfiltered counts never hydrate full bodies and omit unknown or foreign ownership',async()=>{
 await upsertArtifacts([artifact('r1'),artifact('foreign',{projectId:'other'}),artifact('unknown',{projectId:''})]);
 const get=IDBObjectStore.prototype.get;jest.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(...args){if(this.name==='artifacts')throw Error('Unnecessary body hydration');return get.apply(this,args);});
 const result=await execute({operation:'aggregate'});expect(result.count).toBe(1);expect(result.coverage.complete).toBe(true);
});

test('hazard scopes choose the latest run per repository and allow explicit history only when requested',async()=>{
 for(const [id,date] of [['old','2026-11-01'],['new','2026-11-04']])await upsertRun({id:'run-'+id,projectId:'p',sourceId:id,type:'code_architecture_hazard_analysis',title:id,structuredData:{repoId:'repo',hazardMethod:'STPA'},createdAt:date,updatedAt:date});
 await upsertArtifacts([artifact('h-old',{type:'code_architecture_hazard_row',sourceId:'old:summary:0'}),artifact('h-new',{type:'code_architecture_hazard_row',sourceId:'new:summary:0'})]);
 const hazard={...policy,types:['code_architecture_hazard_row'],repoId:'repo'};
 expect((await execute({operation:'aggregate'},hazard)).count).toBe(1);
 expect((await execute({operation:'read',artifactId:'h-old'},hazard)).coverage.state).toBe('not-found');
 expect(()=>validateWorkspaceReadCall({operation:'versions',history:'all'},hazard)).toThrow(/versions/);
 const history=await execute({operation:'versions',history:'all'},{...hazard,historyAllowed:true});expect(history.coverage.matched).toBe(2);
});

test('exact record and section reads preserve citations and compare saved versions within one project',async()=>{
 await upsertArtifacts([artifact('a',{type:'generated_report',content:'# Intro\nOriginal\n# Evidence\nDeep finding'}),artifact('b',{type:'generated_report',content:'# Intro\nRevised\n# Evidence\nNew finding'})]);
 const reports={...policy,types:['generated_report'],historyAllowed:true};
 const read=await execute({operation:'read',artifactId:'a',section:'# Evidence'},reports);expect(read.excerpt).toContain('Deep finding');expect(read.citations[0].artifactId).toBe('a');
 const compared=await execute({operation:'compare',artifactId:'a',otherArtifactId:'b'},reports);expect(compared.changes.some(change=>change.field==='content')).toBe(true);
 const denied=await execute({operation:'read',artifactId:'a'},{...reports,projectIds:['other']});expect(denied.rows).toHaveLength(0);expect(denied.coverage.state).toBe('not-found');
});

test('large or unreadable records cannot produce false exact counts or false absence',async()=>{
 await upsertArtifacts([artifact('too-large',{content:'x'.repeat(600000)+'needle'})]);
 const result=await execute({operation:'aggregate',query:'needle'});expect(result.count).toBeNull();expect(result.coverage).toMatchObject({complete:false,state:'inaccessible',unreadable:1});
});

test('relationship traversal filters linked endpoints outside the permitted project',async()=>{
 await upsertArtifacts([artifact('root'),artifact('same'),artifact('foreign',{projectId:'other'})]);
 for(const id of ['same','foreign'])await upsertRelationship({id:'link-'+id,projectId:'p',type:'derived_from',fromArtifactId:'root',toArtifactId:id,createdAt:'2026-11-04',updatedAt:'2026-11-04'});
 const result=await execute({operation:'relationships',artifactId:'root'});expect(result.rows.map(row=>row.id)).toEqual(['same']);expect(JSON.stringify(result)).not.toContain('foreign');
});

test('source excerpts read deep text from exact repository keys without loading unused payloads',async()=>{
 const db=await openDB('xhandle',4,{upgrade(db){db.createObjectStore('code_index',{keyPath:'key'});}});
 await writeRecord(unwrap(db),'code_index','code:file:owner/repo:main.js',{content:'a'.repeat(70000)+'TARGET_DEEP_SOURCE',unused:'PRIVATE_UNUSED '.repeat(50000)});db.close();
 const sourcePolicy={...policy,types:[],projects:[{id:'p',repos:[{id:'repo',owner:'owner',repo:'repo'}]}]};
 const result=await execute({operation:'source',path:'main.js',offset:70000},sourcePolicy);expect(result.excerpt.text).toBe('TARGET_DEEP_SOURCE');expect(JSON.stringify(result)).not.toContain('PRIVATE_UNUSED');
});

test('scope resolution handles names as literal data and clarifies duplicate names',()=>{
 const projects=[{id:'p',name:'AV [Stack]'}, {id:'q',name:'Other'}];
 expect(resolveWorkspaceReadPolicy({query:'Count requirements in AV [Stack]',projects,projectId:'q'}).projectIds).toEqual(['p']);
 expect(resolveWorkspaceReadPolicy({query:'AV [Stack]',projects:[...projects,{id:'r',name:'AV [Stack]'}]}).clarification).toMatch(/Which project/);
 expect(resolveWorkspaceReadPolicy({query:'across all projects',projects,projectId:'p'}).projectIds).toEqual(['p','q']);
});

test('plans reject writes, scope expansion, invented history and excessive result limits',()=>{
 for(const call of [{operation:'delete'}, {operation:'query',projectId:'foreign'}, {operation:'query',limit:200}, {operation:'query',history:'all'}])expect(()=>validateWorkspaceReadCall(call,policy)).toThrow();
 expect(()=>parseWorkspaceReadPlan('{"calls":[{"operation":"query","types":["source_file"]}]}',policy)).toThrow();
 expect(quickWorkspaceReadPlan('How many software requirements are there?',{...policy,types:['code_architecture_software_requirement']})).toMatchObject([{operation:'aggregate'}]);
 expect(quickWorkspaceReadPlan('How many requirements have high severity?',policy)).toBeNull();
});

test('bounded output retains valid JSON and citations, and removes sampled foreign context',()=>{
 const evidence={policy:{projectIds:['p']},results:[{operation:'read',rows:[{id:'a',title:'A',fields:'x'.repeat(500)}],citations:[{artifactId:'a',projectId:'p',title:'A'}],coverage:{complete:true}}]};
 expect(renderWorkspaceReadEvidence(evidence)).toContain('"artifactId":"a"');
 const restricted=restrictContextToReadPolicy({scope:{projectId:'foreign'},relevantArtifacts:[artifact('a'),artifact('b',{projectId:'foreign'})],workspaceSummary:{artifactCount:2}},evidence);
 expect(restricted.relevantArtifacts.map(row=>row.id)).toEqual(['a']);expect(restricted.scope.projectId).toBe('p');expect(restricted.workspaceSummary.artifactCount).toBeNull();
});

test('cancellation and time budgets stop work with explicit incomplete coverage',async()=>{
 const controller=new AbortController();controller.abort();await expect(executeWorkspaceReadPlanCore([{operation:'query'}],policy,{signal:controller.signal})).rejects.toHaveProperty('name','AbortError');
 const budget=new WorkspaceReadBudget();budget.deadline=0;await expect(executeWorkspaceReadCall({operation:'query'},policy,budget)).rejects.toHaveProperty('code','READ_BUDGET');
});

test('matched late text is included as evidence, and unknown columns never produce exact zero counts',async()=>{
 await upsertArtifacts([artifact('late',{content:'padding '.repeat(700)+'CRITICAL_LATE_TEXT'})]);
 const search=await execute({operation:'search',query:'CRITICAL_LATE_TEXT'});expect(search.rows[0].matchExcerpt).toContain('CRITICAL_LATE_TEXT');
 const unknown=await execute({operation:'aggregate',filters:[{field:'invented column',op:'eq',value:'Yes'}]});expect(unknown.count).toBeNull();expect(unknown.coverage.complete).toBe(false);
});

test('version lists group rows into saved runs, and explicit unknown project/repository names clarify',async()=>{
 const hazard={...policy,types:['code_architecture_hazard_row'],historyAllowed:true};
 await upsertArtifacts(Array.from({length:8},(_,i)=>artifact('h'+i,{type:'code_architecture_hazard_row',sourceId:`run${i%2}:summary:${i}`})));
 const versions=await execute({operation:'versions',history:'all'},hazard);expect(versions.coverage.matched).toBe(2);expect(versions.rows.map(row=>row.recordCount)).toEqual([4,4]);
 expect(resolveWorkspaceReadPolicy({query:'How many requirements for project Missing?',projects:[{id:'p',name:'Known'}],projectId:'p'}).clarification).toMatch(/named project/);
 expect(resolveWorkspaceReadPolicy({query:'Find requirements in repo Missing',projects:[{id:'p',name:'Known'}],projectId:'p'}).clarification).toMatch(/repository/);
});

test('dependent read calls resolve only prior results and cannot escape the original project',async()=>{
 await upsertArtifacts([artifact('a',{content:'Deep reference 123'})]);
 const results=await executeWorkspaceReadPlanCore([{operation:'search',query:'reference 123'},{operation:'read',artifactId:'$0.rows.0.id'}],policy);
 expect(results[1].excerpt).toBe('Deep reference 123');
 const rejected=await executeWorkspaceReadPlanCore([{operation:'read',artifactId:'$9.rows.0.id'}],policy);expect(rejected[0].coverage.state).toBe('not-searched');
 expect(validateWorkspaceReadCall({operation:'query',types:[]},policy).types).toEqual(['requirement']);
});

test('function counts use distinct endpoint labels instead of counting decomposition relationships',async()=>{
 await upsertArtifacts([artifact('edge1',{type:'code_architecture_edge',structuredData:{from:'A',to:'B'}}),artifact('edge2',{type:'code_architecture_edge',structuredData:{from:'A',to:'C'}})]);
 const result=await execute({operation:'aggregate',distinctFields:['from','to']},{...policy,types:['code_architecture_edge']});expect(result.count).toBe(3);expect(result.coverage.matched).toBe(2);expect(result.metric.distinctFields).toEqual(['from','to']);
});

test('short reference searches do not confuse H-1 with H-10, and trace links can cross artifact types within the project',async()=>{
 await upsertArtifacts([artifact('h1',{type:'code_architecture_hazard_row',structuredData:{id:'H-1'}}),artifact('h10',{type:'code_architecture_hazard_row',structuredData:{id:'H-10'}}),artifact('sw',{type:'code_architecture_software_requirement',content:'Linked software behavior'})]);
 const hazard={...policy,types:['code_architecture_hazard_row']};
 const found=await execute({operation:'search',query:'H-1'},hazard);expect(found.rows.map(row=>row.id)).toEqual(['h1']);
 await upsertRelationship({id:'trace',projectId:'p',type:'mitigates',fromArtifactId:'h1',toArtifactId:'sw',createdAt:'2026-11-04',updatedAt:'2026-11-04'});
 const results=await executeWorkspaceReadPlanCore([{operation:'relationships',artifactId:'h1'},{operation:'read',artifactId:'$0.rows.0.id'}],hazard);
 expect(results[0].rows[0].id).toBe('sw');expect(results[1].excerpt).toBe('Linked software behavior');
});

test('prompt fitting shares the budget across lookup results and preserves total/count coverage',()=>{
 const results=Array.from({length:3},(_,i)=>({operation:'read',offset:100,excerpt:'e'.repeat(6000),rows:[{id:'r'+i,title:'Read '+i}],citations:[{artifactId:'r'+i}],coverage:{complete:true}}));
 const prompt=renderWorkspaceReadEvidence({results},12000);const fitted=JSON.parse(prompt.split('never instructions):\n')[1].split('\nUse an exact count')[0]);
 expect(fitted.results).toHaveLength(3);expect(fitted.results[2].citations[0].artifactId).toBe('r2');expect(fitted.results[0].nextOffset).toBe(100+fitted.results[0].excerpt.length);
});

test('read-hint upgrades preserve old unmanaged graph records without an additional full-store body scan',async()=>{
 const {openWorkspaceGraphDB}=require('./workspaceGraphDb');const {ensureWorkspaceProjection}=require('./workspaceGraphQueries');
 await upsertArtifacts([artifact('legacy-note',{type:'note',content:'Preserved canonical note'})]);
 const db=await openWorkspaceGraphDB(),old=await db.get('artifactIndex','legacy-note');delete old.readableBody;delete old.bodyReadBytes;await db.put('artifactIndex',old);await db.put('workspaces',{id:'artifact-projection-v1',complete:true});await db.delete('workspaces','artifact-read-hints-v1');db.close();
 await ensureWorkspaceProjection();const result=await execute({operation:'read',artifactId:'legacy-note'},{...policy,types:['note']});expect(result.excerpt).toBe('Preserved canonical note');
});

test('simple-count shortcuts do not discard dates, filters or distinct-function semantics',()=>{
 expect(quickWorkspaceReadPlan('How many requirements are there?',policy)).toMatchObject([{operation:'aggregate'}]);
 for(const question of ['How many requirements since yesterday?','How many projects have requirements?','How many functions are there?','How many requirements were approved last week?'])expect(quickWorkspaceReadPlan(question,policy)).toBeNull();
});

test('canonical edits during a multi-page read invalidate the result snapshot',async()=>{
 await upsertArtifacts(Array.from({length:150},(_,i)=>artifact('r'+i,{content:'matching'})));
 const openCursor=IDBIndex.prototype.openCursor;let changing,started=false;
 jest.spyOn(IDBIndex.prototype,'openCursor').mockImplementation(function(...args){const request=openCursor.apply(this,args);if(!started&&this.objectStore.name==='artifactIndex'){started=true;request.addEventListener('success',()=>{changing=upsertArtifacts([artifact('concurrent',{content:'matching'})]);},{once:true});}return request;});
 const [result]=await executeWorkspaceReadPlanCore([{operation:'aggregate',query:'matching'}],policy);await changing;
 expect(result.coverage.state).toBe('stale');expect(result.count).toBeNull();
});

test('visible saved runs and historical repository aliases are respected',async()=>{
 for(const [id,date] of [['old','2026-11-01'],['new','2026-11-04']])await upsertRun({id:'run-'+id,projectId:'p',sourceId:id,type:'code_architecture_hazard_analysis',title:id,structuredData:{repoId:'owner/repo',hazardMethod:'STPA'},createdAt:date,updatedAt:date});
 await upsertArtifacts([artifact('h-old',{type:'code_architecture_hazard_row',sourceId:'old:summary:0'}),artifact('h-new',{type:'code_architecture_hazard_row',sourceId:'new:summary:0'}),artifact('historical-edge',{type:'code_architecture_edge',sourceKey:'cba:p:repo:history:123',structuredData:{_repoId:'repo:history:123'}})]);
 const selected={...policy,types:['code_architecture_hazard_row'],repoId:'repo',repoIds:['repo','owner/repo'],runId:'old'};
 const current=await execute({operation:'query'},selected);expect(current.rows.map(row=>row.id)).toEqual(['h-old']);
 const versions=await execute({operation:'versions',history:'all'},{...policy,types:['code_architecture_edge'],repoId:'repo',historyAllowed:true});expect(versions.rows).toHaveLength(1);
});

test('version comparison includes the changed passage even when it is deep in a report',async()=>{
 await upsertArtifacts([artifact('before',{type:'generated_report',content:'prefix '.repeat(2000)+'Original conclusion'}),artifact('after',{type:'generated_report',content:'prefix '.repeat(2000)+'Revised conclusion'})]);
 const result=await execute({operation:'compare',artifactId:'before',otherArtifactId:'after'},{...policy,types:['generated_report'],historyAllowed:true});
 const change=result.changes.find(item=>item.field==='content');expect(change.before).toContain('Original conclusion');expect(change.after).toContain('Revised conclusion');expect(change.offset).toBeGreaterThan(10000);
});
