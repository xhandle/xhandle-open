import {openWorkspaceGraphDB} from '../../../src/features/workspace-graph/workspaceGraphDb';
import {migrateLegacyStorageToWorkspaceGraphIfStale} from '../../../src/features/workspace-graph/legacyWorkspaceGraphMigrator';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun} from '../../../src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore';
import requestHazardRows from '../../../src/features/code-architecture-hazard-analysis/requestHazardRows';
window.failures=[];
window.addEventListener('error',e=>window.failures.push(e.message));
window.addEventListener('unhandledrejection',e=>window.failures.push(String(e.reason)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
window.seed=async()=>{
 const count=26278;
 await saveCodeArchitectureHazardRun({id:'synthetic',projectId:'p',repoId:'repo',runState:'complete',generatedSheets:{Summary:[['Raw Analysis Row ID','Function','Hazard','Operational Scenario'],...Array.from({length:count},(_,i)=>['H-'+i,'Function '+(i%400),'Synthetic hazard '+i+' '+('saved evidence '.repeat(200)),'Scenario '+(i%20)])]}});
 const db=await openWorkspaceGraphDB();
 for(let offset=0;offset<4000;offset+=64){const tx=db.transaction('artifacts','readwrite');for(let i=offset;i<Math.min(4000,offset+64);i++)tx.store.put({id:'legacy-'+String(i).padStart(5,'0'),projectId:'p',type:'note',title:'Synthetic '+i,content:'Saved engineering context '.repeat(300)});await tx.done;}
 db.close();return {hazardRows:count,legacyArtifacts:4000};
};
window.run=async()=>{
 const run=await getLatestCodeArchitectureHazardRun({projectId:'p'},{workingSet:true,paged:true});
 const results=[];
 let peakHeap=0,maxDelay=0,last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last-50);last=now;peakHeap=Math.max(peakHeap,performance.memory.usedJSHeapSize);},50);
 try{
  for(const concurrent of [false,true]){
   let job=Promise.resolve(),projectionStarted;
   const started=new Promise(r=>{projectionStarted=r;});
   if(concurrent){job=migrateLegacyStorageToWorkspaceGraphIfStale({force:true,steps:[],projectIds:['p'],onProgress:v=>{if(v.step==='projection')projectionStarted();}});await Promise.race([started,job.then(()=>{throw Error('Indexing completed without repair');})]);await sleep(100);}
   const begin=performance.now();
   const read=requestHazardRows(run,{operation:'layout',search:'Synthetic hazard'});
   const samples=[];
   const db=await openWorkspaceGraphDB();
   for(let i=0;i<3 && concurrent;i++){await sleep(200);samples.push(await db.countFromIndex('artifactIndex','by_project','p'));}
   db.close();
   const layout=await read;const layoutMs=performance.now()-begin;
   if(layout.total!==26278)throw Error('Missing hazard rows');
   const page=await requestHazardRows(run,{offset:26200,limit:100});
   if(page.rows.at(-1)[0]!=='H-26277'||page.rows.length!==78)throw Error('Missing final page');
   await job;
   const verified=await openWorkspaceGraphDB();const indexed=await verified.countFromIndex('artifactIndex','by_project','p');verified.close();
   if(concurrent&&indexed!==4000)throw Error('Incomplete resumed index');
   results.push({concurrent,layoutMs,tableRows:layout.total,indexCountsDuringTableRead:samples,indexedAfterResume:indexed,outlineBytes:layout.metadataBytes});
  }
 }finally{clearInterval(timer);}
 return {results,peakRendererHeapMiB:peakHeap/1048576,maxRendererEventLoopDelayMs:maxDelay,failures:window.failures};
};
window.retained=()=>{window.gc?.();return performance.memory.usedJSHeapSize/1048576;};
