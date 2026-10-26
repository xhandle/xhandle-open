import { sha256 } from 'hash.js';
import { streamValue, createValueAssembler, fitsArchiveLine } from '../code-architecture-transfer/archiveValueStream';
import { HAZARD_CHUNKS, HAZARD_STAGING, HAZARD_SCHEMA } from './hazardSchema';
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
  let sequence=0,tokens=[],size=0;const hash=sha256();
  const page=()=>{
    const digest=hazardChunkDigest(tokens);hash.update(digest+'\n');
    const record={id:hazardChunkKey(generation,sequence),generation,sequence,runId:run.id,projectId:run.projectId,repoId:run.repoId,hazardMethod:run.hazardMethod,architectureSnapshotHash:run.architectureSnapshotHash,tokens,digest};
    sequence++;tokens=[];size=0;return {chunk:record};
  };
  for await(const token of (tokenSource || streamValue(run))){
    check(signal);tokens.push(token);size+=JSON.stringify(token).length;
    if(size>=16384){yield page();await new Promise(resolve=>setTimeout(resolve,0));}
  }
  if(tokens.length)yield page();
  const {id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt,status,reviewStatus}=run;
  yield {run:{id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt,status,reviewStatus,
    payload:{format:HAZARD_CHUNK_FORMAT,generation,count:sequence,digest:hash.digest('hex')}}};
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
export async function stageHazardRun(db,run,assertCurrent=()=>{}) {
  let staged,generation;
  try{
    for await(const entry of chunkHazardRun(run)){
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
export async function publishHazardRun(db,run,metadata,assertCurrent=()=>{},expectedLegacy) {
  const tx=db.transaction(['hazardAnalysisRuns','runMetadata',HAZARD_CHUNKS,HAZARD_STAGING],'readwrite');tx.done.catch(()=>{});
  try{
    const roots=tx.objectStore('hazardAnalysisRuns'),old=await roots.get(run.id);
    // A fallback migration must not overwrite a save committed while its pages were staged.
    if(arguments.length>=5){
      const current=await tx.objectStore('runMetadata').get(run.id);
      if(JSON.stringify(current)!==JSON.stringify(expectedLegacy)){
        await tx.done;if(isChunkedHazardRun(run))await removeHazardGeneration(db,run.payload.generation);return;
      }
    }
    if(isChunkedHazardRun(run) && run.payload.generation!==old?.payload?.generation){
      const lease=await tx.objectStore(HAZARD_STAGING).get(run.payload.generation);
      if(!lease)throw new Error('Hazard save staging expired. Retry saving.');
    }
    assertCurrent();
    await roots.put(run);await tx.objectStore('runMetadata').put(metadata);
    if(isChunkedHazardRun(old) && old.payload.generation!==run?.payload?.generation){
      await tx.objectStore(HAZARD_CHUNKS).delete(IDBKeyRange.bound(old.payload.generation+':',old.payload.generation+':\uffff'));
    }
    if(isChunkedHazardRun(run))await tx.objectStore(HAZARD_STAGING).delete(run.payload.generation);
    await tx.done;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function hydrateHazardRun(db,run) {
  if(!isChunkedHazardRun(run))return run;
  // Re-read the root and all its pages within one readonly snapshot. A replacing
  // writer/deleter cannot reclaim these pages until this transaction retires.
  const tx=db.transaction(['hazardAnalysisRuns',HAZARD_CHUNKS],'readonly');tx.done.catch(()=>{});
  try {
    run=await tx.objectStore('hazardAnalysisRuns').get(run.id);
    if(!isChunkedHazardRun(run)){await tx.done;return run;}
    const p=validateHazardDescriptor(run),assembler=createValueAssembler(),hash=sha256();
    for(let sequence=0;sequence<p.count;sequence++){
      const part=await tx.objectStore(HAZARD_CHUNKS).get(hazardChunkKey(p.generation,sequence));
      if(!part || part.runId!==run.id || part.projectId!==run.projectId || part.repoId!==run.repoId || part.sequence!==sequence || part.digest!==hazardChunkDigest(part.tokens))throw new Error('Saved hazard analysis has a missing or damaged chunk.');
      hash.update(part.digest+'\n');for(const token of part.tokens)assembler.add(token);
    }
    if(hash.digest('hex')!==p.digest)throw new Error('Saved hazard analysis failed integrity verification.');
    const value=assembler.finish();
    if(value?.id!==run.id || value?.projectId!==run.projectId || value?.repoId!==run.repoId)throw new Error('Saved hazard identity does not match its chunks.');
    await tx.done;return value;
  }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export const hazardChunkSchema = HAZARD_SCHEMA[HAZARD_CHUNKS];
