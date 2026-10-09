// Isolated native IndexedDB regression. No customer browser profile or network/AI.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH || '/tmp/xhandle-copy-check/node_modules/playwright-core');
const parser=require('@babel/parser');
const sources=['src/features/code-architecture-storage/chunkedRecord.js','src/features/code-architecture-assurance/codeArchitectureStorage.js'];
const code=sources.map(file=>{
 const source=fs.readFileSync(path.join(root,file),'utf8');
 return parser.parse(source,{sourceType:'module'}).program.body.filter(n=>n.type!=='ImportDeclaration').map(n=>source.slice(n.type==='ExportNamedDeclaration'?n.declaration.start:n.start,n.end)).join('\n');
}).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Isolated capacity fixture</title>'}));
  await page.goto('http://localhost:3000/isolated-cba-capacity');
  await page.evaluate(code=>{window.api=new Function('const notifyBackupDataChanged=()=>{};'+code+';return {readFirstCbaRowsFromIndexedDB,openCbaIndexedDB,readRecord,rawRecord,writeRecord,stageRecord,putRawRecord,readCbaRowsFromIndexedDB,writeCbaRowsToIndexedDB,writeImportedArchitectureRunRecords,prepareArchitecturePublication,recoverArchitecturePublication,readLatestArchitectureCheckpoint,readArchitectureCheckpoint};')();},code);
  const result=await page.evaluate(async()=>{
   const a=window.api, db=await a.openCbaIndexedDB(), store='copilot_baseline', timings=[];
   // Shared evidence exceeds the previous logical JSON size limit; values remain fully hydrated.
   const evidence={content:'source evidence café 车辆 '.repeat(6000),sourceFunctions:[{functionName:'call',startLine:1,endLine:4}]};
   let previous=[];
   const key='cba:fixture:repo',checkpoint=`functional-decomposition-checkpoint:${key}:ready`;
   for(const count of [50,150,300]) {
    const rows=Array.from({length:count},(_,i)=>({traceId:`row-${i}`,from:`caller${i}`,action:'Call',to:'callee',codeEvidence:{files:[evidence]},sourceEvidence:{functions:evidence.sourceFunctions}}));
    const run={version:1,fingerprint:String(count).padStart(64,'0'),scope:key,publishedAt:new Date().toISOString()};
    const start=performance.now();
    await a.prepareArchitecturePublication(key,rows,run,{selectedFiles:count},checkpoint,previous);
    const ready=await a.readLatestArchitectureCheckpoint(key);
    if(!ready?.publicationReady)throw new Error('Ready checkpoint is invisible');
    const saved=await a.recoverArchitecturePublication(key,checkpoint);
    const reloaded=await a.readCbaRowsFromIndexedDB(key);
    if(reloaded.length!==count || reloaded[count-1].codeEvidence.files[0].content!==evidence.content)throw new Error('Evidence lost');
    const stored=await a.rawRecord(db,store,key);
    timings.push({count,logicalBytes:new TextEncoder().encode(JSON.stringify(rows)).length,elapsedMs:Math.round(performance.now()-start),chunksWritten:stored.chunksWritten,approxBytesWritten:stored.bytesWritten});
    previous=saved.rows;
   }
   const independent=await a.readCbaRowsFromIndexedDB(key);
   independent[0].codeEvidence.files[0].sourceFunctions[0].functionName='edited';
   if(independent[1].codeEvidence.files[0].sourceFunctions[0].functionName!=='call')throw new Error('Shared storage leaked mutable row changes');
   // Native storage records whose serialized payload exceeds the old 128 MiB aggregate cap.
   for(let i=0;i<520;i+=8) {
    await new Promise((resolve,reject)=>{
     const tx=db.transaction(store,'readwrite');
     for(let j=i;j<i+8;j++)tx.objectStore(store).put({key:`cba:unrelated:bulk:${j}`,value:`${j}:`+'x'.repeat(256*1024)});
     tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
   }
   const exported=JSON.parse(JSON.stringify(previous));
   await a.writeImportedArchitectureRunRecords('cba:imported:repo',[],exported);
   if((await a.readCbaRowsFromIndexedDB('cba:imported:repo'))[0].codeEvidence.files[0].content!==evidence.content)throw new Error('Portable import lost evidence');
   // Exercise >128 MiB of unrelated logical architecture using separately scoped copies.
   for(let i=0;i<4;i++)await a.writeCbaRowsToIndexedDB(`cba:other${i}:repo`,previous);
   await a.putRawRecord(db,store,'cba:legacy:repo',[{traceId:'legacy',manual:'keep'}]);
   if((await a.readCbaRowsFromIndexedDB('cba:legacy:repo'))[0].manual!=='keep')throw new Error('Legacy read failed');
   await a.writeRecord(db,store,'functional-decomposition-checkpoint:cba:old:repo:run',{completedPaths:['done.py'],totalFiles:1,failedFiles:[],rows:[{from:'legacy'}],updatedAt:new Date().toISOString()});
   if(!(await a.readLatestArchitectureCheckpoint('cba:old:repo')))throw new Error('Legacy complete extraction is invisible');
   // Old tree encoding (separate small-object chunk) must compare equal to
   // the new inline representation when the hydrated architecture is unchanged.
   {
   const oldKey='cba:old-encoding:repo', oldCheckpoint=`functional-decomposition-checkpoint:${oldKey}:run`;
   const oldRows=[{traceId:'old-shape',from:'Read',to:'Apply',action:'Data'}];
   const oldRowRecord=await a.stageRecord(db,store,oldKey,oldRows[0]);
   const oldRoot=oldKey+':$part:old-array-root';
   await a.putRawRecord(db,store,oldRoot,JSON.stringify(['array',[{ref:oldRowRecord.root}]]));
   await a.putRawRecord(db,store,oldKey,{...oldRowRecord,root:oldRoot});
   const replacement=[{traceId:'replacement'}], oldRun={version:1,fingerprint:'a'.repeat(64)};
   await a.prepareArchitecturePublication(oldKey,replacement,oldRun,{},oldCheckpoint,await a.readCbaRowsFromIndexedDB(oldKey));
   await a.recoverArchitecturePublication(oldKey,oldCheckpoint);
   if((await a.readCbaRowsFromIndexedDB(oldKey))[0].traceId!=='replacement')throw new Error('Unchanged old encoding caused a false conflict');
   // A real pre-staging conflict retains BOTH the edit and a durable completed checkpoint.
   await a.writeCbaRowsToIndexedDB(oldKey,[{traceId:'manual-edit'}]);
   let stagingConflict=false;
   try {await a.prepareArchitecturePublication(oldKey,replacement,oldRun,{},oldCheckpoint,oldRows);}
   catch(error){stagingConflict=error.code==='SOURCE_PUBLICATION_CONFLICT';}
   const retained=await a.readArchitectureCheckpoint(oldCheckpoint);
   if(!stagingConflict || retained.durable===false || retained.rows[0].traceId!=='replacement' ||
      (await a.readCbaRowsFromIndexedDB(oldKey))[0].traceId!=='manual-edit')throw new Error('Real edit or completed checkpoint lost');
   }
   // A reload uses only durable ready records, not in-memory run state.
   // Fail native publication transaction after some puts: no partially published pointer.
   const next=[{traceId:'next'}], run={version:1,fingerprint:'f'.repeat(64),publishedAt:new Date().toISOString()};
   await a.prepareArchitecturePublication(key,next,run,{selectedFiles:1},checkpoint,previous);
   const before=(await a.rawRecord(db,store,key)).root;
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(value){if(value.key===`${key}:run`) {const request=put.call(this,value);this.transaction.abort();return request;}return put.call(this,value);};
   let failed=false;try{await a.recoverArchitecturePublication(key,checkpoint);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
   if(!failed || (await a.rawRecord(db,store,key)).root!==before || !(await a.readLatestArchitectureCheckpoint(key)))throw new Error('Atomic abort failed');
   await a.recoverArchitecturePublication(key,checkpoint);
   if((await a.readCbaRowsFromIndexedDB(key))[0].traceId!=='next')throw new Error('Save retry failed');
   // Concurrent edit must win over a previously staged publication.
   await a.prepareArchitecturePublication(key,[{traceId:'stale'}],run,{},checkpoint,next);
   await a.writeCbaRowsToIndexedDB(key,[{traceId:'edited',manual:'keep'}]);
   let conflict=false;try{await a.recoverArchitecturePublication(key,checkpoint);}catch(e){conflict=e.code==='SOURCE_PUBLICATION_CONFLICT';}
   if(!conflict || (await a.readCbaRowsFromIndexedDB(key))[0].manual!=='keep')throw new Error('Concurrent edits overwritten');
   // Real DOMException quota path retains previous publication and memory export.
   IDBObjectStore.prototype.put=function(value){if(value.key.startsWith('cba:quota:'))throw new DOMException('Synthetic quota exhaustion','QuotaExceededError');return put.call(this,value);};
   const quotaKey='cba:quota:repo',quotaCheckpoint=`functional-decomposition-checkpoint:${quotaKey}:run`;
   let quota=false;try{await a.prepareArchitecturePublication(quotaKey,next,run,{},quotaCheckpoint,[]);}catch(e){quota=e.name==='QuotaExceededError';}finally{IDBObjectStore.prototype.put=put;}
   if(!quota || (await a.readArchitectureCheckpoint(quotaCheckpoint)).durable!==false)throw new Error('Quota recovery unavailable');
   await a.recoverArchitecturePublication(quotaKey,quotaCheckpoint);
   await a.prepareArchitecturePublication('cba:reload:repo',previous,run,{selectedFiles:300},'functional-decomposition-checkpoint:cba:reload:repo:ready',[]);
   // Read the original tree encoding (references for every small object), then
   // migrate on write to compact inline entries without changing the manifest.
   const oldKey='compat-old-tree';
   await a.putRawRecord(db,store,oldKey+':leaf',JSON.stringify(['object', [['text',{value:'preserve'}]] ]));
   await a.putRawRecord(db,store,oldKey+':root',JSON.stringify(['array',[{ref:oldKey+':leaf'},{ref:oldKey+':leaf'}]]));
   await a.putRawRecord(db,store,oldKey,{format:'xhandle-json-tree-v1',root:oldKey+':root'});
   const oldRows=await a.readRecord(db,store,oldKey);
   oldRows[0].text='edited';
   if(oldRows[1].text!=='preserve')throw new Error('Old tree hydration aliases values');
   await a.writeRecord(db,store,oldKey,oldRows);
   const compact=await a.readRecord(db,store,oldKey);
   if(JSON.stringify(compact)!==JSON.stringify(oldRows))throw new Error('Old tree migration lost data');
   const repeated=await a.writeRecord(db,store,oldKey,oldRows);
   if(repeated.chunksWritten!==0)throw new Error('Unchanged chunks rewritten');
   const aliasProgress=[];
   const aliasRead=await a.readFirstCbaRowsFromIndexedDB([oldKey, 'missing-alias-one', 'missing-alias-two'], {onProgress:value=>aliasProgress.push(value)});
   if(aliasRead.key!==oldKey || !aliasProgress.some(value=>value>33&&value<100) || aliasProgress.at(-1)!==100)throw new Error('Alias count compresses actual record progress');
   const fallbackProgress=[];
   const fallbackRead=await a.readFirstCbaRowsFromIndexedDB(['missing-alias',oldKey], {onProgress:value=>fallbackProgress.push(value)});
   if(fallbackRead.key!==oldKey || fallbackProgress.some((value,i)=>value===100&&i!==fallbackProgress.length-1) || fallbackProgress.some((value,i)=>i&&value<fallbackProgress[i-1]))throw new Error('Fallback search falsely completes or regresses progress');
   const progress=[];
   await a.readRecord(db,store,oldKey,{onProgress:value=>progress.push(value)});
   if(progress[0]!==0 || progress.at(-1)!==100 || !progress.some(value=>value>0&&value<100) || progress.some((value,i)=>i&&value<progress[i-1]))throw new Error('Non-monotonic or missing read progress');
   await a.putRawRecord(db,store,'missing-chunk-fixture',{format:'xhandle-json-tree-v1',root:'does-not-exist'});
   const failedProgress=[];
   let readFailed=false;
   try { await a.readRecord(db,store,'missing-chunk-fixture',{onProgress:value=>failedProgress.push(value)}); } catch { readFailed=true; }
   if(!readFailed || failedProgress.includes(100))throw new Error('Failed read reported completion');
   db.close();
   return {readProgress:progress,failedReadDoesNotComplete:true,oldTreeMigration:true,unchangedChunksReused:true,timings,unrelatedPayloadBytes:520*256*1024,mutableRowsIndependent:true,atomicAbort:true,saveOnlyRetry:true,concurrentEditPreserved:true,quotaRecovery:true,legacyRecovery:true};
  });
  assert(result.timings.at(-1).logicalBytes>32*1024*1024);
  await page.reload();
  await page.evaluate(code=>{window.api=new Function('const notifyBackupDataChanged=()=>{};'+code+';return {recoverArchitecturePublication};')();},code);
  const restored=await page.evaluate(async()=>{
    const result=await window.api.recoverArchitecturePublication('cba:reload:repo','functional-decomposition-checkpoint:cba:reload:repo:ready');
    return {rows:result.rows.length,evidence:result.rows[299].codeEvidence.files[0].sourceFunctions[0].functionName,saved:result.metadata.storageSaved};
  });
  assert.deepEqual(restored,{rows:300,evidence:'call',saved:true});
  result.reloadSaveRecovery=true;
  console.log(JSON.stringify(result,null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
