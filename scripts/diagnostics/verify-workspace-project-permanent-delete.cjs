// Synthetic fixtures only: Playwright creates an isolated, nonpersistent profile.
// PLAYWRIGHT_MODULE may point to a separately installed playwright-core package.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page = await browser.newPage();
    await page.route('**/api/**', r => r.fulfill({status:401,body:'synthetic fixture'}));
    page.setDefaultTimeout(60000);
    console.log('Opening isolated Settings fixture');
    await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000');
    await page.evaluate(async () => {
      localStorage.setItem('xhandle.projects','[]');
      localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'active',name:'Synthetic active',repos:[]}]));
      localStorage.setItem('settings.activeTab','storage');
      localStorage.setItem('githubToken','synthetic-credential');
      localStorage.setItem('xhandle.projectData',JSON.stringify({removed:{rows:[1]},other:{rows:[2]}}));
      localStorage.setItem('cbaMeta:removed:repo','synthetic-owned');
      localStorage.setItem('cbaMeta:other:repo','synthetic-other');
    });
    await page.reload();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Refresh saved work',exact:true}).waitFor();
    // Let the app create the production graph schema, then seed retained rows.
    console.log('Seeding production storage schemas');
    await page.evaluate(async () => {
      await new Promise((resolve,reject)=>{
        const r=indexedDB.open('xhandle',4);
        r.onupgradeneeded=()=>{for(const n of ['copilot_baseline','diagram_positions','code_index']) if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n,{keyPath:'key'});};
        r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Fixture schema blocked'));
      });
      async function seed(name,store,records) {
        await new Promise((resolve,reject) => {
          const request=indexedDB.open(name);
          request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{
            const db=request.result;
            let tx; try {tx=db.transaction(store,'readwrite');} catch(error) {db.close();reject(error);return;}
            records.forEach(record=>tx.objectStore(store).put(record));
            tx.oncomplete=()=>{db.close();resolve();};
            tx.onabort=()=>{db.close();reject(tx.error);};
          };
        });
      }
      await seed('xhandle-workspace-graph','projects',[
        {id:'active',name:'Synthetic active',sourceStore:'localStorage:xhandle.codeArchitectureProjects',sourceData:{id:'active',name:'Synthetic active',repos:[]}},
        {id:'removed',name:'Synthetic removed',sourceStore:'localStorage:xhandle.codeArchitectureProjects',sourceData:{id:'removed',name:'Synthetic removed',repos:[]}},
        {id:'other',name:'Synthetic other removed',sourceStore:'localStorage:xhandle.projects',sourceData:{id:'other',name:'Synthetic other removed'}},
        {id:123,name:'Synthetic numeric',sourceStore:'localStorage:xhandle.projects',sourceData:{id:123,name:'Synthetic numeric'}}
      ]);
      await seed('xhandle-workspace-graph','artifacts',[
        {id:'owned-artifact',projectId:'removed'}, {id:'other-artifact',projectId:'other'}, {id:'numeric-artifact',projectId:123}
      ]);
      await seed('xhandle','copilot_baseline',[
        {key:'cba:removed:repo',value:[]},{key:'cba:removed:repo:$part:0',value:[]},{key:'cba:other:repo',value:[]}
      ]);
      await seed('xhandle','code_index',[{key:'shared-repository',value:[]}]);
    });
    const refresh = () => page.getByRole('button',{name:'Refresh saved work',exact:true}).click();
    const remove = name => page.getByRole('button',{name:`Permanently delete ${name}`,exact:true});
    const persisted = () => page.evaluate(async () => {
      const read = (name,store) => new Promise((resolve,reject) => {
        const r=indexedDB.open(name);
        r.onerror=()=>reject(r.error);
        r.onsuccess=()=>{const db=r.result,tx=db.transaction(store),q=tx.objectStore(store).getAllKeys();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};
      });
      return {active:JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')),projects:await read('xhandle-workspace-graph','projects'),artifacts:await read('xhandle-workspace-graph','artifacts'),analysis:await read('xhandle','copilot_baseline'),sources:await read('xhandle','code_index'),credential:localStorage.getItem('githubToken'),data:JSON.parse(localStorage.getItem('xhandle.projectData'))};
    });
    await refresh();
    await remove('Synthetic removed').waitFor();
    page.once('dialog',d=>d.dismiss());
    await remove('Synthetic removed').click();
    assert((await persisted()).projects.includes('removed'));
    console.log('PASS cancellation preserves retained project');
    await page.evaluate(()=>{
      localStorage.setItem('xhandle:results-review:items','broken JSON');
      window.deletionProgressSnapshots=[];
      new MutationObserver(()=>{
        const bar=document.querySelector('progress[aria-label="Deletion progress for Synthetic removed"]');
        if(bar) window.deletionProgressSnapshots.push({value:bar.value,max:bar.max,text:bar.parentElement.innerText});
      }).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
    });
    page.once('dialog',d=>d.accept());
    await remove('Synthetic removed').click();
    await page.getByRole('status').filter({hasText:'Cleanup did not complete'}).waitFor();
    assert.match(await page.getByRole('status').innerText(),/xhandle:results-review:items/);
    assert((await persisted()).projects.includes('removed'));
    assert(await remove('Synthetic removed').isEnabled());
    assert.equal(await page.getByRole('progressbar',{name:'Deletion progress for Synthetic removed'}).count(),0);
    const failedProgress=await page.evaluate(()=>window.deletionProgressSnapshots);
    assert(failedProgress.some(snapshot=>snapshot.text.includes('Deleting Synthetic removed') && snapshot.value<snapshot.max));
    console.log('PASS visible progress during cleanup; failure clears progress and retains retryable row');
    await page.evaluate(()=>localStorage.setItem('xhandle:results-review:items','[]'));
    page.once('dialog',d=>d.accept());
    await remove('Synthetic removed').click();
    await page.getByRole('status').filter({hasText:'Permanently deleted Synthetic removed.'}).waitFor();
    assert.equal(await remove('Synthetic removed').count(),0);
    assert.equal(await page.getByRole('progressbar').count(),0);
    const progress=await page.evaluate(()=>window.deletionProgressSnapshots);
    assert(progress.some(snapshot=>snapshot.text.includes('Refreshing the project list')));
    assert(progress.some(snapshot=>snapshot.value>0 && snapshot.value<snapshot.max));
    console.log('PASS deletion stages and refresh progress remain visible until completion');
    page.once('dialog',d=>d.accept());
    await remove('Synthetic numeric').click();
    await page.getByRole('status').filter({hasText:'Permanently deleted Synthetic numeric.'}).waitFor();
    const check = async () => {
      const data=await persisted();
      assert(!data.projects.includes('removed') && !data.projects.includes(123) && !data.projects.includes('123'));
      assert(data.projects.includes('other') && data.projects.includes('active'));
      assert(data.active.some(project=>project.id==='active'));
      assert(!data.artifacts.includes('owned-artifact') && !data.artifacts.includes('numeric-artifact'));
      assert(data.artifacts.includes('other-artifact'));
      assert(!data.analysis.some(key=>key.startsWith('cba:removed:')));
      assert(data.analysis.includes('cba:other:repo'));
      assert(data.sources.includes('shared-repository'));
      assert.equal(data.credential,'synthetic-credential');
      assert.deepEqual(data.data,{other:{rows:[2]}});
    };
    await check();
    await refresh();
    assert.equal(await remove('Synthetic removed').count(),0);
    await page.reload();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Refresh saved work',exact:true}).waitFor();
    await check();
    assert.equal(await remove('Synthetic removed').count(),0);
    assert.equal(await remove('Synthetic numeric').count(),0);
    console.log('PASS persisted string/numeric project deletion, owned chunks/artifacts, unrelated active/removed projects, shared repository cache and credential preservation, refresh and reload');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
