import createWorker from './createWorkspaceGraphWorker';
import { runWorkspaceGraphIndexPass, getLatestWorkspaceGraphMigrationDiagnostics, WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY, type MigrationOptions, type WorkspaceIndexProgress } from './workspaceGraphMigrationCore';
import { withWorkspaceGraphMigrationPaused } from './workspaceGraphIndexLock';
import { workspaceGraphSourceSnapshot, sameWorkspaceGraphSources } from './workspaceGraphFreshness';
import {subscribeForegroundStoragePriority} from '../../lib/foregroundStoragePriority';
export { withWorkspaceGraphMigrationPaused, getLatestWorkspaceGraphMigrationDiagnostics, WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY };
type Options=MigrationOptions & {maxAgeMs?:number;background?:boolean};
let cached:{snapshot:ReturnType<typeof workspaceGraphSourceSnapshot>;at:number;result:any}|null=null;
let active:{promise:Promise<any>;controller:AbortController;waiters:number;foregroundWaiters:number;background:boolean;listeners:Set<(value:WorkspaceIndexProgress)=>void>;latest?:WorkspaceIndexProgress}|null=null;
let foregroundTurns=0;
export function pauseBackgroundWorkspaceIndexing(){
 foregroundTurns++;
 if(active?.background&&!active.foregroundWaiters)active.controller.abort();
 let released=false;
 return()=>{if(!released){released=true;foregroundTurns--;}};
}
const covers=(result:any,steps?:string[],projectIds?:string[])=>!(result.deferredSteps||[]).some((step:string)=>!steps||steps.includes(step))&&(!result.projectIds?.length||(Boolean(projectIds?.length)&&projectIds!.every(id=>result.projectIds.includes(id))));
const aborted=(signal?:AbortSignal)=>{if(signal?.aborted)throw signal.reason||new DOMException('Workspace indexing cancelled.','AbortError');};
function workerPass(options:Options,snapshot:ReturnType<typeof workspaceGraphSourceSnapshot>,signal:AbortSignal):Promise<any>{
 if(typeof Worker==='undefined'||typeof navigator==='undefined'||!navigator.locks)return runWorkspaceGraphIndexPass({...options,signal});
 return new Promise((resolve,reject)=>{
  const worker=createWorker();let finished=false;
  let unsubscribe=()=>{};
  let timer:ReturnType<typeof setTimeout>|undefined;
  let remainingMs=300000,startedAt=0;
  let lastBusy=false;
  const finish=(error:any,value?:any)=>{if(finished)return;finished=true;clearTimeout(timer);unsubscribe();signal.removeEventListener('abort',stop);worker.terminate();error?reject(error):resolve(value);};
  const stop=()=>finish(signal.reason||new DOMException('Workspace indexing cancelled.','AbortError'));
  const priority=(busy:boolean)=>{
   if(finished)return;
   if(timer!==undefined){clearTimeout(timer);timer=undefined;remainingMs=Math.max(0,remainingMs-(Date.now()-startedAt));}
   if(!busy){startedAt=Date.now();timer=setTimeout(()=>finish(new Error('Workspace background indexing timed out. Retry the question.')),remainingMs);}
   if(busy!==lastBusy){lastBusy=busy;try{worker.postMessage({type:'foreground-storage',busy});}catch(error){finish(error);}}
  };
  signal.addEventListener('abort',stop,{once:true});
  if(signal.aborted){stop();return;}
  worker.onerror=(event)=>finish(new Error(event.message||'Workspace indexing worker failed.'));
  worker.onmessage=({data})=>{if(data.type==='done')finish(null,data.result);else if(data.type==='progress'){try{options.onProgress?.(data.value);}catch{}}else if(data.type==='error')finish(Object.assign(new Error(data.message),{name:data.name||'Error'}));};
  unsubscribe=subscribeForegroundStoragePriority(priority);
  if(finished){unsubscribe();return;}
  try{worker.postMessage({options:{mode:options.mode,force:options.force,steps:options.steps,projectIds:options.projectIds},values:[...snapshot.values]});}catch(error){finish(error);}
 });
}
function start(options:Options){
 const controller=new AbortController();
 const slot:NonNullable<typeof active>={promise:null as any,controller,waiters:0,foregroundWaiters:0,background:Boolean(options.background),listeners:new Set(),latest:{step:'waiting',durationMs:0,complete:false}};
 const onProgress=(value:WorkspaceIndexProgress)=>{slot.latest=value;for(const listener of slot.listeners){try{listener(value);}catch{}}};
 slot.promise=withWorkspaceGraphMigrationPaused(async()=>{
  aborted(controller.signal);cached=null;
  // Capture sources after acquiring the deletion lock, never from a queued stale snapshot.
  const snapshot=workspaceGraphSourceSnapshot();
  const result=await workerPass({...options,onProgress},snapshot,controller.signal);
  result.sourceChangedDuringMigration ||= !sameWorkspaceGraphSources(snapshot,workspaceGraphSourceSnapshot());
  if(!result.errors?.length&&!result.sourceChangedDuringMigration)cached={snapshot,at:Date.now(),result};
  try{localStorage.setItem(WORKSPACE_GRAPH_MIGRATION_DIAGNOSTICS_KEY,JSON.stringify(result));}catch{}
  return result;
 }).finally(()=>{if(active===slot)active=null;});
 active=slot;return slot;
}
async function wait(slot:NonNullable<typeof active>,signal?:AbortSignal,background=false,onProgress?:Options["onProgress"]){
 aborted(signal);slot.waiters++;
 if(onProgress){slot.listeners.add(onProgress);if(slot.latest){try{onProgress(slot.latest);}catch{}}}
 if(!background)slot.foregroundWaiters++;
 let stop:()=>void=()=>{};
 try{return await Promise.race([slot.promise,new Promise<never>((_,reject)=>{
  stop=()=>reject(signal?.reason||new DOMException('Workspace query cancelled.','AbortError'));signal?.addEventListener('abort',stop,{once:true});
 })]);}
 finally{if(onProgress)slot.listeners.delete(onProgress);signal?.removeEventListener('abort',stop);slot.waiters--;if(!background)slot.foregroundWaiters--;if(signal?.aborted&&!slot.waiters&&!slot.background)slot.controller.abort();}
}
export async function migrateLegacyStorageToWorkspaceGraphIfStale(options:Options={}){
 for(let attempt=0;;attempt++){
  aborted(options.signal);const snapshot=workspaceGraphSourceSnapshot();
  if(!options.force&&options.mode!=='full'&&cached&&covers(cached.result,options.steps,options.projectIds)&&sameWorkspaceGraphSources(cached.snapshot,snapshot)&&Date.now()-cached.at<(options.maxAgeMs??Infinity))return {...cached.result,skipped:true,skipReason:'fresh'};
  let result:any;
  try{result=await wait(active||start(options),options.signal,options.background,options.onProgress);}
  catch(error:any){if(error?.name==='AbortError'&&!options.background&&!options.signal?.aborted&&attempt<1)continue;throw error;}
  if(!covers(result,options.steps,options.projectIds))continue;
  if(attempt>=1||result.errors?.length||!result.sourceChangedDuringMigration)return result;
 }
}
export function migrateLegacyStorageToWorkspaceGraph(options:Options={}){return migrateLegacyStorageToWorkspaceGraphIfStale({...options,force:true});}
// Indexing is demand-driven by a governed Collaborator read or explicit edit.
// App startup, navigation and source-change notifications must not launch a
// workspace-wide scan competing with diagrams/tables for storage and memory.
