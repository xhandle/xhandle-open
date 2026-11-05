const {openDB}=require('idb');
const {saveCodeArchitectureHazardRun}=require('__REPO__/src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js');
const {saveArtifactRowsAsync}=require('__REPO__/src/features/code-architecture-assurance/artifactUtils.js');
const {migrateLegacyStorageToWorkspaceGraphIfStale:sync,pauseBackgroundWorkspaceIndexing}=require('__REPO__/src/features/workspace-graph/legacyWorkspaceGraphMigrator.ts');
const {executeWorkspaceReadPlan}=require('__REPO__/src/features/workspace-graph/workspaceReadClient.ts');
const {buildWorkspaceLLMContext}=require('__REPO__/src/features/workspace-graph/workspaceGraphContextBuilder.ts');
const assert=(value,message)=>{if(!value)throw Error(message);};
window.audit=async()=>{
 const result={runtime:navigator.userAgent,sourceFiles:5500,currentHazards:27125,historyHazards:10000,sourcePayloadBytes:0,measurements:[],peakHeapBytes:0,maxHeartbeatGapMs:0};
 let previous=performance.now();const meter=setInterval(()=>{const now=performance.now();result.maxHeartbeatGapMs=Math.max(result.maxHeartbeatGapMs,now-previous);previous=now;result.peakHeapBytes=Math.max(result.peakHeapBytes,performance.memory?.usedJSHeapSize||0);},50);
 const phase=async(name,operation)=>{console.log('ACCEPTANCE_PHASE',name);const started=performance.now();const value=await operation();result.measurements.push({name,elapsedMs:Math.round(performance.now()-started),heapBytes:performance.memory?.usedJSHeapSize});return value;};
 try{
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'scale',name:'Scale fixture',repos:[{id:'owner/repo',owner:'owner',repo:'repo'}]}]));
  await phase('seed-5500-source-records',async()=>{
   const db=await openDB('xhandle',4,{upgrade(db){db.createObjectStore('code_index',{keyPath:'key'});}});
   const length=Math.floor(600*1024*1024/5500),padding='// Synthetic source evidence.\n'.repeat(Math.ceil(length/30)).slice(0,length);
   for(let start=0;start<5500;start+=16){const tx=db.transaction('code_index','readwrite');for(let i=start;i<Math.min(5500,start+16);i++){
    const content=padding+'\nSOURCE_MARKER_'+i;result.sourcePayloadBytes+=content.length;
    tx.store.put({key:'code:file:owner/repo:src/file_'+i+'.cpp',value:{path:'src/file_'+i+'.cpp',projectId:'scale',repoId:'owner/repo',lang:'cpp',content,updatedAt:'2026-11-04T12:00:00Z'}});
   }await tx.done;await new Promise(resolve=>setTimeout(resolve,0));}db.close();
  });
  await phase('seed-hazards-and-history',async()=>{
   for(const [id,count,date] of [['old-a',5000,'2026-11-01'],['old-b',5000,'2026-11-02'],['current',27125,'2026-11-04']]){
    const Summary=[['Raw Analysis Row ID','Function (From)','Hazard','Mitigation Strategy'],...Array.from({length:count},(_,i)=>['H-'+i,'Function '+i%100,'Unsafe condition '+i,'Validate command state. '.repeat(16)])];
    await saveCodeArchitectureHazardRun({id,projectId:'scale',repoId:'owner/repo',hazardMethod:'STPA',status:'complete',runState:'complete',updatedAt:date+'T12:00:00Z',createdAt:date+'T12:00:00Z',generatedSheets:{Summary}},{notify:false});
   }
  });
  await phase('seed-requirements',()=>saveArtifactRowsAsync('software-requirements','scale','owner/repo',Array.from({length:5500},(_,i)=>({id:'SW-'+i,requirementText:'The software shall reject stale commands '+i+'.',source:'manual'}))));
  const focused=await phase('first-software-requirements-context',()=>buildWorkspaceLLMContext({projectId:'scale',query:'Show all software requirements'}));
  assert(!focused.diagnostics.migration.errors.length,'Focused index failed');
  assert(focused.diagnostics.migration.deferredSteps.includes('indexedFeatureStores')&&focused.diagnostics.migration.deferredSteps.includes('codeIndex'),'Unrelated domains were indexed');
  const [requirements]=await phase('software-requirements-count',()=>executeWorkspaceReadPlan([{operation:'aggregate',types:['code_architecture_software_requirement']}],{projectIds:['scale'],projects:[{id:'scale'}],types:['code_architecture_software_requirement'],query:'How many software requirements are there?'},{timeoutMs:12000}));assert(requirements.count===5500&&requirements.coverage.complete,'Requirements count was incomplete');
  let indexingStarted;const ready=new Promise(resolve=>{indexingStarted=resolve;});
  const interrupted=sync({background:true,steps:['indexedFeatureStores'],onProgress:value=>{if(!value.complete)indexingStarted();}}).then(()=>({completed:true}),error=>({name:error.name}));
  await ready;
  const resume=pauseBackgroundWorkspaceIndexing();
  try {
   const outcome=await interrupted;assert(outcome.name==='AbortError','Background indexing did not yield to foreground retrieval');
   await phase('focused-context-after-background-interruption',()=>buildWorkspaceLLMContext({projectId:'scale',query:'Show all software requirements'}));
  } finally {resume();}
  const indexed=await phase('remaining-cold-index',()=>sync({onProgress:value=>console.log('INDEX_STEP',JSON.stringify(value))}));result.indexStepDurationsMs=indexed.stepDurationsMs;result.indexMaintenanceDurationsMs=indexed.maintenanceDurationsMs;assert(!indexed.errors.length,'Index errors: '+JSON.stringify(indexed.errors));
  const policy={projectIds:['scale'],projects:[{id:'scale',repos:[{id:'owner/repo',owner:'owner',repo:'repo'}]}],types:['code_architecture_hazard_row'],repoId:'owner/repo',repoIds:['owner/repo'],historyAllowed:false,query:'hazards'};
  const [count]=await phase('current-hazard-count',()=>executeWorkspaceReadPlan([{operation:'aggregate'}],policy,{timeoutMs:12000}));assert(count.count===27125&&count.coverage.complete,'Current run count failed: '+JSON.stringify(count.coverage));
  const [history]=await phase('history-hazard-count',()=>executeWorkspaceReadPlan([{operation:'aggregate',history:'all'}],{...policy,historyAllowed:true},{timeoutMs:12000}));assert(history.count===37125&&history.coverage.complete,'History count failed');
  const offset=Math.floor(600*1024*1024/5500)+1;
  const [source]=await phase('last-source-deep-read',()=>executeWorkspaceReadPlan([{operation:'source',path:'src/file_5499.cpp',offset}],{...policy,types:[]},{timeoutMs:12000}));assert(source.excerpt.text.includes('SOURCE_MARKER_5499'),'Late source evidence unavailable');
  for(let i=0;i<5;i++)await phase('warm-context-'+i,()=>buildWorkspaceLLMContext({projectId:'scale',query:'hazards',areas:['risk'],tokenBudget:9000}));
  result.storage=await navigator.storage.estimate();result.ok=true;return result;
 }finally{clearInterval(meter);}
};
