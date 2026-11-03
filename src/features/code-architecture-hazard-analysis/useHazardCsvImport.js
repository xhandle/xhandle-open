import {useCallback,useEffect,useSyncExternalStore} from 'react';
import createWorker from './createHazardCsvImportWorker';
import {hazardCsvTransferRun} from './hazardCsvTransfer';
import {hazardCsvScope,setHazardCsvImportBusy} from './hazardCsvActivity';
const jobs=new Map(),idle=Object.freeze({status:'idle',message:'',plan:null,progress:null,sourceFile:null});
const jobFor=scope=>{if(!jobs.has(scope))jobs.set(scope,{snapshot:idle,listeners:new Set(),client:null,owners:0,prepareVersion:0,canceling:null});return jobs.get(scope);};
function publish(scope,patch){const job=jobFor(scope);job.snapshot={...job.snapshot,...patch};setHazardCsvImportBusy(scope,['reading','ready','saving','canceling'].includes(job.snapshot.status));job.listeners.forEach(listener=>listener());
 for(const [key,value]of jobs){if(jobs.size<=32)break;if(!value.client&&!value.canceling&&!value.owners&&!value.listeners.size&&!['reading','ready','saving','canceling'].includes(value.snapshot.status))jobs.delete(key);}}
function client(onProgress,onFailure){
 const worker=createWorker(),waiting=new Map();let next=0,closed=false,failed=false,committed=null;
 const request=(operation,args={})=>new Promise((resolve,reject)=>{if(closed||failed){reject(Error('CSV processing stopped. Select the file again.'));return;}const id=++next;waiting.set(id,{resolve,reject,operation});try{const transfer={...args};if(args.run)transfer.run=hazardCsvTransferRun(args.run);if(args.currentRun)transfer.currentRun=hazardCsvTransferRun(args.currentRun,true);worker.postMessage({id,operation,args:transfer});}catch(error){waiting.delete(id);reject(error);}});
 worker.onmessage=({data})=>{const pending=waiting.get(data.id);if(!pending)return;if(data.type==='progress'){onProgress(data.progress);return;}if(data.type==='committed'){committed=data.result;return;}waiting.delete(data.id);if(data.type==='error')pending.reject(Object.assign(Error(data.message),{name:data.name}));else{if(data.result?.run)committed=data.result;pending.resolve(data.result);}};
 worker.onerror=event=>{failed=true;const wasPending=waiting.size>0;const message=event.message||'CSV processing stopped unexpectedly. Existing results were not replaced.';waiting.forEach(({resolve,reject,operation})=>{if(committed && operation==='apply')resolve(committed);else reject(Error(message));});waiting.clear();if(!wasPending)onFailure(message);};
 return {request,async dispose(){if(closed)return committed;worker.postMessage({operation:'cancel'});let timer;try{if(!failed)await Promise.race([request('discard'),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);}finally{clearTimeout(timer);closed=true;worker.terminate();waiting.forEach(({reject})=>reject(new DOMException('CSV import canceled.','AbortError')));waiting.clear();}return committed;}};
}
async function cancel(scope,reason='user',invalidate=true){
 const job=jobFor(scope);if(invalidate)job.prepareVersion++;
 if(job.canceling)return job.canceling;
 const previous=job.client;if(!previous)return;
 job.client=null;publish(scope,{status:'canceling',message:'Stopping CSV import…',plan:null,progress:null});
 const stopping=(async()=>{
  const committed=await previous.dispose().catch(()=>null);
  publish(scope,{status:committed?'complete':'canceled',message:committed?'The import finished saving before cancellation. The saved results are retained.':reason==='user'?'CSV import canceled. Existing results were not replaced.':'CSV import stopped because its workspace closed. Existing results were not replaced.',progress:null});
 })();
 job.canceling=stopping;
 try{await stopping;}finally{if(job.canceling===stopping)job.canceling=null;}
}
function retire(scope){
 const job=jobFor(scope);clearTimeout(job.retire);
 job.retire=setTimeout(()=>{if(!job.owners&&!job.listeners.size&&job.client)void cancel(scope,'workspace');},0);
}
// The App owns the job independently of transient draft/preparation/table views.
// This effect does not subscribe to progress or rerender the whole workspace.
export function useHazardCsvImportOwner(projectId,repoId){
 const scope=hazardCsvScope(projectId,repoId);
 useEffect(()=>{
  if(!projectId||!repoId)return undefined;
  const job=jobFor(scope);job.owners++;clearTimeout(job.retire);
  return()=>{job.owners--;retire(scope);};
 },[scope,projectId,repoId]);
}
async function prepare(scope,file,run,undo=false,operationalContexts){
 const job=jobFor(scope),version=++job.prepareVersion;
 await cancel(scope,'replace',false);if(version!==job.prepareVersion||(!job.listeners.size&&!job.owners))return;let owner;
 try{owner=client(progress=>{if(job.client===owner)publish(scope,{progress,message:progress.phase+'…'});},message=>{if(job.client===owner){job.client=null;void owner.dispose();publish(scope,{status:'error',message,plan:null,progress:null});}});}
 catch(error){publish(scope,{status:'error',message:error.message||'Unable to start CSV processing.',progress:null});return;}
 job.client=owner;
 publish(scope,{status:'reading',plan:null,progress:null,sourceFile:undo?null:{name:String(file?.name||'CSV file').slice(0,255),bytes:file?.size},message:undo?'Preparing previous CSV results…':'Reading and validating CSV…'});
 try{const plan={...await owner.request('prepare',{file,run,undo,operationalContexts}),undo:Boolean(undo)};if(job.client!==owner)return;
  if(!plan.changedRowCount && !undo){job.client=null;await owner.dispose();publish(scope,{status:'complete',message:'Every row already matches. Nothing was changed.',progress:null});return;}
  publish(scope,{status:'ready',plan,progress:null,message:undo?'Previous table validated. Restoring saved results…':'CSV validated. Review the changes and click Apply CSV import to save them.'});return plan;
 }catch(error){if(job.client!==owner)return;job.client=null;await owner.dispose().catch(()=>{});publish(scope,{status:'error',progress:null,message:error.message||'CSV validation failed.'});}
}
async function apply(scope,currentRun,commit,expectedRun,operationalContexts){
 const job=jobFor(scope),owner=job.client,plan=job.snapshot.plan;if(!owner||job.snapshot.status!=='ready')return;
 publish(scope,{status:'saving',progress:null,message:'Saving CSV updates…'});
 try{
  const result=await commit({csvImport:true,apply:(source,contexts)=>owner.request('apply',{currentRun:source||currentRun,operationalContexts:contexts ?? operationalContexts})},expectedRun);
  if(job.client!==owner)return;job.client=null;await owner.dispose().catch(()=>{});
  publish(scope,{status:'complete',plan:null,progress:null,message:result?.message||(plan.undo?'Restored the hazard table from before the last CSV import.':`Saved CSV updates to ${plan.changedRowCount.toLocaleString()} rows.${plan.conflictCount?` ${plan.conflictCount.toLocaleString()} classification/significance conflicts need review.`:''}`)});
 }catch(error){if(job.client!==owner)return;job.client=null;await owner.dispose().catch(()=>{});publish(scope,{status:'error',plan:null,progress:null,message:error.message||'CSV import could not be saved. Existing results were not replaced.'});}
}
export default function useHazardCsvImport(projectId,repoId,operationalContexts){
 const scope=hazardCsvScope(projectId,repoId);
 const subscribe=useCallback(listener=>{const job=jobFor(scope);job.listeners.add(listener);clearTimeout(job.retire);return()=>{job.listeners.delete(listener);retire(scope);};},[scope]);
 const snapshot=useSyncExternalStore(subscribe,useCallback(()=>jobFor(scope).snapshot,[scope]));
 return {...snapshot,active:['reading','ready','saving','canceling'].includes(snapshot.status),busy:['reading','saving','canceling'].includes(snapshot.status),
  prepare:(file,run,undo)=>prepare(scope,file,run,undo,operationalContexts),apply:(run,commit,expectedRun)=>apply(scope,run,commit,expectedRun,operationalContexts),cancel:()=>cancel(scope)};
}
