import 'fake-indexeddb/auto';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { gzipSync } from 'zlib';
import { sha256 } from 'hash.js';
import { exportProjectArchive, importProjectArchive, encodeValue, decodeValue } from './projectArchive';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
const project={id:'p1',name:'Large partial',repos:[{id:'r1'}],activeRepoId:'r1'};
function fresh(){global.indexedDB=new IDBFactory();localStorage.clear();}
beforeAll(()=>{global.structuredClone=v=>deserialize(serialize(v));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});});
beforeEach(fresh);
async function fixture(){
 await saveCodeArchitectureHazardRun({id:'run1',projectId:'p1',repoId:'r1',status:'partial',summary:[{id:'h1',evidence:'x'.repeat(2000000)}]});
 return exportProjectArchive(project);
}
async function rewrite(file,change){
 const entries=(await file.text()).trim().split('\n').map(l=>decodeValue(JSON.parse(l)));entries.pop();change(entries);
 const lines=await Promise.all(entries.map(async e=>JSON.stringify(await encodeValue(e))+'\n'));
 const hash=sha256();lines.forEach(l=>hash.update(l));lines.push(JSON.stringify(await encodeValue({kind:'end',count:entries.length,digest:hash.digest('hex')}))+'\n');return new Blob(lines);
}
test.each(['missing start','missing end','extra end','illegal token'])('checksum-valid malformed stream: %s is rejected before publishing',async kind=>{
 const file=await fixture();const broken=await rewrite(file,entries=>{
  const start=entries.findIndex(e=>e.kind==='stream-start'),end=entries.findIndex(e=>e.kind==='stream-end');
  if(kind==='missing start')entries.splice(start,1);
  if(kind==='missing end')entries.splice(end,1);
  if(kind==='extra end')entries.splice(end,0,{kind:'stream-end'});
  if(kind==='illegal token')entries[start+1].tokens[0]=['unknown-token'];
 });fresh();await expect(importProjectArchive(broken)).rejects.toThrow();
 expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
 expect(await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).toBeNull();
});
test('changed text in a framed record fails the archive checksum',async()=>{
 const file=await fixture();const broken=new Blob([(await file.text()).replace('xxxxxxxxxx','yyyyyyyyyy')]);fresh();
 const progress=[];await expect(importProjectArchive(broken,{onProgress:m=>progress.push(m)})).rejects.toThrow(/checksum/);
 expect(progress.some(m=>m.startsWith('100%'))).toBe(false);
 expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
});
test('large framed import reports bounded intermediate percentages in both passes',async()=>{
 const file=await fixture();expect((await file.text()).split('\n').length).toBeGreaterThan(64);fresh();
 const progress=[];await importProjectArchive(file,{onProgress:m=>progress.push(m)});
 for (const stage of ['Validating project archive','Importing project records']) {
  const percentages=progress.filter(m=>m.startsWith(stage+' (')).map(m=>Number(m.match(/\((\d+)%\)/)[1]));
  expect(percentages.some(p=>p>0 && p<99)).toBe(true);
  expect(percentages).toEqual([...new Set(percentages)].sort((a,b)=>a-b));
  expect(percentages.length).toBeLessThanOrEqual(100);
  expect(Math.max(...percentages)).toBe(99);
 }
 expect(progress.filter(m=>m.startsWith('100%'))).toEqual([progress[progress.length-1]]);
 expect((await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).summary[0].evidence.length).toBe(2000000);
});

test.each(['Validating project archive','Importing project records'])('cancellation during streamed %s preserves destination',async stage=>{
 await saveCodeArchitectureHazardRun({id:'a-earlier',projectId:'p1',repoId:'r1',status:'partial',summary:[{id:'earlier'}]});
 const file=await fixture();fresh();const controller=new AbortController(),progress=[];
 await expect(importProjectArchive(file,{signal:controller.signal,onProgress:m=>{
  progress.push(m);const match=m.match(/\((\d+)%\)/);
  if(m.startsWith(stage) && match && Number(match[1])>=10)controller.abort();
 }})).rejects.toThrow(/cancelled/);
 expect(controller.signal.aborted).toBe(true);
 expect(progress.some(m=>m.startsWith('100%'))).toBe(false);
 expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
 expect(await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).toBeNull();
});

test.each(['Validating project archive','Importing project records'])('UI timer can cancel %s and unrelated destination data survives',async stage=>{
 await saveCodeArchitectureHazardRun({id:'a-earlier',projectId:'p1',repoId:'r1',status:'partial',summary:[{id:'earlier'}]});
 const file=await fixture();fresh();
 const other={id:'other',name:'Keep this project',repos:[]};
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([other]));
 await saveCodeArchitectureHazardRun({id:'other-run',projectId:'other',repoId:'other-repo',status:'partial',summary:[{id:'keep'}]});
 const controller=new AbortController();let scheduled=false,timerRan=false;const progress=[];
 await expect(importProjectArchive(file,{signal:controller.signal,onProgress:m=>{
  progress.push(m);const match=m.match(/\((\d+)%\)/);
  if(!scheduled && m.startsWith(stage) && match && Number(match[1])>=10){
   scheduled=true;setTimeout(()=>{timerRan=true;controller.abort();},0);
  }
 }})).rejects.toThrow(/cancelled/);
 expect(timerRan).toBe(true);
 expect(progress.some(m=>m.startsWith('100%'))).toBe(false);
 expect(JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))).toEqual([other]);
 expect(await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).toBeNull();
 expect((await getLatestCodeArchitectureHazardRun({projectId:'other',repoId:'other-repo'})).summary).toEqual([{id:'keep'}]);
});

test('success is reported only after project publication and complete partial-result restoration',async()=>{
 const file=await fixture();fresh();let publishedAtSuccess=false;
 await importProjectArchive(file,{onProgress:m=>{
  if(m.startsWith('100%'))publishedAtSuccess=JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')||'[]').some(p=>p.id==='p1');
 }});
 expect(publishedAtSuccess).toBe(true);
 const run=await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'});
 expect(run.status).toBe('partial');expect(run.summary[0].evidence).toBe('x'.repeat(2000000));
});

test('disk sink avoids the final Blob and retains resumable partial results on import',async()=>{
 await saveCodeArchitectureHazardRun({id:'run1',projectId:'p1',repoId:'r1',status:'partial',summary:[{id:'h1',evidence:'x'.repeat(2000000)}],continuation:{next:7,pending:['h2']}});
 const lines=[],result={url:'http://localhost/file',name:'test.xhproject'};
 const sink={write:jest.fn(async line=>{expect(line.length).toBeLessThan(100000);lines.push(line);}),finish:jest.fn(async()=>result),abort:jest.fn()};
 expect(await exportProjectArchive(project,{sink})).toBe(result);expect(sink.abort).not.toHaveBeenCalled();
 const file=new Blob(lines);fresh();await importProjectArchive(file);
 const run=await getLatestCodeArchitectureHazardRun({projectId:'p1'});expect(run.status).toBe('partial');expect(run.continuation).toEqual({next:7,pending:['h2']});expect(run.summary[0].evidence.length).toBe(2000000);
});
test('compressed archive restores partial results and rejects truncated input before publication',async()=>{
 const original=await fixture();
 const compressed=gzipSync(Buffer.from(await original.arrayBuffer()));
 expect(compressed.length).toBeLessThan(original.size/10);
 const oldRead=global.ReadableStream,oldDecompress=global.DecompressionStream;
 const streams=require('stream/web');global.ReadableStream=streams.ReadableStream;global.DecompressionStream=streams.DecompressionStream;
 try{
  fresh();
  await expect(importProjectArchive(new Blob([compressed.subarray(0,compressed.length-8)]))).rejects.toThrow();
  expect(localStorage.getItem('xhandle.codeArchitectureProjects')).toBeNull();
  await importProjectArchive(new Blob([compressed]));
  const run=await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'});
  expect(run.status).toBe('partial');expect(run.summary[0].evidence.length).toBe(2000000);
 }finally{global.ReadableStream=oldRead;global.DecompressionStream=oldDecompress;}
});
test('failed disk writes abort the spool and never report success',async()=>{
 const progress=[],sink={write:jest.fn(async()=>{throw Error('disk full');}),abort:jest.fn(async()=>{}),finish:jest.fn()};
 await expect(exportProjectArchive(project,{sink,onProgress:m=>progress.push(m)})).rejects.toThrow('disk full');expect(sink.abort).toHaveBeenCalledTimes(1);expect(sink.finish).not.toHaveBeenCalled();expect(progress.some(m=>m.startsWith('100%'))).toBe(false);
});

test('legacy version-three hazard archive initializes the new chunk store for later saves',async()=>{
 await saveCodeArchitectureHazardRun({id:'small',projectId:'p1',repoId:'r1',status:'partial',summary:[]});
 const file=await exportProjectArchive(project),legacy=await rewrite(file,entries=>{const schema=entries.find(e=>e.kind==='database' && e.name==='xhandle-code-architecture-hazard-analysis');schema.version=3;delete schema.stores.hazardRunChunks;});
 fresh();await importProjectArchive(legacy);await saveCodeArchitectureHazardRun({id:'later',projectId:'p1',repoId:'r1',summary:[{evidence:'x'.repeat(200000)}]});
 expect((await getLatestCodeArchitectureHazardRun({projectId:'p1',repoId:'r1'})).summary[0].evidence.length).toBe(200000);
});
