import createHazardRowsWorker from './createHazardRowsWorker';
import {PAGED_HAZARD} from './hazardRowIndex';
import {acquireForegroundStoragePriority} from '../../lib/foregroundStoragePriority';

// Session-only outline reuse across project switches. No row cells, snapshots,
// search results are retained here. Distinct filter values have a separate
// bounded budget included in metadataBytes. Revision checks still run
// against storage, including when another window changed or deleted the run.
const layouts=new Map();
const MAX_BYTES=8*1024*1024,MAX_ENTRIES=2;
function cacheKey(run,options){
 const d=run[PAGED_HAZARD];
 if(options.operation!=='layout'||!d?.generation||d.revision==null||options.search||Object.keys(options.filters||{}).length||options.target||options.raw)return null;
 return JSON.stringify([run.projectId,run.repoId,run.id,d.generation,d.revision,Boolean(options.partial),options.context||'all']);
}
export default async function requestHazardRows(run,options={}){
 const key=cacheKey(run,options),saved=key&&layouts.get(key);
 if(saved){
  try{await execute(run,{operation:'validate',signal:options.signal});}
  catch(error){if(error.name!=='AbortError')layouts.delete(key);throw error;}
  layouts.delete(key);layouts.set(key,saved);
  return saved;
 }
 const result=await execute(run,options);
 if(key && Number.isFinite(result.metadataBytes) && result.metadataBytes>=0 && result.metadataBytes<=MAX_BYTES){
  // Copy only the outline fields. In particular, never retain a worker payload
  // containing row bodies through a future extension to its response format.
  const outline={headers:result.headers,groups:result.groups,indices:result.indices,total:result.total,metadataBytes:result.metadataBytes,optionIndex:result.optionIndex};
  layouts.delete(key);layouts.set(key,outline);
  let bytes=[...layouts.values()].reduce((sum,value)=>sum+value.metadataBytes,0);
  while(layouts.size>MAX_ENTRIES||bytes>MAX_BYTES){const oldest=layouts.keys().next().value;bytes-=layouts.get(oldest).metadataBytes;layouts.delete(oldest);}
 }
 return result;
}
function execute(run,options={}){
 return new Promise((resolve,reject)=>{
  const {signal,onProgress,...request}=options;
  if(signal?.aborted){reject(new DOMException('Table read cancelled.','AbortError'));return;}
  const release=acquireForegroundStoragePriority();
  let worker;
  try{worker=createHazardRowsWorker();}catch(error){release();reject(error);return;}
  let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;worker.terminate();release();signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result);};
  const abort=()=>finish(new DOMException('Table read cancelled.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=event=>{
   // Deliver active failures through the table's error state. Worker bootstrap
   // errors can also arrive after cancellation; those must not escape as an
   // unrelated global runtime error after this request has already settled.
   event.preventDefault?.();
   finish(new Error(event.message||'Unable to read saved rows.'));
  };
  worker.onmessage=({data})=>{if(data.type==='progress')onProgress?.(data.progress);else finish(data.type==='error'?new Error(data.message):null,data.result);};
  try{worker.postMessage({run,options:request});}catch(error){finish(error);}
 });
}
