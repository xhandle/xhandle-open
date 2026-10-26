import { chunkHazardRun, isChunkedHazardRun, validateHazardDescriptor, hazardChunkKey, HAZARD_CHUNKS } from '../code-architecture-hazard-analysis/hazardRunChunks';
import { createHazardChunkIntegrityCheck } from './hazardChunkIntegrity';
import { readTransferTransaction } from './transferDatabase';

// This historical duplicate embeds full source content repeatedly. Consumers use
// the separately exported architecture and traceabilityMap, never this snapshot.
// Do not strip generated sheets, user inputs, pending attempts or checkpoints.
const OMIT = 'architectureRowsSnapshot';
const containers = new Set(['object','array','map','set','string','binary']);
async function* compactTokens(source) {
  let depth=0, key=true, keyTokens=[], name='', skip=false;
  for await (const token of source) {
    const type=token[0];
    if(depth===1 && key && type!=='end') { keyTokens=[]; name=''; }
    const readingKey=key && depth>=1 && !(depth===1 && type==='end');
    if(readingKey) {
      keyTokens.push(token);
      if(type==='text') name+=token[1];
    } else if(!skip) yield token;
    if(containers.has(type)) depth++;
    else if(type==='end') depth--;
    if(depth===1 && (type==='end' || !containers.has(type))) {
      if(key) {
        key=false; skip=name===OMIT;
        if(!skip) for(const part of keyTokens) yield part;
        keyTokens=[];
      } else {key=true;skip=false;}
    }
  }
}

export function portableHazardRun(run) {
  const {architectureRowsSnapshot, ...portable}=run;
  return portable;
}

export async function* exportHazardRun(db, run, {signal}={}) {
  if(!isChunkedHazardRun(run)) {
    yield* chunkHazardRun(portableHazardRun(run),{signal});
    return;
  }
  const descriptor=validateHazardDescriptor(run);
  async function* originalTokens() {
    const integrity=createHazardChunkIntegrityCheck();
    const entry={kind:'record',db:'xhandle-code-architecture-hazard-analysis'};
    integrity.add({...entry,store:'hazardAnalysisRuns',key:run.id,value:run});
    for(let sequence=0;sequence<descriptor.count;sequence++) {
      const key=hazardChunkKey(descriptor.generation,sequence);
      const value=await readTransferTransaction(db,HAZARD_CHUNKS,s=>s.get(key),{signal});
      integrity.add({...entry,store:HAZARD_CHUNKS,key,value});
      for(const token of value.tokens) yield token;
    }
    integrity.finish();
  }
  // Repage and rehash the filtered stream. Never hydrate the historical run or
  // retain all its pages. Missing/changed source pages fail the whole export.
  yield* chunkHazardRun(run,{signal,tokenSource:compactTokens(originalTokens())});
}
