// Regression coverage for the three disk-transfer review findings.
import 'fake-indexeddb/auto';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {TextEncoder,TextDecoder} from 'util';
import {Blob} from 'buffer';
import {webcrypto} from 'crypto';
import {openDB} from 'idb';
import {sha256} from 'hash.js';
import {exportProjectArchive,importProjectArchive,encodeValue} from './projectArchive';
import {HAZARD_SCHEMA,HAZARD_DB_VERSION} from '../code-architecture-hazard-analysis/hazardSchema';
import {HAZARD_CHUNKS,HAZARD_CHUNK_FORMAT,hazardChunkKey,hazardChunkDigest} from '../code-architecture-hazard-analysis/hazardRunChunks';
import {openCodeArchitectureHazardDB,saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,getCodeArchitectureHazardRunById} from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
const name='xhandle-code-architecture-hazard-analysis';
const project={id:'review-p',name:'Review',repos:[{id:'review-r'}],activeRepoId:'review-r'};
function fresh(){global.indexedDB=new IDBFactory();localStorage.clear();}
beforeAll(()=>{global.structuredClone=v=>deserialize(serialize(v));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);
test('repeated saves retain only the current generation',async()=>{
 const run={id:'run',projectId:project.id,repoId:'review-r',status:'partial',summary:[{evidence:'x'.repeat(200000)}]};
 await saveCodeArchitectureHazardRun(run);const db=await openCodeArchitectureHazardDB(),first=await db.count(HAZARD_CHUNKS);
 await saveCodeArchitectureHazardRun(run);await saveCodeArchitectureHazardRun(run);
 expect(await db.count('hazardAnalysisRuns')).toBe(1);expect(await db.count(HAZARD_CHUNKS)).toBe(first);db.close();
});
test('legacy hazard export/import publishes a complete usable schema',async()=>{
 const old=await openDB(name,1,{upgrade(db){const s=db.createObjectStore('hazardAnalysisRuns',{keyPath:'id'});for(const key of ['projectId','repoId','architectureSnapshotHash','hazardMethod'])s.createIndex(key,key);}});
 await old.put('hazardAnalysisRuns',{id:'old',projectId:project.id,repoId:'review-r',summary:[{evidence:'saved'}]});old.close();
 const file=await exportProjectArchive(project);fresh();await importProjectArchive(file);
 const db=await openDB(name);expect(db.version).toBe(HAZARD_DB_VERSION);expect(db.objectStoreNames.contains('runMetadata')).toBe(true);db.close();
 expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].id).toBe(project.id);
 expect((await getLatestCodeArchitectureHazardRun({projectId:project.id})).summary).toEqual([{evidence:'saved'}]);
});
test('checksummed invalid token payload is rejected before export or import publication',async()=>{
 const db=await openCodeArchitectureHazardDB(),generation='b'.repeat(32),tokens=[['unknown-token']],digest=hazardChunkDigest(tokens);
 const root={id:'bad',projectId:project.id,repoId:'review-r',payload:{format:HAZARD_CHUNK_FORMAT,generation,count:1,digest:sha256().update(digest+'\n').digest('hex')}};
 await db.put(HAZARD_CHUNKS,{id:hazardChunkKey(generation,0),generation,sequence:0,runId:root.id,projectId:root.projectId,repoId:root.repoId,tokens,digest});
 await db.put('hazardAnalysisRuns',root);await db.put('runMetadata',{id:root.id,projectId:root.projectId,repoId:root.repoId});db.close();
 await expect(exportProjectArchive(project)).rejects.toThrow(/Invalid streamed hazard/);
 const page=await (await openCodeArchitectureHazardDB()).get(HAZARD_CHUNKS,hazardChunkKey(generation,0));
 const entries=[{type:'xhandle-code-architecture-archive',version:2,project},{kind:'database',name,version:HAZARD_DB_VERSION,stores:HAZARD_SCHEMA},
 {kind:'record',db:name,store:'hazardAnalysisRuns',key:root.id,value:root},
 {kind:'record',db:name,store:HAZARD_CHUNKS,key:page.id,value:page}];
 const lines=await Promise.all(entries.map(async entry=>JSON.stringify(await encodeValue(entry))+'\n')),hash=sha256();lines.forEach(line=>hash.update(line));
 lines.push(JSON.stringify(await encodeValue({kind:'end',count:entries.length,digest:hash.digest('hex')}))+'\n');
 fresh();await expect(importProjectArchive(new Blob(lines))).rejects.toThrow(/Invalid streamed hazard/);
 expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
 expect(await getCodeArchitectureHazardRunById('bad')).toBeNull();
});

async function archive(entries){
 const lines=await Promise.all(entries.map(async e=>JSON.stringify(await encodeValue(e))+'\n')),hash=sha256();lines.forEach(l=>hash.update(l));
 lines.push(JSON.stringify(await encodeValue({kind:'end',count:entries.length,digest:hash.digest('hex')}))+'\n');return new Blob(lines);
}
test.each([1,2,3,4])('old archive version %s repairs missing canonical stores and retains partial results',async version=>{
 const run={id:'old-archive',projectId:project.id,repoId:'review-r',status:'partial',continuation:{pending:['next']}};
 const file=await archive([{type:'xhandle-code-architecture-archive',version:1,project},
 {kind:'database',name,version,stores:{hazardAnalysisRuns:HAZARD_SCHEMA.hazardAnalysisRuns}},
 {kind:'record',db:name,store:'hazardAnalysisRuns',key:run.id,value:run}]);
 await importProjectArchive(file);const db=await openDB(name);
 expect([...db.objectStoreNames]).toEqual(Object.keys(HAZARD_SCHEMA).sort());db.close();
 expect(await getLatestCodeArchitectureHazardRun({projectId:project.id})).toEqual(run);
});
test('new archive upgrades an existing legacy destination while preserving unrelated data',async()=>{
 await saveCodeArchitectureHazardRun({id:'source',projectId:project.id,repoId:'review-r',summary:['kept']});const file=await exportProjectArchive(project);fresh();
 const old=await openDB(name,3,{upgrade(db){db.createObjectStore('hazardAnalysisRuns',{keyPath:'id'});}});
 await old.put('hazardAnalysisRuns',{id:'unrelated',projectId:'other',repoId:'other',summary:['untouched']});old.close();
 await importProjectArchive(file);
 expect((await getLatestCodeArchitectureHazardRun({projectId:project.id})).summary).toEqual(['kept']);
 expect((await getLatestCodeArchitectureHazardRun({projectId:'other'})).summary).toEqual(['untouched']);
});
test('normal application open repairs a formerly incomplete version-four database',async()=>{
 const old=await openDB(name,4,{upgrade(db){db.createObjectStore('hazardAnalysisRuns',{keyPath:'id'});}});
 await old.put('hazardAnalysisRuns',{id:'repaired',projectId:project.id,summary:['saved']});old.close();
 expect((await getLatestCodeArchitectureHazardRun({projectId:project.id})).summary).toEqual(['saved']);
});

test('old archive with an empty declared metadata store gets its index before publication',async()=>{
 const run={id:'missing-index',projectId:project.id,repoId:'review-r',status:'partial'};
 const file=await archive([{type:'xhandle-code-architecture-archive',version:1,project},
 {kind:'database',name,version:3,stores:{hazardAnalysisRuns:HAZARD_SCHEMA.hazardAnalysisRuns,runMetadata:HAZARD_SCHEMA.runMetadata}},
 {kind:'record',db:name,store:'hazardAnalysisRuns',key:run.id,value:run}]);
 await importProjectArchive(file);expect(await getLatestCodeArchitectureHazardRun({projectId:project.id})).toEqual(run);
});

test('cancelling during chunk import rolls back pages and metadata while preserving unrelated results',async()=>{
 const run={id:'cancel-import',projectId:project.id,repoId:'review-r',status:'partial',summary:['x'.repeat(300000)]};
 await saveCodeArchitectureHazardRun(run);const file=await exportProjectArchive(project);fresh();
 const unrelated={id:'keep',projectId:'other',repoId:'other',summary:['keep']};
 await saveCodeArchitectureHazardRun(unrelated);
 const savedUnrelated=await getCodeArchitectureHazardRunById('keep');
 const controller=new AbortController();let importing=false;
 await expect(importProjectArchive(file,{signal:controller.signal,onProgress:message=>{
  if(message==='Importing validated project records…')importing=true;
  const percent=/Importing project records \((\d+)%\)/.exec(message);
  if(importing && percent && Number(percent[1])>=50)controller.abort();
 }})).rejects.toThrow();
 const db=await openCodeArchitectureHazardDB();
 expect(await db.count(HAZARD_CHUNKS)).toBe(0);
 expect(await db.get('runMetadata',run.id)).toBeUndefined();
 expect(await db.get('hazardAnalysisRuns',run.id)).toBeUndefined();
 expect(await getCodeArchitectureHazardRunById('keep')).toEqual(savedUnrelated);
 expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();db.close();
});
