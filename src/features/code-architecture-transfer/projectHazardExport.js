import { sha256 } from 'hash.js';
import { isChunkedHazardRun, validateHazardDescriptor, hazardChunkKey, hazardChunkDigest, HAZARD_CHUNKS, HAZARD_CHUNK_FORMAT } from '../code-architecture-hazard-analysis/hazardRunChunks';
import { streamValue, fitsArchiveLine } from './archiveValueStream';
import { createHazardChunkIntegrityCheck } from './hazardChunkIntegrity';
import { readTransferTransaction } from './transferDatabase';

// Avoid async generators on the export path: native Safari crash reports include
// asyncGeneratorUnwrapYieldResumption under JavaScriptCore optimization frames.
// Each awaited callback consumes its token/page before the next is read.
const containers = new Set(['object','array','map','set','string','binary']);
function snapshotFilter() {
  let depth=0, key=true, keyTokens=[], name='', skip=false;
  return token => {
    const output=[],type=token[0];
    if(depth===1 && key && type!=='end'){keyTokens=[];name='';}
    const readingKey=key && depth>=1 && !(depth===1 && type==='end');
    if(readingKey){keyTokens.push(token);if(type==='text')name+=token[1];}
    else if(!skip)output.push(token);
    if(containers.has(type))depth++;else if(type==='end')depth--;
    if(depth===1 && (type==='end' || !containers.has(type))){
      if(key){key=false;skip=name==='architectureRowsSnapshot';if(!skip)output.push(...keyTokens);keyTokens=[];}
      else {key=true;skip=false;}
    }
    return output;
  };
}
export function portableHazardRun(run) {
  const {architectureRowsSnapshot, ...portable}=run;
  return portable;
}
export async function exportHazardRun(db, run, {signal,onEntry}={}) {
  const check=()=>{if(signal?.aborted)throw new DOMException('Project transfer cancelled.','AbortError');};
  check();
  const chunked=isChunkedHazardRun(run),portable=chunked?run:portableHazardRun(run);
  if(!chunked && fitsArchiveLine(portable,65536)){await onEntry({run:portable});check();return;}
  const generation=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
  let sequence=0,tokens=[],size=0;const hash=sha256();
  const flush=async()=>{
    check();const digest=hazardChunkDigest(tokens);hash.update(digest+'\n');
    await onEntry({chunk:{id:hazardChunkKey(generation,sequence),generation,sequence,runId:run.id,projectId:run.projectId,repoId:run.repoId,hazardMethod:run.hazardMethod,architectureSnapshotHash:run.architectureSnapshotHash,tokens,digest}});
    sequence++;tokens=[];size=0;await new Promise(resolve=>setTimeout(resolve,0));check();
  };
  const add=async token=>{check();tokens.push(token);size+=JSON.stringify(token).length;if(size>=16384)await flush();};
  if(chunked){
    const descriptor=validateHazardDescriptor(run),integrity=createHazardChunkIntegrityCheck(),filter=snapshotFilter();
    const entry={kind:'record',db:'xhandle-code-architecture-hazard-analysis'};
    integrity.add({...entry,store:'hazardAnalysisRuns',key:run.id,value:run});
    for(let sequence=0;sequence<descriptor.count;sequence++){
      check();const key=hazardChunkKey(descriptor.generation,sequence);
      const value=await readTransferTransaction(db,HAZARD_CHUNKS,s=>s.get(key),{signal});
      integrity.add({...entry,store:HAZARD_CHUNKS,key,value});
      for(const token of value.tokens)for(const selected of filter(token))await add(selected);
      // A large omitted snapshot still needs validation and responsive cancellation.
      await new Promise(resolve=>setTimeout(resolve,0));check();
    }
    integrity.finish();
  }else{
    const iterator=streamValue(portable);
    try{for(;;){check();const step=await iterator.next();if(step.done)break;await add(step.value);}}
    finally{iterator.return();}
  }
  if(tokens.length)await flush();check();
  const {id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt,status,reviewStatus}=run;
  await onEntry({run:{id,projectId,repoId,architectureSnapshotHash,hazardMethod,updatedAt,createdAt,status,reviewStatus,
    payload:{format:HAZARD_CHUNK_FORMAT,generation,count:sequence,digest:hash.digest('hex')}}});
  check();
}
