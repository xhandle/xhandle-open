// Fresh browser context, synthetic data only; no provider calls.
const assert = require('assert');
const { chromium } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || '/tmp/xhandle-hazard-review/node_modules/playwright-core');
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page = await browser.newPage();
  await page.route('**/api/**', route => route.fulfill({status:401, body:'diagnostic fixture'}));
  await page.goto('http://localhost:3000');
  await page.waitForFunction(() => Object.keys(window).some(key => key.startsWith('webpackChunk')));
  const result = await page.evaluate(async () => {
   const chunk = Object.keys(window).find(key => key.startsWith('webpackChunk'));
   window[chunk].push([[Date.now()], {}, req => window.testRequire = req]);
   const req = window.testRequire;
   const name = 'xhandle-code-architecture-hazard-analysis';
   await new Promise((resolve,reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => request.result.createObjectStore('hazardAnalysisRuns', {keyPath:'id'});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
     const db = request.result, tx = db.transaction('hazardAnalysisRuns','readwrite');
     tx.objectStore('hazardAnalysisRuns').put({id:'legacy',projectId:'legacy-project',repoId:'repo',updatedAt:'2026-01-01'});
     tx.oncomplete = () => {db.close();resolve();}; tx.onerror = () => reject(tx.error);
    };
   });
   const store = req('./src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js');
   const upgraded = await store.getLatestCodeArchitectureHazardRun({projectId:'legacy-project'});
   await Promise.all(Array.from({length:8}, (_,i) => store.saveCodeArchitectureHazardRun({
    id:'run-'+i,projectId:'p'+i,repoId:'repo',updatedAt:'2026-10-08',
    generatedSheets:{Summary:[['Hazard'],...Array.from({length:1000},()=>['Synthetic hazard text'])]},
   })));
   const count = (await store.getCodeArchitectureHazardRuns()).length;
   const originalGetAll = IDBObjectStore.prototype.getAll, originalGet = IDBObjectStore.prototype.get;
   let payloadReads = 0;
   IDBObjectStore.prototype.getAll = function(...args) {if(this.name==='hazardAnalysisRuns') throw Error('Unbounded run read'); return originalGetAll.apply(this,args);};
   IDBObjectStore.prototype.get = function(...args) {if(this.name==='hazardAnalysisRuns') payloadReads++; return originalGet.apply(this,args);};
   const latest = await store.getLatestCodeArchitectureHazardRun({projectId:'p3',repoId:'repo'});
   IDBObjectStore.prototype.getAll = originalGetAll; IDBObjectStore.prototype.get = originalGet;
   const cp = req('./src/features/code-architecture-hazard-analysis/codeHazardGenerationCheckpoint.js');
   const first = await cp.createCodeHazardCheckpoint({projectId:'p3',repoId:'repo',method:'STPA-Textbook'});
   await first.write({policy:'A',row:'1'},['saved']);
   const second = await cp.createCodeHazardCheckpoint({projectId:'p3',repoId:'repo',method:'STPA-Textbook'});
   const resumed = await second.read({policy:'A',row:'1'});
   const changed = await second.read({policy:'B',row:'1'});
   const isolated = await (await cp.createCodeHazardCheckpoint({projectId:'p4',repoId:'repo',method:'STPA-Textbook'})).read({policy:'A',row:'1'});
   await cp.createCodeHazardCheckpoint({projectId:'p3',repoId:'repo',method:'STPA-Textbook'},{regenerate:true});
   const reset = await second.read({policy:'A',row:'1'});
   const originalPut = IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put = function(...args) {if(this.name==='hazardAnalysisRuns') throw new DOMException('fixture quota','QuotaExceededError');return originalPut.apply(this,args);};
   let rejected = false;
   try {await store.saveCodeArchitectureHazardRun({id:'bad',projectId:'bad'});} catch {rejected=true;}
   IDBObjectStore.prototype.put=originalPut;
   await store.deleteCodeArchitectureHazardRuns({projectId:'p0'});
   const remaining = (await store.getCodeArchitectureHazardRuns()).length;
   const React = req('./node_modules/react/index.js');
   const Table = req('./src/features/code-architecture-hazard-analysis/CodeArchitectureHazardSummaryTable.js').default;
   const host = document.createElement('div'); host.style.height='500px'; document.body.replaceChildren(host);
   const root = req('./node_modules/react-dom/client.js').createRoot(host);
   const headers=['Function (From)','Control Action','Function (To)','Hazard',...Array.from({length:40},(_,i)=>'Detail '+i)];
   const rows=Array.from({length:1000},(_,i)=>['From','Action','To','Hazard '+i,...Array(40).fill('Detail text')]);
   root.render(React.createElement(Table,{summarySheet:[headers,...rows],showReview:false,storageKey:'fixture'}));
   await new Promise(resolve=>setTimeout(resolve,500));
   const renderedCells=host.querySelectorAll('tbody td').length;
   const placeholders=host.querySelectorAll('[data-deferred-row]').length;
   root.unmount();
   return {upgraded:upgraded?.id,count,latest:latest?.id,payloadReads,resumed,changed:!!changed,isolated:!!isolated,reset:!!reset,rejected,remaining,renderedCells,placeholders};
  });
  console.log(JSON.stringify(result,null,2));
  assert.equal(result.upgraded,'legacy'); assert.equal(result.count,9); assert.equal(result.remaining,8);
  assert.equal(result.latest,'run-3'); assert.equal(result.payloadReads,1);
  assert.deepEqual(result.resumed,['saved']); assert.equal(result.changed,false); assert.equal(result.isolated,false); assert.equal(result.reset,false);
  assert.equal(result.rejected,true); assert(result.placeholders>800); assert(result.renderedCells<5000);
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
