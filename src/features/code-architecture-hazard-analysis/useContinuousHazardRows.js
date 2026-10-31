import {useEffect,useRef,useState} from 'react';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';

export const HAZARD_ROW_CACHE_LIMIT = 400;
export const HAZARD_ROW_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_REQUESTS = 2;
const EMPTY_ROWS = new Map();
const EMPTY_INDICES = [];
const emptyStats = {rows:0,bytes:0,pending:0,maxRows:HAZARD_ROW_CACHE_LIMIT,maxBytes:HAZARD_ROW_CACHE_BYTES};

// Conservative retained-cell estimate, not a measurement of process heap.
// Normal rows contain scalar cells; unusual saved cells remain accounted for.
function rowBytes(row,reported) {
 let bytes=64+row.length*16;
 for(const cell of row){
  if(typeof cell==='string')bytes+=32+cell.length*2;
  else if(cell && typeof cell==='object')bytes+=32+JSON.stringify(cell).length*2;
  else bytes+=16;
 }
 return Math.max(bytes,Number.isFinite(reported)?reported:0);
}

function createLoader(scope,run,partial,notify){
 const cache=new Map(),requests=new Map();
 let desired=[],required=[],desiredKey='',priority=new Map(),satisfied=new Set(),failed=new Set();
 let bytes=0,clock=0,sequence=0,retired=false,error=null,budgetRank=Infinity;
 let snapshot={scope,rowsByIndex:EMPTY_ROWS,loading:false,error:null,cacheStats:emptyStats};
 const budgetError=new Error('These unusually large rows exceed the interactive memory limit. Narrow the table filters or export the matching rows.');
 const publish=(changed=false)=>{
  if(retired)return;
  const loading=requests.size>0;
  const visibleError=error || (!loading && budgetRank<Infinity
   && required.some(index=>!cache.has(index)&&priority.get(index)>=budgetRank)?budgetError:null);
  if(!changed && snapshot.loading===loading && snapshot.error===visibleError
   && snapshot.cacheStats.pending===requests.size && snapshot.cacheStats.rows===cache.size
   && snapshot.cacheStats.bytes===bytes)return;
  snapshot={scope,rowsByIndex:changed?new Map([...cache].map(([index,entry])=>[index,entry.row])):snapshot.rowsByIndex,
   loading,error:visibleError,cacheStats:{rows:cache.size,bytes,pending:requests.size,maxRows:HAZARD_ROW_CACHE_LIMIT,maxBytes:HAZARD_ROW_CACHE_BYTES}};
  notify(snapshot);
 };
 const prune=()=>{
  if(cache.size<=HAZARD_ROW_CACHE_LIMIT && bytes<=HAZARD_ROW_CACHE_BYTES)return false;
  const candidates=[...cache].sort(([a,first],[b,second])=>{
   const firstRank=priority.get(a)??Infinity,secondRank=priority.get(b)??Infinity;
   return firstRank===secondRank?first.used-second.used:firstRank>secondRank?-1:1;
  });
  for(const [index,entry] of candidates){
   if(cache.size<=HAZARD_ROW_CACHE_LIMIT && bytes<=HAZARD_ROW_CACHE_BYTES)break;
   cache.delete(index);bytes-=entry.bytes;
   // Stop lower-priority prefetch when the byte budget cannot hold the current
   // demand. Otherwise short, large pages could be fetched/evicted forever.
   if(priority.has(index))budgetRank=Math.min(budgetRank,priority.get(index));
  }
  return true;
 };
 const pump=(changed=false)=>{
  if(retired)return;
  const pending=new Set([...requests.values()].flatMap(request=>request.indices));
  const nextIndices=()=>desired.filter(index=>priority.get(index)<budgetRank && !cache.has(index)
   && !pending.has(index) && !satisfied.has(index) && !failed.has(index)).slice(0,100);
  const launch=indices=>{
   const id=++sequence,controller=new AbortController(),request={indices,controller};
   requests.set(id,request);indices.forEach(index=>pending.add(index));
   Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw new DOMException('Table read cancelled.','AbortError');
    return requestHazardRows(run,{partial,indices,offset:0,limit:indices.length,signal:controller.signal});
   }).then(result=>{
    if(retired || controller.signal.aborted || requests.get(id)!==request)return;
    const {rows,rowIndices,nextOffset}=result;
    if(!Array.isArray(rows)||!Array.isArray(rowIndices)||rows.length!==rowIndices.length
     || !Number.isSafeInteger(nextOffset)||nextOffset!==rows.length||nextOffset<1||nextOffset>indices.length
     || rowIndices.some((index,i)=>index!==indices[i])||rows.some(row=>!Array.isArray(row))){
     throw Error('Saved rows returned an invalid or empty range. Retry loading these rows.');
    }
    // The provider can stop before100 rows at its byte cap. Only the returned
    // prefix is satisfied; the missing tail is scheduled by the next pump.
    const entries=rows.map((row,i)=>({row,bytes:rowBytes(row,result.rowBytes?.[i]),used:++clock}));
    if(entries.some(entry=>entry.bytes>HAZARD_ROW_CACHE_BYTES))throw Error('A saved row exceeds the interactive row cache size. Existing results were not changed.');
    rows.forEach((row,i)=>{
     const index=rowIndices[i],previous=cache.get(index);
     if(previous)bytes-=previous.bytes;
     cache.set(index,entries[i]);bytes+=entries[i].bytes;satisfied.add(index);
    });
    requests.delete(id);prune();pump(true);
   }).catch(reason=>{
    if(retired || controller.signal.aborted || requests.get(id)!==request)return;
    requests.delete(id);indices.forEach(index=>failed.add(index));
    error=reason instanceof Error?reason:new Error(String(reason));
    pump();
   });
  };
  while(requests.size<MAX_REQUESTS){
   const indices=nextIndices();
   if(!indices.length)break;
   launch(indices);
  }
  publish(changed);
 };
 return {
  get snapshot(){return snapshot;},
  request(indices,requiredIndices=EMPTY_INDICES){
   if(retired)return;
   const unique=[];const seen=new Set();
   for(const index of [...requiredIndices,...(indices || EMPTY_INDICES)]){
    if(Number.isSafeInteger(index)&&index>=0&&!seen.has(index)){unique.push(index);seen.add(index);}
    if(unique.length===HAZARD_ROW_CACHE_LIMIT)break;
   }
   const nextRequired=[...new Set(requiredIndices)].filter(index=>seen.has(index));
   const key=unique.join(',')+'|'+nextRequired.join(',');
   if(key===desiredKey)return;
   const nextPriority=new Map(unique.map((index,i)=>[index,i]));
   desired=unique;required=nextRequired;desiredKey=key;priority=nextPriority;
   satisfied=new Set();failed=new Set([...failed].filter(index=>priority.has(index)));budgetRank=Infinity;
   if(!failed.size)error=null;
   for(const index of desired){const entry=cache.get(index);if(entry)entry.used=++clock;}
   for(const [id,request] of requests){
    if(!request.indices.some(index=>nextPriority.has(index))){requests.delete(id);request.controller.abort();}
   }
   pump(prune());
  },
  retry(){if(retired)return;failed.clear();satisfied.clear();budgetRank=Infinity;error=null;pump();},
  retire(){
   retired=true;for(const request of requests.values())request.controller.abort();
   requests.clear();cache.clear();desired=[];required=[];priority.clear();satisfied.clear();failed.clear();bytes=0;
  },
 };
}

// One active query owns this cache. Layout contains only the complete ordering;
// requestedRowIndices is a bounded viewport-first list followed by prefetch.
export default function useContinuousHazardRows({run,partial=false,queryKey,layout,requestedRowIndices=EMPTY_INDICES,requiredRowIndices=EMPTY_INDICES}){
 const descriptor=run?.[PAGED_HAZARD];
 const scope=JSON.stringify([run?.id,descriptor?.generation,descriptor?.revision,partial,queryKey]);
 const owner=useRef(null),source=useRef(null);
 source.current={run,partial};
 const [state,setState]=useState({scope:null,rowsByIndex:EMPTY_ROWS,loading:false,error:null,cacheStats:emptyStats});
 useEffect(()=>{
  const {run,partial}=source.current;
  const loader=createLoader(scope,run,partial,next=>{if(owner.current===loader)setState(next);});
  owner.current=loader;setState(loader.snapshot);
  return ()=>{loader.retire();if(owner.current===loader)owner.current=null;};
 },[scope]);
 useEffect(()=>{
  owner.current?.request(layout?requestedRowIndices:EMPTY_INDICES,layout?requiredRowIndices:EMPTY_INDICES);
 },[scope,layout,requestedRowIndices,requiredRowIndices]);
 const retry=useRef(()=>owner.current?.retry()).current;
 const current=state.scope===scope?state:{rowsByIndex:EMPTY_ROWS,loading:false,error:null,cacheStats:emptyStats};
 return {...current,retry};
}
