// Isolated synthetic browser only; never opens a persistent profile.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/tmp/xhandle-delete-browser/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
 const page=await browser.newPage(); page.setDefaultTimeout(90000);
 await page.route('**/api/**',r=>r.fulfill({status:401,body:'synthetic'}));
 await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000');
 const project={id:'synthetic-remove',name:'Synthetic sidebar removal',repos:[{id:'synthetic/repository',owner:'synthetic',repo:'repository',branch:'test-branch',selectedExtensions:['.js'],operationalContext:'Synthetic context'}]};
 await page.evaluate(async project=>{
 localStorage.setItem('xhandle.projects','[]');
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([project,{id:0,name:'Synthetic survivor',repos:[]}]));
 localStorage.setItem('settings.activeTab','storage');
 localStorage.setItem('xhandle.sidebarLocked','true');
 await new Promise((resolve,reject)=>{
   const request=indexedDB.open('xhandle',4);
   request.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions']) if(!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name,{keyPath:'key'});};
   request.onerror=()=>reject(request.error);
   request.onsuccess=()=>{const db=request.result; const tx=db.transaction('copilot_baseline','readwrite');
     tx.objectStore('copilot_baseline').put({key:`cba:${project.id}:${project.repos[0].id}`,value:[{traceId:'FD-1',from:'Controller',action:'Stop',to:'Brake',architecture:{subsystem:'Motion'}}]});
     tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
   };
 });
 },project);
 await page.reload();
 const expectedRepos=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].repos);
 const settings=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Refresh saved work',exact:true}).waitFor();};
 const remove=async()=>{
 if (!await page.locator('button[title="Synthetic sidebar removal"]').isVisible()) await page.locator('span').filter({hasText:/^Code-Based Architecture$/}).first().click();
 const title=page.locator('button[title="Synthetic sidebar removal"]');
 await title.hover();
 await title.locator('..').locator('[data-cba-project-menu-trigger]').click({force:true});
 page.once('dialog',d=>d.accept());
 await page.getByText('Delete',{exact:true}).click();
 await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).some(p=>p.id==='synthetic-remove'));
 };
 await settings();
 await page.getByText('2 active',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Refresh saved work',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Partial storage scan:'}).waitFor();
 await page.getByText('2 active',{exact:true}).waitFor();
 const graphKeys=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-workspace-graph');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('projects');const q=tx.objectStore('projects').getAllKeys();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};}));
 assert.deepEqual(graphKeys,[]);
 console.log('PASS authoritative active inventory with verified empty graph and unrelated scan failures');
 await page.evaluate(()=>{
   window.fixtureTransaction=IDBDatabase.prototype.transaction;
   IDBDatabase.prototype.transaction=function(stores,...args) {
     if(this.name==='xhandle-workspace-graph' && String(stores)==='projects') throw new Error('Synthetic retained lookup unavailable');
     return window.fixtureTransaction.call(this,stores,...args);
   };
 });
 await page.getByRole('button',{name:'Refresh saved work',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Retained project records unavailable'}).waitFor();
 await page.getByText('2 active',{exact:true}).waitFor();
 await page.getByText('Removed inventory unavailable',{exact:true}).waitFor();
 await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.fixtureTransaction;});
 await page.getByRole('button',{name:'Refresh saved work',exact:true}).click();
 await page.getByRole('button',{name:'Refresh saved work',exact:true}).waitFor({state:'visible'});
 console.log('PASS unavailable retained lookup keeps active rows and retryable diagnostic');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 if (!await page.locator('button[title="Synthetic sidebar removal"]').isVisible()) await page.locator('span').filter({hasText:/^Code-Based Architecture$/}).first().click();
 await page.evaluate(()=>{
   window.fixturePut=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args) {
     if(this.name==='projects' && this.transaction.db.name==='xhandle-workspace-graph') throw new Error('Synthetic snapshot write failed');
     return window.fixturePut.apply(this,args);
   };
 });
 const messages=[];
 const accept=async d=>{messages.push(d.message());await d.accept();if(d.message().includes('Project was not removed')) await page.evaluate(()=>{window.fixtureRemovalFailed=true;});};
 page.on('dialog',accept);
 await page.locator('button[title="Synthetic sidebar removal"]').hover();
 await page.locator('button[title="Synthetic sidebar removal"]').locator('..').locator('[data-cba-project-menu-trigger]').click({force:true});
 await page.getByText('Delete',{exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('button[title="Synthetic sidebar removal"]') && JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).length===2);
 await page.waitForFunction(()=>window.fixtureRemovalFailed===true);
 assert(messages.some(message=>message.includes('Project was not removed')));
 page.off('dialog',accept);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.fixturePut;});
 console.log('PASS actual sidebar retention failure surfaces error and leaves project active');
 await page.locator('button[title="Synthetic sidebar removal"]').click();
 await page.getByRole('button',{name:'Architecture Diagram',exact:true}).waitFor();
 assert.equal(await page.getByText(/Loading saved results|Retry loading/).count(),0);
 console.log('PASS actual architecture view loads diagram without phantom hazard loading banner');
 await remove(); await settings();
 // Corrupt active registries must never be replaced by an empty fallback on Restore.
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Restore"]')?.disabled);
 await page.evaluate(()=>localStorage.setItem('xhandle.codeArchitectureProjects','{invalid'));
 await page.getByRole('button',{name:'Restore',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Restore did not complete'}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('xhandle.codeArchitectureProjects')),'{invalid');
 await page.evaluate(()=>localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:0,name:'Synthetic survivor',repos:[]}])));
 console.log('PASS malformed active registry is preserved on failed restore');
 await page.getByRole('button',{name:'Restore',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).some(p=>p.id==='synthetic-remove'));
 const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).find(p=>p.id==='synthetic-remove'));
 assert.deepEqual(restored.repos,expectedRepos);
 console.log('PASS actual sidebar removal without indexing and faithful restore');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 console.log('Removing restored project again');
 await remove(); console.log('Second sidebar removal committed'); await settings();
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:`Permanently delete ${project.name}`,exact:true}).click();
 console.log('Permanent deletion requested');
 await page.waitForFunction(()=>document.body.innerText.includes('Permanently deleted') || document.body.innerText.includes('Cleanup did not complete'),null,{timeout:30000}).catch(async error=>{console.log((await page.locator('body').innerText()).slice(-8000));throw error;});
 assert.match(await page.getByRole('status').innerText(),/Permanently deleted/);
 await page.getByRole('button',{name:'Refresh saved work',exact:true}).click();
 await page.reload(); await settings();
 await page.getByText('1 active',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:`Permanently delete ${project.name}`,exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).map(p=>p.id)),[0]);
 console.log('PASS permanent deletion, refresh/reload, unrelated survivor');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>{
   localStorage.setItem('xhandle.projects',JSON.stringify([{id:'functional-restore',name:'Synthetic functional restore'}]));
   localStorage.setItem('xhandle.projectData',JSON.stringify({'functional-restore':{syntheticSentinel:'preserve functional data'},unrelated:{syntheticSentinel:'unrelated'}}));
 });
 await page.reload();
 const functional=page.locator('button[title="Synthetic functional restore"]');
 if (!await functional.isVisible()) await page.locator('span').filter({hasText:/^Projects$/}).first().click();
 await functional.hover();
 await functional.locator('..').locator('[data-project-menu-trigger]').click({force:true});
 page.once('dialog',d=>d.accept());
 await page.getByText('Delete',{exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xhandle.projects')).length===0);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData'))['functional-restore'].syntheticSentinel),'preserve functional data');
 await settings();
 await page.getByRole('button',{name:'Restore',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xhandle.projects')).some(p=>p.id==='functional-restore'));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData'))['functional-restore'].syntheticSentinel),'preserve functional data');
 console.log('PASS actual functional sidebar removal and restore preserve functional project data');

 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
