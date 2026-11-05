import {codeSourceIndexPrefix} from '../code-architecture-context/codeSourceIdentity';
import {openWorkspaceGraphDB} from './workspaceGraphDb';
import createWorker from './createWorkspaceReadWorker';
import {executeWorkspaceReadPlanCore} from './workspaceReadCore';
import {withWorkspaceGraphMigrationPaused} from './workspaceGraphIndexLock';
import {workspaceGraphSourceSnapshot,sameWorkspaceGraphSources} from './workspaceGraphFreshness';
const cache=new Map<string,{results:any[];at:number;size:number}>();
let cacheSources:any=null,cacheRevision:any=null;
export function clearWorkspaceReadCache(){cache.clear();cacheSources=null;cacheRevision=null;}
export async function executeWorkspaceReadPlan(calls:any[],policy:any,{signal,timeoutMs=8000,onTiming=(_value:any)=>{}}:{signal?:AbortSignal;timeoutMs?:number;onTiming?:(value:any)=>void}={}){
 const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Workspace read cancelled.','AbortError');};
 const started=performance.now();let hit=false;
 const timed=()=>{try{onTiming({stage:"readExecution",durationMs:performance.now()-started,cacheHit:hit});}catch{}};
 check();const job=withWorkspaceGraphMigrationPaused(async()=>{
  check();const before=workspaceGraphSourceSnapshot();
  const db=await openWorkspaceGraphDB();const revision=(await db.get('workspaces','graph-data-revision'))?.token;db.close();
  if(!cacheSources||!sameWorkspaceGraphSources(cacheSources,before)||cacheRevision!==revision){cache.clear();cacheSources=before;cacheRevision=revision;}
  const key=JSON.stringify({calls,timeoutMs,policy:{projectIds:policy.projectIds,repoId:policy.repoId,repoIds:policy.repoIds,runId:policy.runId,types:policy.types,historyAllowed:policy.historyAllowed,query:policy.query,projects:(policy.projects||[]).map((project:any)=>({id:project.id,repos:(project.repos||[]).map((repo:any)=>({id:repo.id,repoId:repo.repoId,repoName:repo.repoName,prefix:codeSourceIndexPrefix(repo)}))}))}});const cached=cache.get(key);
  if(cached&&Date.now()-cached.at<30000&&sameWorkspaceGraphSources(before,workspaceGraphSourceSnapshot())){check();hit=true;return JSON.parse(JSON.stringify(cached.results));}
  const results=typeof Worker==='undefined'||typeof navigator==='undefined'||!navigator.locks
   ? await executeWorkspaceReadPlanCore(calls,policy,{signal,timeoutMs})
   : await new Promise<any[]>((resolve,reject)=>{
    const worker=createWorker();let finished=false;
    const finish=(error:any,value?:any)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(signal?.reason||new DOMException('Workspace read cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(Error('Workspace read timed out. Narrow the requested scope.')),Math.min(timeoutMs,12000)+1000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    worker.onerror=event=>finish(Error(event.message||'Workspace read worker failed.'));
    worker.onmessage=({data})=>data.type==='done'?finish(null,data.results):finish(Object.assign(Error(data.message),{name:data.name}));
    try{worker.postMessage({calls,policy,timeoutMs});}catch(error){finish(error);}
   });
  check();if(!sameWorkspaceGraphSources(before,workspaceGraphSourceSnapshot()))for(const result of results){result.coverage={...result.coverage,complete:false,state:'stale',reason:'Saved workspace sources changed during this read.'};if('count' in result)result.count=null;}
  const encoded=JSON.stringify(results);
  if(results.every(result=>result.coverage?.complete)&&(encoded.length+key.length)*2<=200000){
   cache.set(key,{results:JSON.parse(encoded),at:Date.now(),size:(encoded.length+key.length)*2});
   while(cache.size>4||[...cache.values()].reduce((sum,item)=>sum+item.size,0)>200000)cache.delete(cache.keys().next().value);
  }
  return results;
 },12000).finally(timed);
 if(!signal)return job;
 return new Promise<any[]>((resolve,reject)=>{
  const stop=()=>reject(signal.reason||new DOMException('Workspace read cancelled.','AbortError'));
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  job.then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
 });
}
