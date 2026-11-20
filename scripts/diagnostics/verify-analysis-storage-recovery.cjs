// Real native IndexedDB in isolated WebKit/Chrome contexts. All data is synthetic.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const webpack=require('webpack');
const {webkit,chromium}=require(process.env.XHANDLE_PLAYWRIGHT_MODULE || 'playwright-core');
const {fingerprint}=require('./electron-regression-support.cjs');
const sourceRoot=path.resolve(__dirname,'../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-native-storage-'));
const report={root,source:fingerprint(sourceRoot),checks:[],errors:[]};
let server,browser;
function build() {
 const entry=path.join(root,'entry.js');
 fs.writeFileSync(entry,`import * as storage from ${JSON.stringify(path.join(sourceRoot,'src/features/code-architecture-context/analysisSourceStorage.js'))}; window.analysisStorage = storage;`);
 return new Promise((resolve,reject)=>webpack({mode:'production',devtool:false,context:sourceRoot,target:'web',entry,output:{path:root,filename:'bundle.js'},optimization:{minimize:false}},(error,stats)=>{
  if(error || stats.hasErrors())reject(error || Error(stats.toString({all:false,errors:true})));else resolve();
 }));
}
(async()=>{
 try {
  await build();
  server=http.createServer((request,response)=>{
   response.setHeader('content-type',request.url==='/bundle.js'?'application/javascript':'text/html');
   response.end(request.url==='/bundle.js'?fs.readFileSync(path.join(root,'bundle.js')):'<!doctype html><title>Isolated storage regression</title><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for(const [name,engine,options] of [['WebKit',webkit,{}],['Chromium',chromium,{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}]]) {
   browser=await engine.launch({headless:true,...options});
   const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(`${name}: ${error.message}`));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   const result=await page.evaluate(async()=>{
    const {writeAnalysisSourceRecord:write,readAnalysisSourceRecord:read,analysisStorageError}=window.analysisStorage;
    const key='functional-decomposition-checkpoint:cba:synthetic:repo:abort';
    const realPut=IDBObjectStore.prototype.put,realGet=IDBObjectStore.prototype.get;
    let target='',remaining=0,aborts=0,retries=0;
    IDBObjectStore.prototype.put=function(value,...args){
     const request=realPut.call(this,value,...args);
     if(value?.key===target && remaining>0){remaining--;aborts++;this.transaction.abort();}
     return request;
    };
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    try {
     for(let file=1;file<=24;file++){
      await write('code_index',`source-${file}`,{path:`${file}.py`,content:'def control(): return command()'});
      if(file===14){target=key;remaining=1;}
      await write('copilot_baseline',key,{phase:'extraction',totalFiles:24,completedPaths:Array.from({length:file},(_,i)=>`${i+1}.py`),failedFiles:[],rows:[{from:'control',action:'Call command',to:'command'}]}, {onRetry:()=>retries++});
     }
     check(aborts===1 && retries===1,'One native checkpoint abort was recovered exactly once.');
     const completed=await read('copilot_baseline',key);
     check(completed.completedPaths.length===24 && completed.failedFiles.length===0,'All 24 files completed after the native transaction abort.');
     check(completed.phase==='extraction','The saved phase remains text.');
     const prior={phase:'extraction',completedPaths:['prior.py'],totalFiles:2,rows:[]};
     await write('copilot_baseline','persistent',prior);
     target='persistent';remaining=3;retries=0;
     let cause;
     try{await write('copilot_baseline',target,{...prior,completedPaths:['prior.py','new.py']},{onRetry:()=>retries++});}catch(error){cause=error;}
     check(cause?.name==='AbortError' && retries===2,'Persistent abort recovery is bounded.');
     check((await read('copilot_baseline','persistent')).completedPaths.length===1,'The last committed checkpoint survived.');
     check(analysisStorageError(cause,'Save failed').code==='SOURCE_STORAGE_FAILED','Native DOMException wrapping retains a stable error code.');
     let abortRead=true;
     IDBObjectStore.prototype.get=function(value,...args){const request=realGet.call(this,value,...args);if(abortRead && value===key){abortRead=false;this.transaction.abort();}return request;};
     check((await read('copilot_baseline',key)).completedPaths.length===24,'A native read-transaction abort recovers.');
     IDBObjectStore.prototype.get=realGet;
     const open=()=>new Promise((resolve,reject)=>{const request=indexedDB.open('xhandle',4);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
     target='competing';remaining=1;
     let conflict;
     try{await write('copilot_baseline',target,[{from:'automatic'}],{wait:async()=>{
      const db=await open();try{const tx=db.transaction('copilot_baseline','readwrite');const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});tx.objectStore('copilot_baseline').put({key:target,value:[{from:'human edit'}]});await done;}finally{db.close();}
     }});}catch(error){conflict=error;}
     check(conflict?.code==='SOURCE_PUBLICATION_CONFLICT','A competing edit is not overwritten on recovery.');
     check((await read('copilot_baseline',target))[0].from==='human edit','The competing edit remains unchanged.');
     target='cancelled';remaining=1;const controller=new AbortController();let cancelled;
     try{await write('copilot_baseline',target,{rows:[]},{signal:controller.signal,onRetry:()=>controller.abort()});}catch(error){cancelled=error;}
     check(controller.signal.aborted && cancelled,'Cancellation stops native recovery.');
     return {files:24,checkpointAbortRecovered:true,readAbortRecovered:true,persistentAbortsBounded:true,competingEditPreserved:true,cancellation:true};
    }finally{IDBObjectStore.prototype.put=realPut;IDBObjectStore.prototype.get=realGet;}
   });
   report.checks.push({engine:name,version:browser.version(),...result});
   console.log('PASS',name,JSON.stringify(result));await browser.close();browser=null;
  }
  assert.equal(report.errors.length,0);
  report.finalSource=fingerprint(sourceRoot);assert.equal(report.source.sha256,report.finalSource.sha256);
  report.ok=true;
 }catch(error){report.ok=false;report.errors.push(error.stack);console.error(error);process.exitCode=1;}
 finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log('RESULT '+path.join(root,'result.json'));}
})();
