// Only run on the isolated origin/profile created by check-project-transfer.cjs.
import { openDB } from 'idb';
import { createCompressedDiskArchiveSink } from '../../src/features/code-architecture-transfer/diskArchiveSink';
import { exportProjectArchive, importProjectArchive } from '../../src/features/code-architecture-transfer/projectArchive';
import { openCbaIndexedDB, readCbaRowsFromIndexedDB } from '../../src/features/code-architecture-assurance/codeArchitectureStorage';
import { writeRecord, stageRecord, readRecord, putRawRecord } from '../../src/features/code-architecture-storage/chunkedRecord';
import { saveCodeArchitectureHazardRun, getLatestCodeArchitectureHazardRun } from '../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { saveArtifactRowsAsync, loadArtifactRowsAsync } from '../../src/features/code-architecture-assurance/artifactUtils';
import { openTransferDatabase } from '../../src/features/code-architecture-transfer/transferDatabase';
import { streamValue, createValueAssembler } from '../../src/features/code-architecture-transfer/archiveValueStream';

const project={id:'isolated-transfer',name:'Runtime transfer fixture',repos:[{id:'r1',owner:'fixture',repo:'source'}],activeRepoId:'r1'};
const scope=`cba:${project.id}:r1`,checkpoint=`functional-decomposition-checkpoint:${scope}:pending`;
const assert=(value,message)=>{if(!value)throw Error(message);};
const progress=[];
window.stressEncoder=async()=>{
  let tokens=0,ticks=0;const timer=setInterval(()=>ticks++,10);
  try{
    for(let i=0;i<10000;i++){
      const value={id:i,rows:Array.from({length:8},(_,n)=>({id:n,description:`Saved row ${i}/${n}`,evidence:{path:'source.cpp',range:[n,n+1]},links:new Set(['architecture','hazard'])})),checkpoint:{pending:['next'],completed:['first']}};
      const assembler=createValueAssembler();
      for await(const token of streamValue(value)){assembler.add(token);tokens++;}
      const restored=assembler.finish();
      assert(restored.id===i && restored.rows[7].evidence.range[1]===8,'Stress roundtrip corrupted data');
      if(i%100===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
  }finally{clearInterval(timer);}
  assert(ticks>0,'Stress traversal starved timers');
  return {records:10000,tokens,ticks};
};
window.prepare=async()=>{
  const db=await openCbaIndexedDB();
  await stageRecord(db,'copilot_baseline',scope,{obsolete:'unreferenced'.repeat(100000)});
  const history=await stageRecord(db,'copilot_baseline',scope,[{from:'Historic'}]);
  await putRawRecord(db,'copilot_baseline',`${scope}:history:one`,history);
  await writeRecord(db,'copilot_baseline',scope,[{from:'Current',traceId:'trace-1'}]);
  await writeRecord(db,'copilot_baseline',checkpoint,{completedPaths:['one.cpp'],failedFiles:[{path:'next.cpp'}]});
  await writeRecord(db,'code_index','code:file:fixture/source:one.cpp',{content:'source file content\n'.repeat(100000)});
  await putRawRecord(db,'code_index','code:file:other/repo:unrelated.cpp',{content:'unrelated'.repeat(100000)});db.close();
  await saveCodeArchitectureHazardRun({id:'hazard',projectId:project.id,repoId:'r1',status:'partial',architectureRowsSnapshot:[{originalArchitectureRow:{content:'unused-source'.repeat(200000)}}],continuation:{pending:['next']},summary:[{id:'h1',evidence:'evidence'.repeat(250000)}]});
  await saveArtifactRowsAsync('software-requirements',project.id,'r1',[{id:'SW-1',requirementText:'Saved requirement'}]);
  const controller=new AbortController();
  const cancelled=await createCompressedDiskArchiveSink('cancelled',{baseURL:window.location.origin,signal:controller.signal});
  let stopped=false;
  try{await exportProjectArchive(project,{sink:cancelled,signal:controller.signal,onProgress:m=>{if(m.includes('MB raw data'))controller.abort();}});}catch(error){stopped=error.name==='AbortError';}
  assert(stopped,'Export cancellation did not stop');
  let ticks=0;const timer=setInterval(()=>ticks++,10);
  try {
    const sink=await createCompressedDiskArchiveSink(project.name,{baseURL:window.location.origin});
    window.downloadResult=await exportProjectArchive(project,{sink,onProgress:m=>progress.push(m)});
  }finally{clearInterval(timer);}
  assert(ticks>0,'UI did not yield during export');
  assert(window.downloadResult.bytes<200000,'Compressed fixture unexpectedly large');
  const a=document.createElement('a');a.id='save';a.href=window.downloadResult.url;a.download=window.downloadResult.name;a.textContent='Save';document.body.append(a);
  const input=document.createElement('input');input.type='file';input.id='restore';document.body.append(input);
  return {bytes:window.downloadResult.bytes,ticks,cancelled:stopped};
};
window.restore=async()=>{
  // All connections used above are closed. This profile contains fixture data only.
  for(const {name} of await indexedDB.databases())await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error(`Leaked connection: ${name}`));});
  localStorage.clear();
  const file=document.querySelector('#restore').files[0];
  await importProjectArchive(file,{onProgress:m=>progress.push(m)});
  const rows=await readCbaRowsFromIndexedDB(scope);assert(rows[0].from==='Current','Architecture was lost');
  const db=await openCbaIndexedDB();
  assert(!(await readRecord(db,'copilot_baseline',`${scope}:history:one`)), 'History was exported');
  assert(!(await readRecord(db,'code_index','code:file:fixture/source:one.cpp')), 'Source snapshot was exported');
  assert((await readRecord(db,'copilot_baseline',checkpoint)).completedPaths[0]==='one.cpp','Continuation was lost');db.close();
  const run=await getLatestCodeArchitectureHazardRun({projectId:project.id,repoId:'r1'});
  assert(!run.architectureRowsSnapshot?.length,'Duplicate hazard snapshot was exported');
  assert(run.status==='partial' && run.continuation.pending[0]==='next' && run.summary[0].evidence.length===2000000,'Partial hazards were lost');
  const requirements=await loadArtifactRowsAsync('software-requirements',project.id,'r1');assert(requirements[0].id==='SW-1','Requirements were lost');
  await window.downloadResult.dispose();
  const connection=await openTransferDatabase('transfer-open-test',{version:1,upgrade(db){db.createObjectStore('rows');}});
  // A later schema upgrade must not be blocked by a transfer connection.
  const upgraded=await openDB('transfer-open-test',2);upgraded.close();connection.close();
  return {architecture:true,historyExcluded:true,sourceExcluded:true,partialHazards:true,requirements:true,continuation:true,connectionReleased:true,progress:progress.length};
};
