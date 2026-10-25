import { sha256 } from 'hash.js';
import { HAZARD_CHUNKS, isChunkedHazardRun, validateHazardDescriptor, hazardChunkKey, hazardChunkDigest } from '../code-architecture-hazard-analysis/hazardRunChunks';
import { createHazardTokenValidator } from './hazardTokenValidator';
export function createHazardChunkIntegrityCheck(){
  const roots=[],generations=new Map();
  const bad=()=>{throw new Error('Hazard analysis archive checksum verification failed: missing or damaged chunks.');};
  return {
    add(entry){
      if(entry.kind!=='record' || entry.db!=='xhandle-code-architecture-hazard-analysis')return;
      const v=entry.value;
      if(entry.store==='hazardAnalysisRuns' && isChunkedHazardRun(v)){validateHazardDescriptor(v);roots.push(v);}
      if(entry.store===HAZARD_CHUNKS){
        if(!v || !/^[a-f0-9]{32}$/.test(v.generation) || !Number.isSafeInteger(v.sequence) || v.sequence<0 || v.id!==hazardChunkKey(v.generation,v.sequence) || entry.key!==v.id || !Array.isArray(v.tokens) || v.digest!==hazardChunkDigest(v.tokens))bad();
        let state=generations.get(v.generation);
        if(!state){state={count:0,hash:sha256(),id:v.runId,projectId:v.projectId,repoId:v.repoId};state.validator=createHazardTokenValidator(state);generations.set(v.generation,state);}
        // Archives produced by the exporter emit each generation in sequence order.
        if(v.sequence!==state.count || v.runId!==state.id || v.projectId!==state.projectId || v.repoId!==state.repoId)bad();
        for(const token of v.tokens)state.validator.add(token);
        state.hash.update(v.digest+'\n');state.count++;
      }
    },
    finish(){
      const referenced=new Set();
      for(const root of roots){const p=root.payload,state=generations.get(p.generation);
        if(!state || referenced.has(p.generation) || state.count!==p.count || state.id!==root.id || state.projectId!==root.projectId || state.repoId!==root.repoId)bad();
        referenced.add(p.generation);state.validator.finish();
        if(state.hash.digest('hex')!==p.digest)bad();
      }
      if(referenced.size!==generations.size)bad();
    },
  };
}
