// Isolated saved-checkpoint UI check: no customer data or live AI requests.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"Isolated fixture"}'}));
  await page.goto('http://localhost:3000');
  await page.evaluate(async()=>{
   const id='recovery-project',rid='recovery-repo',scope=`cba:${id}:${rid}`;
   localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id,name:'Recovery fixture',activeRepoId:rid,repos:[{id:rid,owner:'fixture',repo:'recovery',repoId:'fixture/recovery',branch:'main'}]}]));
   localStorage.setItem('xhandle.activeCodeArchitectureProjectId',id);
   await new Promise((resolve,reject)=>{
    const req=indexedDB.open('xhandle',4);
    req.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,{keyPath:'key'});};
    req.onerror=()=>reject(req.error);req.onsuccess=()=>{
     const db=req.result,tx=db.transaction('copilot_baseline','readwrite');
     tx.objectStore('copilot_baseline').put({key:`functional-decomposition-checkpoint:${scope}:fixture`,value:{updatedAt:'2026-10-05T10:00:00.000Z',scope,totalFiles:3,completedPaths:['a.py','b.py'],failedFiles:[{path:'broken.py',message:'The functional table contains an incomplete row.'}],rows:[{from:'DraftCaller',action:'Check',to:'DraftValidator'}]}});
     tx.objectStore('copilot_baseline').put({key:'functional-decomposition-checkpoint:cba:other:repo:fixture',value:{updatedAt:'2026-10-05T11:00:00.000Z',failedFiles:[{path:'OtherProject.py',message:'Wrong project'}]}});
     tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
   });
  });
  await page.reload();
  await page.getByRole('button',{name:'Recovery fixture',exact:true}).first().click({timeout:60000});
  const panel=page.getByRole('region',{name:'Incomplete architecture analysis'});
  await panel.waitFor();
  assert.match(await panel.innerText(),/2 of 3 files completed/);
  assert.match(await panel.innerText(),/No completed architecture has been published/);
  await panel.getByText('File failure details',{exact:true}).click();
  assert.match(await panel.innerText(),/broken.py/);
  assert.ok(!(await panel.innerText()).includes('OtherProject'));
  await panel.getByText('Preview saved draft relationships',{exact:true}).click();
  assert.match(await panel.innerText(),/DraftCaller/);
  const [download]=await Promise.all([page.waitForEvent('download'),panel.getByRole('button',{name:'Export checkpoint',exact:true}).click()]);
  assert.equal(download.suggestedFilename(),'architecture-incomplete-checkpoint.json');
  await page.reload();await page.getByRole('button',{name:'Recovery fixture',exact:true}).first().click({timeout:60000});await panel.waitFor();assert.match(await panel.innerText(),/progress saved/);
  const result=await page.evaluate(async()=>{
   const key=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[key].push([[Date.now()],{},r=>window.fixtureRequire=r]);
   const storage=window.fixtureRequire('./src/features/code-architecture-assurance/codeArchitectureStorage.js');
   const scope='cba:recovery-project:recovery-repo';
   const rows=await storage.readCbaRowsFromIndexedDB(scope);
   const full=await storage.readArchitectureCheckpoint(`functional-decomposition-checkpoint:${scope}:fixture`);
   await new Promise((resolve,reject)=>{const req=indexedDB.open('xhandle',4);req.onsuccess=()=>{const db=req.result,tx=db.transaction('copilot_baseline','readwrite');tx.objectStore('copilot_baseline').put({key:`${scope}:run`,value:{publishedAt:'2026-10-05T12:00:00.000Z'}});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
   return {publishedRows:rows.length,exportRows:full.rows.length,stale:await storage.readLatestArchitectureCheckpoint(scope)};
  });
  assert.deepEqual(result,{publishedRows:0,exportRows:1,stale:null});
  // A fresh failure through the actual Analyze menu must open recovery, not configuration.
  await page.evaluate(async()=>{
   await new Promise((resolve,reject)=>{const req=indexedDB.open('xhandle',4);req.onsuccess=()=>{const db=req.result,tx=db.transaction('copilot_baseline','readwrite');const store=tx.objectStore('copilot_baseline');store.delete('cba:recovery-project:recovery-repo:run');store.delete('functional-decomposition-checkpoint:cba:recovery-project:recovery-repo:fixture');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  });
  const code='def caller():\n    target()\ndef target():\n    pass\n';
  const sha=require('node:crypto').createHash('sha1').update(`blob ${Buffer.byteLength(code)}\0`).update(code).digest('hex');
  await page.route('https://api.github.com/**',route=>{
   const url=route.request().url();let value;
   if(url.includes('/commits/'))value={sha:'a'.repeat(40)};
   else if(url.includes('/git/trees/'))value={tree:[{path:'control.py',sha,type:'blob',mode:'100644',size:Buffer.byteLength(code)}]};
   else if(url.includes('/git/blobs/')||url.includes('/contents/control.py'))value={encoding:'base64',content:Buffer.from(code).toString('base64')};
   else if(url.includes('/contents/')||url.endsWith('/readme'))return route.fulfill({status:404,body:'fixture'});
   else value={default_branch:'main'};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.reload();await page.getByRole('button',{name:'Recovery fixture',exact:true}).first().click({timeout:60000});
  await page.getByLabel('Code architecture actions',{exact:true}).click();
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  await panel.waitFor({timeout:60000});
  assert.match(await panel.innerText(),/0 of 1 files completed/);
  await panel.getByText('File failure details',{exact:true}).click();
  assert.match(await panel.innerText(),/HTTP 401/);
  assert.equal(await page.getByText('GitHub repo configuration',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({recoveryAfterReload:true,draftPreview:true,checkpointDownload:true,scopeIsolation:true,noPartialPublication:true,staleCheckpointHidden:true,analyzeFailureShowsRecovery:true}));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
