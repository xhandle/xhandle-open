const repo=require('__REPO__/src/features/workspace-graph/workspaceGraphRepository.ts');
const {openWorkspaceGraphDB}=require('__REPO__/src/features/workspace-graph/workspaceGraphDb.ts');
const {migrateLegacyStorageToWorkspaceGraphIfStale:sync}=require('__REPO__/src/features/workspace-graph/legacyWorkspaceGraphMigrator.ts');
const {buildWorkspaceLLMContext}=require('__REPO__/src/features/workspace-graph/workspaceGraphContextBuilder.ts');
const {notifyBackupDataChanged}=require('__REPO__/src/lib/localBackupEvents.js');
const {saveGeneratedReport,deleteGeneratedReport}=require('__REPO__/src/features/project-hazard-analysis/generatedReportStorage.js');
const {buildScopedContext,renderCopilotContext}=require('./extracted');
const {openDB}=require('idb');
const assert=(v,m)=>{if(!v)throw Error(m);};
const force=()=>sync({force:true});
window.audit=async()=>{
 const result={runtime:navigator.userAgent,workerAvailable:typeof Worker!=='undefined',locksAvailable:!!navigator.locks,checks:[],warm:[]};let workers=0;const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);workers++;}};const pass=m=>result.checks.push(m);
 localStorage.setItem('xhandle.projects',JSON.stringify(Array.from({length:31},(_,i)=>({id:'p'+i,name:'Project '+i}))));
 const req=title=>localStorage.setItem('xhandle:requirements',JSON.stringify([{id:'REQ-1',projectId:'p0',title}]));
 req('Alpha');await force();req('Bravo');await sync();
 assert((await repo.listArtifacts({type:'requirement'}))[0].title==='Bravo','equal-length edit stale');pass('equal-length edit fresh');
 localStorage.setItem('xhandle:requirements','[]');await sync();assert(!(await repo.listArtifacts({type:'requirement'})).length,'deleted requirement retained');pass('deleted source pruned');
 req('Keep me');await sync();localStorage.setItem('xhandle:requirements','{broken');const failed=await sync();assert(failed.errors.length&&(await repo.listArtifacts({type:'requirement'}))[0].title==='Keep me','failed source lost evidence');pass('failed source preserves evidence');req('Fixed');
 const a=await saveGeneratedReport('p0',{title:'Alpha report',report:'# Alpha report',functionalDiagramImage:'data:image/png;base64,SECRET_IMAGE'});
 const b=await saveGeneratedReport('p0',{title:'Bravo report',report:'# Bravo report',status:'draft'});await sync();
 let reports=await repo.listArtifacts({type:'generated_report'});assert(reports.length===2&&!JSON.stringify(reports).includes('SECRET_IMAGE'),'report index missing/contains image');pass('report versions indexed without images');
 await deleteGeneratedReport('p0',a.libraryId);await sync();reports=await repo.listArtifacts({type:'generated_report'});assert(reports.length===1&&reports[0].sourceId===b.libraryId,'deleted report retained');pass('deleted report removed');
 localStorage.setItem('xhandle:vnv-test-case-documents',JSON.stringify([{id:'doc',projectId:'p0',testCases:[{id:'T-1',title:'Brake test'}]}]));await sync();assert((await repo.listArtifacts({type:'test_case'})).length===1,'test missing');pass('System Test document indexed');
 const db=await openDB('xhandle-code-architecture-assurance',1,{upgrade(db){db.createObjectStore('artifactRows',{keyPath:'key'});}});const key='xhandle:cba-software-requirements:p0:repo';
 await db.put('artifactRows',{key,rows:[{id:'SW-1',title:'CBA software requirement'}]});notifyBackupDataChanged();await sync();
 let context=await buildWorkspaceLLMContext({projectId:'p0',query:'requirements',areas:['requirements'],tokenBudget:5000});assert(context.relevantArtifacts.some(r=>r.type==='code_architecture_software_requirement'),'CBA scope excludes requirement');assert(context.workspaceSummary.projectCount===31,'wrong project count');pass('CBA requirements scope and project totals');
 await db.clear('artifactRows');notifyBackupDataChanged();await sync();db.close();assert(!(await repo.listArtifacts({type:'code_architecture_software_requirement'})).length,'IDB deletion stale');pass('committed IndexedDB changes fresh');
 for(const n of [1000,10000,27125]){
  const graph=await openWorkspaceGraphDB();await graph.clear('artifacts');await graph.clear('relationships');await graph.clear('artifactIndex');const tx=graph.transaction(['artifacts','relationships'],'readwrite');
  for(let i=0;i<n;i++){const p=i%2?'p0':'p1';tx.objectStore('artifacts').put({id:'a-'+i,projectId:p,type:'code_architecture_hazard_row',title:'hazard '+i,summary:'Synthetic hazard evidence',structuredData:{padding:'x'.repeat(2048),finding:'braking failure '+i},updatedAt:'2026-11-04',version:1});tx.objectStore('relationships').put({id:'r-'+i,projectId:p,type:'contains',fromArtifactId:'p-'+p,toArtifactId:'a-'+i});}await tx.done;graph.close();await force();
  const samples=[];for(let i=0;i<30;i++){
   let reads=0;const getAll=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(...args){if(this.name==='artifacts')throw Error('Warm query read full bodies');return getAll.apply(this,args);};const begin=performance.now();
   try{context=await buildWorkspaceLLMContext({projectId:'p0',query:'hazard',areas:['risk'],tokenBudget:9000});assert(context.diagnostics.migration.skipped,'warm migration not skipped');const scoped=buildScopedContext(context,{areas:['risk']});assert(scoped.relevantArtifacts.length===36,'hazard scope dropped evidence');const prompt=renderCopilotContext(scoped);const sample=JSON.parse(prompt.split('Canonical graph sample (truncated):\n')[1]);assert(sample.relevantArtifacts.every(row=>sample.citations.some(c=>c.artifactId===row.id)),'lost citations');samples.push({elapsedMs:Math.round((performance.now()-begin)*10)/10,artifactStoreReads:reads,candidates:scoped.relevantArtifacts.length,promptRecords:sample.relevantArtifacts.length});}finally{IDBObjectStore.prototype.getAll=getAll;}
  }result.warm.push({n,samples});
 }result.workerStarts=workers;assert(workers>0,'Real indexing worker was not exercised');result.heap=performance.memory?{usedBytes:performance.memory.usedJSHeapSize,totalBytes:performance.memory.totalJSHeapSize}:null;pass('scope/citation correctness and zero artifact-body reads at all fixture sizes');return result;
};
const {executeWorkspaceReadPlan}=require('__REPO__/src/features/workspace-graph/workspaceReadClient.ts');
const {prepareWorkspaceReadEvidence}=require('__REPO__/src/features/workspace-graph/workspaceReadSession.js');
const originalAudit=window.audit;
window.audit=async()=>{
 const result=await originalAudit();
 const db=await openWorkspaceGraphDB();for(const name of ['artifacts','artifactIndex','relationships'])await db.clear(name);db.close();
 const total=27125;
 for(let start=0;start<total;start+=128)await repo.upsertArtifacts(Array.from({length:Math.min(128,total-start)},(_,n)=>{
  const i=start+n;return {id:'req-'+String(i).padStart(6,'0'),type:'requirement',projectId:'p0',title:'Requirement '+i,content:'x'.repeat(2200)+(i===total-1?' UNIQUE_DEEP_LAST_ROW':''),structuredData:{Severity:i%2?'High':'Low'},createdAt:'2026-11-04',updatedAt:'2026-11-04'};
 }));
 let readWorkers=0;const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);readWorkers++;}};
 const policy={projectIds:['p0'],projects:[{id:'p0',repos:[]}],types:['requirement'],repoId:null,historyAllowed:false,query:'requirements'};
 let last=performance.now(),maxGap=0;const heartbeat=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
 const samples=[];
 try{
  for(const call of [{operation:'aggregate',limit:2},{operation:'search',query:'UNIQUE_DEEP_LAST_ROW',limit:2},{operation:'aggregate',groupBy:'Severity',limit:2}]){
   const begin=performance.now();const [read]=await executeWorkspaceReadPlan([call],policy,{timeoutMs:12000});
   assert(read.coverage.complete,'Incomplete native scan: '+JSON.stringify(read.coverage));
   if(call.operation==='search'){assert(read.coverage.matched===1&&read.rows[0].id==='req-027124','Deep last-row search failed');assert(read.rows[0].matchExcerpt.includes('UNIQUE_DEEP_LAST_ROW'),'Matching late text omitted');}
   else{assert(read.count===total,'Wrong complete-dataset count');if(call.groupBy)assert(read.groups.reduce((sum,g)=>sum+g.count,0)===total,'Groups lost rows');}
   samples.push({operation:call.operation,groupBy:call.groupBy||null,elapsedMs:Math.round(performance.now()-begin),scanned:read.coverage.scanned,matched:read.coverage.matched});
  }
 }finally{clearInterval(heartbeat);}
 assert(readWorkers===3,'Read tools did not run in real workers');
 let plannerCalls=0;
 const evidence=await prepareWorkspaceReadEvidence({query:'How many requirements are there?',areas:['requirements'],context:{scope:{projectId:'p0'},diagnostics:{migration:{errors:[]}}},requestPlan:()=>{plannerCalls++;throw Error('Unexpected planner call');}});
 assert(plannerCalls===0&&evidence.results[0].count===total,'Simple count did not bypass model planning');
 result.targetedReads={records:total,readWorkers,plannerCalls,maxHeartbeatGapMs:Math.round(maxGap),samples};return result;
};
