// Opt-in, read-only legacy-file benchmark. Uses a fresh fake database, never the
// application's browser profile. Only aggregate byte counts are printed.
import 'fake-indexeddb/auto';
import fs from 'fs';
import { serialize, deserialize } from 'v8';
import { TextEncoder, TextDecoder } from 'util';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Blob } from 'buffer';
import { webcrypto } from 'crypto';
import { gzipSync } from 'zlib';
import { exportProjectArchive, importProjectArchive, encodeValue, decodeValue } from './projectArchive';
import { fitsArchiveLine, streamValue, createValueAssembler } from './archiveValueStream';
import { openCbaIndexedDB, readCbaRowsFromIndexedDB } from '../code-architecture-assurance/codeArchitectureStorage';
import { writeRecord } from '../code-architecture-storage/chunkedRecord';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { saveArtifactRowsAsync } from '../code-architecture-assurance/artifactUtils';
const file=process.env.XHANDLE_EXPORT_BENCHMARK_FILE;
(file?test:test.skip)('legacy project size benchmark and complete selected-result roundtrip',async()=>{
 global.structuredClone=v=>deserialize(serialize(v));global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;global.Blob=Blob;global.IDBKeyRange=IDBKeyRange;Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});
 global.indexedDB=new IDBFactory();localStorage.clear();
 const bytes=fs.readFileSync(file),legacy=JSON.parse(bytes);
 expect(legacy.type).toBe('xhandle-code-architecture-project');
 const project={...legacy.project,repos:legacy.repos.map(r=>({...r.repo,id:r.repo.repoId||r.repo.id}))};
 for(let i=0;i<legacy.repos.length;i++){
  const r=legacy.repos[i],repo=project.repos[i];
  const db=await openCbaIndexedDB();await writeRecord(db,'copilot_baseline',`cba:${project.id}:${repo.id}`,r.rows);db.close();
  for(const run of r.analysis?.hazardRuns||[])await saveCodeArchitectureHazardRun({...run,projectId:project.id,repoId:repo.id});
  for(const [kind,rows] of Object.entries(r.analysis?.artifactRows||{}))if(rows.length)await saveArtifactRowsAsync(kind,project.id,repo.id,rows);
 }
 const archive=await exportProjectArchive(project),text=await archive.text();
 // Compare the previous transport with exactly the same selected records.
 let assembler=null;const entries=[];
 for(const line of text.trim().split('\n')){
  const e=decodeValue(JSON.parse(line));
  if(e.kind==='stream-start')assembler=createValueAssembler();
  else if(e.kind==='stream-data'){for(const t of e.tokens)assembler.add(t);}
  else if(e.kind==='stream-end'){entries.push(assembler.finish());assembler=null;}
  else entries.push(e);
 }
 const oldLines=[];const append=async e=>oldLines.push(JSON.stringify(await encodeValue(e))+'\n');
 for(const e of entries){
  if(fitsArchiveLine(e)){await append(e);continue;}
  await append({kind:'stream-start',transportVersion:2});let tokens=[],size=0;
  for await(const t of streamValue(e)){tokens.push(t);size+=JSON.stringify(t).length;if(size>=16384){await append({kind:'stream-data',tokens});tokens=[];size=0;}}
  if(tokens.length)await append({kind:'stream-data',tokens});await append({kind:'stream-end'});
 }
 const old=oldLines.join('');
 console.log('EXPORT_SIZE_BENCHMARK',JSON.stringify({legacyFile:bytes.length,legacyGzip:gzipSync(bytes).length,previousTransportRaw:Buffer.byteLength(old),previousTransportGzip:gzipSync(old).length,compactRaw:Buffer.byteLength(text),compactGzip:gzipSync(text).length}));
 expect(Buffer.byteLength(text)).toBeLessThan(Buffer.byteLength(old));
 expect(gzipSync(text).length).toBeLessThan(gzipSync(old).length);
 global.indexedDB=new IDBFactory();localStorage.clear();await importProjectArchive(archive);
 for(let i=0;i<legacy.repos.length;i++){
  const r=legacy.repos[i],repo=project.repos[i];
  expect(await readCbaRowsFromIndexedDB(`cba:${project.id}:${repo.id}`)).toEqual(r.rows);
  if(r.analysis?.hazardRuns?.length){const saved=await getLatestCodeArchitectureHazardRun({projectId:project.id,repoId:repo.id});expect(saved.generatedSheets).toEqual(r.analysis.hazardRuns[r.analysis.hazardRuns.length-1].generatedSheets);}
 }
},120000);
