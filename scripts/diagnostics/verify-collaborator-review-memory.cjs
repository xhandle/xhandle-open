// Production UI with a disposable profile, synthetic history and fixture-only network.
// --baseline 1 records the previous implementation without asserting retirement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
module.exports = async ({page, cdp, result, args, out, app}) => {
  const baseline = args.baseline === '1';
  const count = 5000;
  const report = result.reviewMemory = {baseline, legacyRecords: count, phases: []};
  result.methodology = {scenario:'review memory retirement', legacyRecords:count, payloadCharsPerRecord:16384, artifactRowsPerTab:+(args.artifacts||1000), cycles:3, heap:'CDP forced GC at matched milestones; peaks sampled every 100 ms; synthetic data, not the customer archive'};
  await page.evaluate(async count => {
    const db = await new Promise((resolve,reject) => {
      const request=indexedDB.open('xhandle-results-review',1);
      request.onupgradeneeded=()=>{const store=request.result.createObjectStore('reviewItems',{keyPath:'id'});for(const key of ['artifactId','sourceRunId','status'])store.createIndex(key,key);};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('reviewItems','readwrite');
      for(let i=0;i<count;i++)tx.objectStore('reviewItems').put({id:`legacy-history-${i}`,projectId:'inactive-project',artifactId:`historical:inactive:row:${i}`,artifactType:'generated_table',status:'approved_as_is',originalContent:{row:'Historical review evidence. '.repeat(700).slice(0,16384)},currentContent:{row:`Retained ${i}`},history:[{id:`audit-${i}`,note:'Keep this history'}],createdAt:'2026-10-01T00:00:00Z'});
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });db.close();
  },count);
  await page.context().addInitScript(()=>{
    window.__reviewMemory={reads:{},writes:0,peakHeap:0};
    const meter=window.__reviewMemory;
    for(const proto of [IDBObjectStore.prototype,IDBIndex.prototype])for(const name of ['get','getAll','getAllKeys','openCursor']){
      const original=proto[name];proto[name]=function(){if((this.objectStore?.name||this.name)==='reviewItems')meter.reads[name]=(meter.reads[name]||0)+1;return original.apply(this,arguments);};
    }
    for(const name of ['put','add','delete','clear']){const original=IDBObjectStore.prototype[name];IDBObjectStore.prototype[name]=function(){if(this.name==='reviewItems')meter.writes++;return original.apply(this,arguments);};}
    setInterval(()=>{meter.peakHeap=Math.max(meter.peakHeap,performance.memory?.usedJSHeapSize||0);},100);
  });
  await page.reload();
  const project=()=>page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().click();
  await project(); await page.locator('.react-flow__node-bidirectional').first().waitFor();
  const memory=async name=>{await cdp.send('HeapProfiler.collectGarbage');const sample=await page.evaluate(()=>({...window.__reviewMemory,reads:{...window.__reviewMemory.reads},retainedHeap:performance.memory?.usedJSHeapSize,dom:document.querySelectorAll('*').length}));report.phases.push({name,...sample});fs.writeFileSync(out+'.review-partial.json',JSON.stringify(result,null,2));};
  await memory('cold graph');
  const tables=[['Software Requirements','SWR-0'],['System Requirements','SYS-0'],['Subsystem Requirements','SUB-0'],['System / Subsystem Design','DES-0'],['Traceability Matrix','TRACE-']];
  for(let cycle=0;cycle<3;cycle++){
    for(const [name,needle] of tables){
      console.log('review memory',cycle,name);
      await page.getByRole('button',{name,exact:true}).click();await page.locator('tbody').filter({hasText:needle}).waitFor();
      const scroller=await page.locator('tbody').first().evaluateHandle(body=>{for(let e=body.parentElement;e;e=e.parentElement)if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+200)return e;return null;});
      if(scroller.asElement()){
        const box=await scroller.asElement().boundingBox();await page.mouse.move(box.x+Math.min(200,box.width/2),box.y+Math.min(150,box.height/2));
        for(let i=0;i<40;i++)await page.mouse.wheel(0,500);
        await scroller.evaluate(e=>{e.scrollTop=e.scrollHeight;});await page.waitForTimeout(150);
        assert.ok(await scroller.evaluate(e=>e.scrollTop>0));
        assert.ok(await page.locator('tbody tr').count()<200,'Table DOM remains virtualized');
        await scroller.evaluate(e=>{e.scrollTop=0;});
      }
      await scroller.dispose();
    }
    await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
    await page.getByRole('button',{name:'Code Architecture Hazard Analysis',exact:true}).click();
    await page.locator('[data-hazard-row-index="0"]').waitFor();
    const hazard=page.locator('[data-hazard-scroll]');
    for(const fraction of [.8,.2,1,0]){await hazard.evaluate((e,f)=>{e.scrollTop=(e.scrollHeight-e.clientHeight)*f;},fraction);await page.waitForTimeout(200);}
    await page.waitForFunction(()=>!document.querySelector('[data-hazard-loading-row]'));
    assert.ok(await page.locator('[data-hazard-row-index]').count()<200);
    await page.getByRole('button',{name:'Architecture Diagram',exact:true}).click();await page.locator('.react-flow__node-bidirectional').first().waitFor();
    await page.waitForTimeout(2000);await memory('cycle '+(cycle+1));
  }
  // A normal edit still survives tab switching and a real application reload.
  await page.getByRole('button',{name:'Software Requirements',exact:true}).click();await page.locator('tbody').filter({hasText:'SWR-0'}).waitFor();
  const row=page.locator('tr[data-virtual-key]').filter({hasText:'SWR-0'}).first();
  await row.locator('button[title^="SWR requirement"]').click();await row.locator('textarea').first().fill('Review memory regression edit');
  await page.getByRole('heading',{name:'Software Requirements',exact:true}).click();await page.waitForTimeout(1200);
  report.beforeReload=await page.evaluate(()=>window.__reviewMemory);
  await page.reload();await project();
  await page.getByRole('button',{name:'Software Requirements',exact:true}).click();await page.getByRole('button',{name:'Review memory regression edit',exact:true}).waitFor();
  report.editSurvivesReload=true;
  report.retiredNavAbsent=await page.getByRole('button',{name:'Review Center',exact:true}).count()===0;
  report.retiredDrawerAbsent=await page.getByText('Review AI-Generated Results',{exact:true}).count()===0;
  await memory('reloaded edited table');
  report.history=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-results-review',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const tx=db.transaction('reviewItems');const read=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const [count,first,last]=await Promise.all([read(tx.objectStore('reviewItems').count()),read(tx.objectStore('reviewItems').get('legacy-history-0')),read(tx.objectStore('reviewItems').get('legacy-history-4999'))]);db.close();return {count,first:first?.history,last:last?.history};
  });
  assert.deepEqual(report.history.first,[{id:'audit-0',note:'Keep this history'}]);assert.deepEqual(report.history.last,[{id:'audit-4999',note:'Keep this history'}]);
  if(!baseline){
    assert.equal(report.beforeReload.writes,0,'Navigation and edits must not generate legacy reviews');
    assert.equal(report.beforeReload.reads.getAll||0,0,'Never preload all historical review records');
    assert.equal(report.history.count,count,'Historical evidence must remain unchanged');
    assert.ok(report.retiredNavAbsent&&report.retiredDrawerAbsent,'Retired review surfaces must be absent');
    assert.equal(report.phases.at(-1).writes,0);assert.equal(report.phases.at(-1).reads.getAll||0,0);
  }
  report.processMetrics=app?await app.evaluate(({app})=>app.getAppMetrics()):null;
  await page.screenshot({path:out+'.png'});report.passed=true;
};
if(require.main===module){process.argv.push('--workspace','cba','--reviewMemory','1','--interactions','skip','--trace','0');require('./desktop-interaction-performance.cjs');}
