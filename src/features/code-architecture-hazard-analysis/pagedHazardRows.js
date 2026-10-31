import {validateHazardTableIndex} from './hazardTableIndex';
import {createHazardAssociationMatcher} from './hazardAssociationMatcher';
import {openHazardSchema} from './hazardSchema';
import {hazardChunkKey,hazardChunkDigest,HAZARD_CHUNKS} from './hazardRunChunks';
import {validateHazardRowIndex,PAGED_HAZARD} from './hazardRowIndex';
import {createValueAssembler} from '../code-architecture-transfer/archiveValueStream';
import {createHazardRowNormalizer} from '../project-hazard-analysis/classificationResolutionStatus';
import {fillNotApplicableHazardCells} from '../project-hazard-analysis/hazardNotApplicableCells';
import {createCodeArchitectureHazardLayout} from './codeArchitectureHazardGrouping';
const check=signal=>{if(signal?.aborted)throw new DOMException('Table read cancelled.','AbortError');};
export async function queryHazardRows(run,{operation='page',raw=false,field,target,partial=false,offset=0,limit=100,indices,filters={},search='',context='all',column=0,optionSearch='',signal,onProgress=()=>{}}={}){
 const descriptor=run[PAGED_HAZARD];if(!descriptor)throw Error('This run has no saved row provider.');
 const db=await openHazardSchema({signal});const tx=db.transaction(['hazardAnalysisRuns','runMetadata',HAZARD_CHUNKS]);tx.done.catch(()=>{});
 const abort=()=>{try{tx.abort();}catch{}};signal?.addEventListener('abort',abort,{once:true});
 try{
  check(signal);const root=await tx.objectStore('hazardAnalysisRuns').get(run.id),meta=await tx.objectStore('runMetadata').get(run.id);
  if(meta?.storageRevision!==descriptor.revision || root?.payload?.generation!==descriptor.generation)throw Error('Saved results changed. Reload the table before continuing.');
  const rootIndex=validateHazardRowIndex(root.payload),index=partial?rootIndex.partial:rootIndex;
  if(!index?.headers && operation!=='detail')throw Error('This run has no saved partial table.');
  const normalizer=createHazardRowNormalizer(index?.headers || []),headers=raw && operation==='page'?index.headers:normalizer.headers;
  const pageDigests=new Map(validateHazardTableIndex(root.payload).pages.map(p=>[p.sequence,p.digest]));
  const cache=new Map();const get=async seq=>{
   if(cache.has(seq))return cache.get(seq);
   check(signal);const page=await tx.objectStore(HAZARD_CHUNKS).get(hazardChunkKey(descriptor.generation,seq));
   if(!page || page.generation!==descriptor.generation || page.runId!==run.id || page.digest!==hazardChunkDigest(page.tokens))throw Error('Saved table has a missing or damaged page.');
   const expected=pageDigests.get(seq);
   if(expected!==page.digest)throw Error('Saved table page failed integrity verification.');
   if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(seq,page);return page;
  };
  const readSpan=async(span,maxBytes)=>{
   if(!span)throw Error('Saved value no longer exists.');
   const assembler=createValueAssembler();let bytes=0;
   for(let seq=span[0];seq<=span[2];seq++){
    const page=await get(seq),start=seq===span[0]?span[1]:0,end=seq===span[2]?span[3]:page.tokens.length;
    if(end>page.tokens.length)throw Error('Invalid saved row range.');
    for(let i=start;i<end;i++){const token=page.tokens[i];bytes+=JSON.stringify(token).length*2;if(bytes>maxBytes)throw Error('This saved value exceeds the safe interactive size. Existing results were not changed.');assembler.add(token);}
   }
   return assembler.finish();
  };
  if(operation==='detail'){
   if(!['csvImportPreviousSummary','narrativeReview'].includes(field))throw Error('Unsupported saved detail.');
   const value=rootIndex.details?.[field]?await readSpan(rootIndex.details[field],32*1024*1024):null;
   await tx.done;check(signal);return {value};
  }
  const row=async n=>{const value=await readSpan(index.spans[n],8*1024*1024);return raw && operation==='page'?value:fillNotApplicableHazardCells(headers,normalizer.normalizeRow(value,n));};
  const contextIndex=headers.findIndex(h=>['operational context id','context id'].includes(String(h).toLowerCase()));
  const matchesTarget=createHazardAssociationMatcher(headers,target);
  const text=v=>String(v??'').trim();
  if(operation==='query' || operation==='options' || operation==='layout'){
   let optionBytes=0,truncated=false;const matches=[],options=new Set(),needle=search.trim().toLowerCase(),optionNeedle=optionSearch.trim().toLowerCase();
   const layout=operation==='layout'?createCodeArchitectureHazardLayout(headers):null;
   for(let i=0;i<index.spans.length;i++){
    check(signal);const cells=await row(i);
    if(operation==='options'){
     const value=text(cells[column])||'(blank)';if(!optionNeedle||value.toLowerCase().includes(optionNeedle)){
      if(value.length>2048 || optionBytes+value.length*2>256*1024){truncated=true;}
      else if(!options.has(value)){options.add(value);optionBytes+=value.length*2;}
     }
     // Keep only the first 500 sorted options, with bounded option memory.
     if(options.size>500){const sorted=[...options].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));const removed=sorted[sorted.length-1];options.delete(removed);optionBytes-=removed.length*2;truncated=true;}
    }else if((!target||matchesTarget(cells)) && (context==='all'||text(cells[contextIndex])===context) && (!needle||cells.some(v=>text(v).toLowerCase().includes(needle))) && Object.entries(filters).every(([key,values])=>!values.length||values.includes(text(cells[Number(key)])||'(blank)'))){
     if(layout)layout.addRow(i,cells);else matches.push(i);
    }
    if(i%100===0)onProgress({completed:i,total:index.spans.length});
   }
   await tx.done;check(signal);
   return operation==='options'?{options:[...options].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})),truncated}:layout?layout.finish():{indices:matches,total:matches.length};
  }
  const total=indices?indices.length:index.spans.length,rows=[],rowIndices=[],rowBytes=[];let bytes=0;
  for(let i=offset;i<Math.min(total,offset+Math.min(limit,100));i++){
   check(signal);const n=indices?indices[i]:i,cells=await row(n);const size=JSON.stringify(cells).length*2;
   if(rows.length && bytes+size>1024*1024)break;
   rows.push(cells);rowIndices.push(n);rowBytes.push(size);bytes+=size;
  }
  await tx.done;check(signal);return {headers,rows,rowIndices,rowBytes,total,offset,nextOffset:offset+rows.length};
 }catch(error){abort();await tx.done.catch(()=>{});throw error;}
 finally{signal?.removeEventListener('abort',abort);db.close();}
}
