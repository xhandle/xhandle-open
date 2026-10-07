// Fresh browser; disposable database. Compare legacy one-record IDB to current tree storage.
const {chromium}=require('/tmp/xhandle-copy-check/node_modules/playwright-core');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const page=await browser.newPage();await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));await page.goto(process.env.XHANDLE_URL||'http://localhost:3001');
 console.log(JSON.stringify(await page.evaluate(async()=>{
 window[Object.keys(window).find(k=>k.startsWith('webpackChunk'))].push([[Date.now()],{},r=>window.req=r]);
 const {writeRecord,readRecord}=window.req('./src/features/code-architecture-storage/chunkedRecord.js');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('review-only-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const rows=Array.from({length:1000},(_,i)=>({from:`f${i}`,to:`f${i+1}`,action:'Call',traceId:`row-${i}`,fromDetails:'Detailed source responsibility. '.repeat(30),architecture:{subsystem:'System',csci:'Software',csc:`Component${Math.floor(i/20)}`,csu:'Unit'},sourceEvidence:{functions:[{functionName:`f${i}`,filePath:'fixture.cpp',startLine:i,endLine:i+1}]}}));
 const clock=async fn=>{const start=performance.now();await fn();return performance.now()-start;};
 const legacyWriteMs=await clock(()=>new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({key:'legacy',value:rows});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));
 const legacyReadMs=await clock(()=>readRecord(db,'records','legacy'));
 const treeWriteMs=await clock(()=>writeRecord(db,'records','tree',rows));
 let loaded;const treeReadMs=await clock(async()=>{loaded=await readRecord(db,'records','tree');});
 const records=await new Promise(resolve=>{const r=db.transaction('records').objectStore('records').count();r.onsuccess=()=>resolve(r.result);});db.close();
 return {rows:rows.length,payloadMiB:new Blob([JSON.stringify(rows)]).size/1048576,legacyWriteMs,legacyReadMs,treeWriteMs,treeReadMs,records,roundTripEqual:JSON.stringify(rows)===JSON.stringify(loaded)};
 }),null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
