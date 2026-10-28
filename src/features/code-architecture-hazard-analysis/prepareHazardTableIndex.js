import {createHazardRowIndex,validateHazardRowIndex} from './hazardRowIndex';
import {sha256} from 'hash.js';
import {createHazardTableIndex,validateHazardTableIndex} from './hazardTableIndex';
import {isChunkedHazardRun,validateHazardDescriptor,hazardChunkKey,hazardChunkDigest,HAZARD_CHUNKS} from './hazardRunChunks';
import {createHazardTokenValidator} from '../code-architecture-transfer/hazardTokenValidator';
const check=signal=>{if(signal?.aborted)throw new DOMException('Table storage upgrade cancelled.','AbortError');};
// Explicit upgrade/import preparation. Original pages are never changed. A
// cancelled or interrupted scan leaves the original run available for retry.
export async function prepareHazardTableIndex(db,id,{signal,onProgress=()=>{}}={}) {
  check(signal);
  const tx=db.transaction(['hazardAnalysisRuns',HAZARD_CHUNKS]);tx.done.catch(()=>{});
  const abort=()=>{try{tx.abort();}catch{}};
  signal?.addEventListener('abort',abort,{once:true});
  let root,index,rows;
  try {
    root=await tx.objectStore('hazardAnalysisRuns').get(id);
    if(!root)throw Error('Saved analysis no longer exists.');
    if(!isChunkedHazardRun(root)){await tx.done;return;}
    try{validateHazardTableIndex(root.payload);validateHazardRowIndex(root.payload);await tx.done;return;}catch{/* Build or repair a derived index. */}
    const p=validateHazardDescriptor(root),builder=createHazardTableIndex(),rowBuilder=createHazardRowIndex(),hash=sha256();
    const validator=createHazardTokenValidator({id:root.id,projectId:root.projectId,repoId:root.repoId});
    for(let start=0;start<p.count;start+=16){
      check(signal);const end=Math.min(start+16,p.count);
      const pages=await tx.objectStore(HAZARD_CHUNKS).getAll(IDBKeyRange.bound(hazardChunkKey(p.generation,start),hazardChunkKey(p.generation,end-1)),16);
      if(pages.length!==end-start)throw Error('Saved analysis has missing chunks. Upgrade did not change the analysis.');
      for(let i=0;i<pages.length;i++){
        const page=pages[i];check(signal);
        if(page.sequence!==start+i || page.generation!==p.generation || page.runId!==id || page.projectId!==root.projectId || page.repoId!==root.repoId || page.digest!==hazardChunkDigest(page.tokens))throw Error('Saved analysis has a damaged chunk. Upgrade did not change the analysis.');
        page.tokens.forEach((token,offset)=>{validator.add(token);builder.add(token,page.sequence,offset);rowBuilder.add(token,page.sequence,offset);});
        builder.page(page.sequence,page.digest);hash.update(page.digest+'\n');
      }
      onProgress({completed:end,total:p.count});
    }
    validator.finish();if(hash.digest('hex')!==p.digest)throw Error('Saved analysis failed integrity verification.');
    index=builder.finish(p.digest);rows=rowBuilder.finish(p.digest);await tx.done;
  }catch(error){abort();await tx.done.catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',abort);}
  check(signal);
  const publish=db.transaction('hazardAnalysisRuns','readwrite');publish.done.catch(()=>{});
  const cancel=()=>{try{publish.abort();}catch{}};
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    const current=await publish.store.get(id);check(signal);
    if(current?.payload?.generation!==root.payload.generation || current.payload.digest!==root.payload.digest)throw Error('Saved analysis changed during its storage upgrade. Retry with the current results.');
    await publish.store.put({...current,payload:{...current.payload,tableIndex:index,rowIndex:rows}});await publish.done;check(signal);
  }catch(error){cancel();await publish.done.catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',cancel);}
}
