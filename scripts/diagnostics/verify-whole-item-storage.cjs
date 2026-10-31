// Synthetic data in a fresh nonpersistent Chrome context; no personal profile.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/tmp/xhandle-delete-browser/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page=await browser.newPage();page.setDefaultTimeout(60000);
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:401,body:'synthetic'}));
  await page.goto(process.env.XHANDLE_URL || 'http://localhost:3187');
  await page.evaluate(async()=>{
   localStorage.setItem('xhandle.projects','[]');
   localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'whole',name:'Whole item fixture',repos:[{id:'fixture/repo',owner:'fixture',repo:'repo',branch:'main'}]},{id:0,name:'Numeric survivor',repos:[]}]));
   localStorage.setItem('settings.activeTab','storage');localStorage.setItem('githubToken','synthetic-credential');localStorage.setItem('xhandle.sidebarLocked','true');
   await new Promise((resolve,reject)=>{
    const request=indexedDB.open('xhandle',4);
    request.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
     const db=request.result,tx=db.transaction(['copilot_baseline','code_index'],'readwrite'),store=tx.objectStore('copilot_baseline'),scope='cba:whole:fixture/repo';
     const root=`${scope}:$part:root`,shared=`${scope}:$part:shared`;
     const put=(key,value)=>store.put({key,value});
     put(scope,{format:'xhandle-json-tree-v1',root});
     put(root,JSON.stringify(['array',[{value:{traceId:'FD-1',from:'Controller',action:'Stop',to:'Brake'}}]]));
     put(shared,JSON.stringify(['value','shared history']));
     put(`${scope}:history:old`,{format:'xhandle-json-tree-v1',root:shared});
     put('cba:unassigned:repo',{format:'xhandle-json-tree-v1',root:shared});
     const fingerprint='f'.repeat(64);put(`${scope}:run:${fingerprint}`,{fingerprint});put(`${scope}:run`,{fingerprint});
     put(`${scope}:metadata`,{storageSaved:true,updatedAt:'2026-10-29T12:00:00Z',coverage:{acquisition:'complete',selected:1,analyzed:1,failed:0,skippedByLimits:0},sourceAnalysis:{scope,status:'selected-files-analyzed',fingerprint,manifestKey:`${scope}:run:${fingerprint}`}});
     for(let i=0;i<1112;i++)put(`${scope}:functional-work:${i}`,{prompt:`request ${i}`,response:'accepted'});
     const pages=[];let entries=[];
     const flushPage=()=>{if(!entries.length)return;const key=`${scope}:$part:page-${pages.length}`;put(key,JSON.stringify(['array',entries]));pages.push(key);entries=[];};
     for(let i=0;i<700;i++){
      const key=`${scope}:$part:row-${i}`;
      put(key,JSON.stringify(['object',[
       ['traceId',{value:`FD-${i}`}],['from',{value:`Controller ${i}`}],['action',{value:'Stop'}],['to',{value:'Brake'}],
       ['details',{value:'Synthetic saved analysis evidence. '.repeat(600)}],
      ]]));
      entries.push({ref:key});if(entries.length===64)flushPage();
     }
     flushPage();put(root,JSON.stringify(['pages',pages]));
     tx.objectStore('code_index').put({key:'shared-source',value:['source']});
     tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
    };
   });
   const artifactKey='xhandle:cba-software-requirements:whole:fixture/repo';
   localStorage.setItem(artifactKey,JSON.stringify({format:'artifact-rows-v1',revision:1,rowCount:1,rows:[{id:'SWR-fixture',requirementText:'Saved synthetic requirement'}]}));
   const seed=async(name,version,names,work)=>new Promise((resolve,reject)=>{
    const r=indexedDB.open(name,version);
    r.onupgradeneeded=()=>{for(const store of names)if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store,{keyPath:store==='artifactRows'?'key':'id'});};
    r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(names,'readwrite');work(tx);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
   });
   await seed('xhandle-code-architecture-assurance',1,['artifactRows'],tx=>{
    const store=tx.objectStore('artifactRows');store.put({key:artifactKey,rows:[],chunked:true,chunkKeys:[artifactKey+':chunk:0'],rowCount:1,revision:1});
    store.put({key:artifactKey+':chunk:0',parentKey:artifactKey,rows:[{id:'SWR-fixture',requirementText:'Saved synthetic requirement'}]});
   });
   await seed('xhandle-code-architecture-hazard-analysis',5,['hazardAnalysisRuns','runMetadata','generationCheckpoints','hazardRunChunks','hazardRunStaging'],tx=>{
    for(const row of [{id:'hazard-fixture',projectId:'whole',repoId:'fixture/repo',hazardMethod:'STPA'},{id:'hazard-other',projectId:'unassigned',repoId:'other/repo',hazardMethod:'STPA'}]){
      tx.objectStore('runMetadata').put(row);tx.objectStore('hazardAnalysisRuns').put({...row,status:'complete',generatedSheets:{Summary:[]}});
    }
    tx.objectStore('hazardRunChunks').put({id:'uncertain-shared-page',runId:'hazard-fixture',tokens:['synthetic']});
   });
  });
  await page.reload();
  const open=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Refresh saved work',exact:true}).waitFor();};
  await open();
  const saved=page.getByRole('button',{name:'Delete saved analysis',exact:true});
  const temporary=page.getByRole('button',{name:'Clean temporary data',exact:true});
  await saved.waitFor();await temporary.waitFor();console.log('PASS project grouping and temporary inventory');
  await page.waitForFunction(()=>!document.querySelector('details[open] summary')?.textContent?.includes('Advanced storage details'));
  assert.equal(await page.getByRole('button',{name:'Delete Selected',exact:true}).isVisible(),false);
  assert.equal(await page.getByText('Functional processing checkpoint',{exact:false}).count(),0);
  assert.equal(await saved.count(),1);assert.equal(await temporary.count(),1);
  const persisted=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('xhandle');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('copilot_baseline'),read=tx.objectStore('copilot_baseline').getAllKeys();
    read.onsuccess=()=>resolve(read.result);tx.oncomplete=()=>db.close();
   };
  }));
  await page.getByText('Advanced storage details',{exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Delete Selected',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Select Cleanable',exact:true}).click();
  await page.getByText('Advanced storage details',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('details input:checked').length===0);
  assert.equal(await page.locator('details input:checked').count(),0);
  await page.evaluate(()=>{
    window.fixtureProgress=[];
    window.fixtureProgressObserver=new MutationObserver(()=>{for(const node of document.querySelectorAll('[role=status]'))window.fixtureProgress.push(node.textContent);});
    window.fixtureProgressObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
  });
  const readKeys=(name,store)=>page.evaluate(({name,store})=>new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(store),q=tx.objectStore(store).getAllKeys();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};}),{name,store});
  const collection=page.getByRole('button',{name:'Delete saved collection',exact:true});await collection.waitFor();
  page.once('dialog',dialog=>{assert.match(dialog.message(),/Other requirement collections/);dialog.accept();});
  await collection.click();await page.getByRole('status').filter({hasText:'Saved work deleted'}).waitFor();
  assert.deepEqual(await readKeys('xhandle-code-architecture-assurance','artifactRows'),[]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('xhandle:cba-software-requirements:whole:fixture/repo')),null);
  assert((await persisted()).includes('cba:whole:fixture/repo'));
  const hazards=page.getByRole('button',{name:'Delete saved hazard analyses',exact:true});await hazards.waitFor();
  page.once('dialog',dialog=>{assert.match(dialog.message(),/external reports/);dialog.accept();});
  await hazards.click();await page.getByRole('status').filter({hasText:'Saved work deleted'}).waitFor();
  assert.deepEqual(await readKeys('xhandle-code-architecture-hazard-analysis','hazardAnalysisRuns'),['hazard-other']);
  assert.deepEqual(await readKeys('xhandle-code-architecture-hazard-analysis','runMetadata'),['hazard-other']);
  assert.deepEqual(await readKeys('xhandle-code-architecture-hazard-analysis','hazardRunChunks'),['uncertain-shared-page']);
  console.log('PASS whole artifact collection and hazard group confirmations, payloads, pages/fallback, unrelated survivors');
  const initial=await persisted();
  page.once('dialog',dialog=>{assert.match(dialog.message(),/project and repository connection/);dialog.dismiss();});
  await saved.click();assert.deepEqual(await persisted(),initial);
  page.once('dialog',dialog=>{assert.match(dialog.message(),/future analysis may need more AI requests/);dialog.accept();});
  await temporary.click();await page.getByRole('status').filter({hasText:'Temporary data cleaned'}).waitFor();console.log('PASS temporary cleanup');
  const cleaned=await persisted();assert(cleaned.includes('cba:whole:fixture/repo'));assert(!cleaned.some(key=>key.includes(':functional-work:')));
  assert(cleaned.includes('cba:whole:fixture/repo:history:old'));
  const history=page.getByRole('button',{name:'Delete previous versions',exact:true});
  page.once('dialog',dialog=>{assert.match(dialog.message(),/current analysis and its provenance/);dialog.accept();});
  await history.click();await page.getByRole('status').filter({hasText:'Saved work deleted'}).waitFor();
  const withoutHistory=await persisted();assert(withoutHistory.includes('cba:whole:fixture/repo'));
  assert(!withoutHistory.includes('cba:whole:fixture/repo:history:old'));assert(withoutHistory.includes('cba:whole:fixture/repo:$part:shared'));
  // A checkpoint must disable temporary cleanup, including an unpublished result.
  await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('xhandle');r.onsuccess=()=>{const db=r.result,tx=db.transaction('copilot_baseline','readwrite');tx.objectStore('copilot_baseline').put({key:'functional-decomposition-checkpoint:cba:whole:fixture/repo:pending',value:{phase:'ready-to-publish'}});tx.oncomplete=()=>{db.close();resolve();};};}));
  await page.getByRole('button',{name:'Refresh saved work',exact:true}).click();
  await page.getByText(/^Retained for recovery/).waitFor();assert(await temporary.isDisabled());assert(await saved.isDisabled());console.log('PASS unpublished work protection');
  await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('xhandle');r.onsuccess=()=>{const db=r.result,tx=db.transaction('copilot_baseline','readwrite');tx.objectStore('copilot_baseline').delete('functional-decomposition-checkpoint:cba:whole:fixture/repo:pending');tx.oncomplete=()=>{db.close();resolve();};};}));
  await page.getByRole('button',{name:'Refresh saved work',exact:true}).click();await saved.waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Delete saved analysis'&&!b.disabled));
  await page.evaluate(()=>{window.fixtureDelete=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){if(this.name==='copilot_baseline'&&key==='cba:whole:fixture/repo')throw new Error('Synthetic delete failure');return window.fixtureDelete.call(this,key);};});
  page.once('dialog',dialog=>dialog.accept());await saved.click();
  await page.getByRole('status').filter({hasText:'Cleanup did not complete:'}).waitFor();
  assert.match((await page.getByRole('status').allTextContents()).join(' '),/Synthetic delete failure/);
  assert((await persisted()).includes('cba:whole:fixture/repo'));
  await page.evaluate(()=>{IDBObjectStore.prototype.delete=window.fixtureDelete;});
  page.once('dialog',dialog=>dialog.accept());await saved.click();
  await page.getByRole('status').filter({hasText:'Saved work deleted'}).waitFor();
  const deleted=await persisted();assert(!deleted.includes('cba:whole:fixture/repo'));assert(!deleted.includes('cba:whole:fixture/repo:$part:root'));assert(!deleted.some(key=>key.startsWith('cba:whole:fixture/repo:$part:row-')||key.startsWith('cba:whole:fixture/repo:$part:page-')));
  assert(deleted.includes('cba:whole:fixture/repo:$part:shared'));assert(deleted.includes('cba:unassigned:repo'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('githubToken')),'synthetic-credential');
  const projects=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')));
  assert.equal(projects[0].repos.length,1);assert(projects.some(project=>project.id===0));
  assert(await page.evaluate(()=>window.fixtureProgress.some(text=>/Verifying publication|Removing saved analysis|Verifying saved work/.test(text))));
  await page.evaluate(()=>window.fixtureProgressObserver.disconnect());
  await page.reload();await open();
  assert.equal(await saved.count(),0);
  await page.getByText('Whole item fixture',{exact:true}).last().waitFor();
  // Advanced is initially closed again after remount/reload.
  assert.equal(await page.getByRole('button',{name:'Delete Selected',exact:true}).isVisible(),false);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS whole-item inventory, collapsed Advanced, confirmation/cancellation, completed temporary cleanup, unpublished protection, failure/retry, shared chunks, connections/credentials and reload');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
