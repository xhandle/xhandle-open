import {createHazardRowIndex} from './hazardRowIndex';
import {createHazardTableIndex,validateHazardTableIndex} from './hazardTableIndex';
import { sha256 } from 'hash.js';
import { streamValue, createValueAssembler, fitsArchiveLine } from '../code-architecture-transfer/archiveValueStream';
import { HAZARD_CHUNKS, HAZARD_STAGING, HAZARD_SCHEMA, newHazardStorageRevision } from './hazardSchema';
export { HAZARD_CHUNKS };
export const HAZARD_CHUNK_FORMAT = 'xhandle-hazard-run-chunks-v1';
export const isChunkedHazardRun = run => run?.payload?.format === HAZARD_CHUNK_FORMAT;
export const hazardChunkKey = (generation, sequence) => `${generation}:${String(sequence).padStart(12,'0')}`;
export const hazardChunkDigest = tokens => sha256().update(JSON.stringify(tokens)).digest('hex');
const check = signal => {if(signal?.aborted)throw new DOMException('Project transfer cancelled.','AbortError');};
export function validateHazardDescriptor(run) {
  const p=run?.payload;
  if(!p || !/^[a-f0-9]{32}$/.test(p.generation) || !Number.isSafeInteger(p.count) || p.count<1 || !/^[a-f0-9]{64}$/.test(p.digest))throw new Error('Invalid chunked hazard run.');
  return p;
}
// Only the current page and original caller-owned run are retained during encoding.
export async function* chunkHazardRun(run,{signal,tokenSource}={}) {
  if(!tokenSource && (isChunkedHazardRun(run) || fitsArchiveLine(run,65536))){yield {run};return;}
  const generation=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
  let sequence=0,tokens=[],size=0;const hash=sha256(),tableIndex=createHazardTableIndex(),rowIndex=createHazardRowIndex();
  const page=()=>{
    const digest=hazardChunkDigest(tokens);hash.update(digest+'\n');tableIndex.page(sequence,digest);
    const record={id:hazardChunkKey(generation,sequence),generation,sequence,runId:run.id,projectId:run.projectId,repoId:run.repoId,hazardMethod:run.hazardMethod,architectureSnapshotHash:run.architectureSnapshotHash,tokens,digest};
    sequence++;tokens=[];size=0;return {chunk:record};
  };
  for await(const token of (tokenSource || streamValue(run))){
    check(signal);rowIndex.add(token,sequence,tokens.length);tableIndex.add(token,sequence,tokens.length);tokens.push(token);size+=JSON.stringify(token).length;
    if(size>=16384){yield page();await new Promise(resolve=>setTimeout(resolve,0));}
  }
  if(tokens.length)yield page();
  const digest=hash.digest('hex');
  const {id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt,status,reviewStatus}=run;
  yield {run:{id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt,status,reviewStatus,
    payload:{format:HAZARD_CHUNK_FORMAT,generation,count:sequence,digest,tableIndex:tableIndex.finish(digest),rowIndex:rowIndex.finish(digest)}}};
}
const LEASE_MS = 10 * 60 * 1000;
// One transaction makes reclamation atomic with respect to other writers and readers.
async function reclaimHazardGenerations(db,runId) {
  const tx=db.transaction(['hazardAnalysisRuns',HAZARD_CHUNKS,HAZARD_STAGING],'readwrite');
  tx.done.catch(()=>{});
  try {
    const root=await tx.objectStore('hazardAnalysisRuns').get(runId);
    const keep=new Set(isChunkedHazardRun(root)?[root.payload.generation]:[]);
    let lease=await tx.objectStore(HAZARD_STAGING).index('runId').openCursor(runId);
    while(lease){
      if(Date.now()-lease.value.touched<LEASE_MS)keep.add(lease.value.id);
      else await lease.delete();
      lease=await lease.continue();
    }
    let page=await tx.objectStore(HAZARD_CHUNKS).index('runId').openCursor(runId);
    while(page){if(!keep.has(page.value.generation))await page.delete();page=await page.continue();}
    await tx.done;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function stageHazardRun(db,run,assertCurrent=()=>{},options={}) {
  let staged,generation;
  try{
    for await(const entry of chunkHazardRun(run,options)){
      assertCurrent();
      if(entry.chunk){
        if(!generation){await reclaimHazardGenerations(db,run.id);generation=entry.chunk.generation;}
        const tx=db.transaction([HAZARD_CHUNKS,HAZARD_STAGING],'readwrite');tx.done.catch(()=>{});
        try {
          const leases=tx.objectStore(HAZARD_STAGING),lease=await leases.get(generation);
          if(entry.chunk.sequence>0 && !lease)throw new Error('Hazard save staging expired. Retry saving.');
          await leases.put({id:generation,runId:run.id,projectId:run.projectId,repoId:run.repoId,hazardMethod:run.hazardMethod,architectureSnapshotHash:run.architectureSnapshotHash,touched:Date.now()});
          await tx.objectStore(HAZARD_CHUNKS).put(entry.chunk);await tx.done;
        }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
      }else staged=entry.run;
    }
    return staged;
  }catch(error){if(generation)await removeHazardGeneration(db,generation).catch(()=>{});throw error;}
}
export async function removeHazardGeneration(db,generation) {
  const tx=db.transaction([HAZARD_CHUNKS,HAZARD_STAGING],'readwrite');tx.done.catch(()=>{});
  await tx.objectStore(HAZARD_CHUNKS).delete(IDBKeyRange.bound(generation+':',generation+':\uffff'));
  await tx.objectStore(HAZARD_STAGING).delete(generation);await tx.done;
}
export async function publishHazardRun(db,run,metadata,assertCurrent=()=>{},expectedLegacy,expectedRevision) {
  const tx=db.transaction(['hazardAnalysisRuns','runMetadata',HAZARD_CHUNKS,HAZARD_STAGING],'readwrite');tx.done.catch(()=>{});
  try{
    const roots=tx.objectStore('hazardAnalysisRuns'),old=await roots.get(run.id);
    // A fallback migration must not overwrite a save committed while its pages were staged.
    if(arguments.length===5){
      const current=await tx.objectStore('runMetadata').get(run.id);
      if(JSON.stringify(current)!==JSON.stringify(expectedLegacy)){
        await tx.done;if(isChunkedHazardRun(run))await removeHazardGeneration(db,run.payload.generation);return;
      }
    }
    if(isChunkedHazardRun(run) && run.payload.generation!==old?.payload?.generation){
      const lease=await tx.objectStore(HAZARD_STAGING).get(run.payload.generation);
      if(!lease)throw new Error('Hazard save staging expired. Retry saving.');
    }
    if(expectedRevision){
      const current=await tx.objectStore('runMetadata').get(run.id);
      if(current?.storageRevision!==expectedRevision)throw Object.assign(Error('Saved analysis changed. Reload it before saving edits.'),{code:'HAZARD_REVISION_CONFLICT'});
    }
    assertCurrent();
    const storageRevision=newHazardStorageRevision();
    await roots.put(run);await tx.objectStore('runMetadata').put({...metadata, storageRevision});
    if(isChunkedHazardRun(old) && old.payload.generation!==run?.payload?.generation){
      await tx.objectStore(HAZARD_CHUNKS).delete(IDBKeyRange.bound(old.payload.generation+':',old.payload.generation+':\uffff'));
    }
    if(isChunkedHazardRun(run))await tx.objectStore(HAZARD_STAGING).delete(run.payload.generation);
    await tx.done;return storageRevision;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function hydrateHazardRun(db,run,{signal,onProgress,assemblerFactory=createValueAssembler,tableOnly=false}={}) {
  check(signal);
  if(!isChunkedHazardRun(run))return run;
  // Re-read the root and all its pages within one readonly snapshot. A replacing
  // writer/deleter cannot reclaim these pages until this transaction retires.
  const tx=db.transaction(['hazardAnalysisRuns',HAZARD_CHUNKS],'readonly');tx.done.catch(()=>{});
  const abort=()=>{try{tx.abort();}catch{}};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    check(signal);
    run=await tx.objectStore('hazardAnalysisRuns').get(run.id);
    if(!isChunkedHazardRun(run)){await tx.done;return run;}
    const p=validateHazardDescriptor(run),assembler=assemblerFactory(),hash=sha256();
    if(tableOnly){
      const index=validateHazardTableIndex(p),store=tx.objectStore(HAZARD_CHUNKS);
      for(let start=0;start<index.pages.length;start+=16){
        check(signal);
        const selected=index.pages.slice(start,start+16);
        const parts=await Promise.all(selected.map(page=>store.get(hazardChunkKey(p.generation,page.sequence))));
        for(let i=0;i<parts.length;i++){
          const part=parts[i],page=selected[i];check(signal);
          if(!part || part.runId!==run.id || part.projectId!==run.projectId || part.repoId!==run.repoId || part.sequence!==page.sequence || part.digest!==page.digest || part.digest!==hazardChunkDigest(part.tokens))throw Error('Saved hazard table has a missing or damaged chunk.');
          for(const [from,to] of page.ranges){
            if(to>part.tokens.length)throw Error('Saved hazard table has an invalid token range.');
            for(let offset=from;offset<to;offset++)assembler.add(part.tokens[offset]);
          }
        }
        onProgress?.({completed:Math.min(start+16,index.pages.length),total:index.pages.length});
      }
      const value=assembler.finish();
      if(value?.id!==run.id || value?.projectId!==run.projectId || value?.repoId!==run.repoId)throw Error('Saved hazard identity does not match its table.');
      await tx.done;check(signal);return value;
    }

    // Range reads amortize IndexedDB round trips without fetching the full run.
    // Sixteen normal 16 KiB pages keep transient input bounded. The readonly
    // snapshot, per-page integrity checks and assembly order remain unchanged.
    const store=tx.objectStore(HAZARD_CHUNKS);
    for(let start=0;start<p.count;start+=16){
      check(signal);
      const end=Math.min(start+16,p.count);
      const parts=await store.getAll(IDBKeyRange.bound(hazardChunkKey(p.generation,start),hazardChunkKey(p.generation,end-1)),16);
      if(parts.length!==end-start)throw new Error('Saved hazard analysis has a missing or damaged chunk.');
      for(let index=0;index<parts.length;index++){
        check(signal);
        const sequence=start+index,part=parts[index];
        if(!part || part.runId!==run.id || part.projectId!==run.projectId || part.repoId!==run.repoId || part.sequence!==sequence || part.digest!==hazardChunkDigest(part.tokens))throw new Error('Saved hazard analysis has a missing or damaged chunk.');
        check(signal);
        hash.update(part.digest+'\n');for(const token of part.tokens)assembler.add(token);
        onProgress?.({completed:sequence+1,total:p.count});
      }
    }
    if(hash.digest('hex')!==p.digest)throw new Error('Saved hazard analysis failed integrity verification.');
    const value=assembler.finish();
    if(value?.id!==run.id || value?.projectId!==run.projectId || value?.repoId!==run.repoId)throw new Error('Saved hazard identity does not match its chunks.');
    await tx.done;check(signal);return value;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',abort);}
}
export const hazardChunkSchema = HAZARD_SCHEMA[HAZARD_CHUNKS];
