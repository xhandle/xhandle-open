const assert = require('assert');
const {chromium} = require('/tmp/xhandle-hazard-review/node_modules/playwright-core');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page = await browser.newPage();
  await page.route('**/api/**', r => r.fulfill({status:401,body:'fixture'}));
  await page.goto('http://localhost:3000');
  await page.waitForFunction(() => Object.keys(window).some(k=>k.startsWith('webpackChunk')));
  const result = await page.evaluate(async () => {
   window[Object.keys(window).find(k=>k.startsWith('webpackChunk'))].push([[Date.now()],{},r=>window.req=r]);
   const {readStoragePage,deleteStorageRecords} = window.req('./src/components/storageCategoryItems.js');
   const db = await new Promise((resolve,reject)=>{
    const r=indexedDB.open('selective-cleanup-fixture',1);
    r.onupgradeneeded=()=>{for(const n of ['rows','hazardAnalysisRuns','runMetadata'])r.result.createObjectStore(n);};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
   });
   await new Promise((resolve,reject)=>{
    const tx=db.transaction(['rows','hazardAnalysisRuns','runMetadata'],'readwrite');
    for(let i=0;i<125;i++)tx.objectStore('rows').put({name:'Item '+i},String(i).padStart(3,'0'));
    tx.objectStore('rows').put('internal','001:$part:abc');
    for(const n of ['hazardAnalysisRuns','runMetadata'])for(const k of ['a','b'])tx.objectStore(n).put({id:k},k);
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
   });
   const first=await readStoragePage(db,'rows');
   const second=await readStoragePage(db,'rows',first.nextKey);
   const third=await readStoragePage(db,'rows',second.nextKey);
   await deleteStorageRecords(db,'rows',[first.items[0].key,third.items[0].key]);
   await deleteStorageRecords(db,'hazardAnalysisRuns',['a']);
   const count=n=>new Promise(resolve=>{const r=db.transaction(n).objectStore(n).count();r.onsuccess=()=>resolve(r.result);});
   const counts=await Promise.all(['rows','hazardAnalysisRuns','runMetadata'].map(count));
   await deleteStorageRecords(db,'hazardAnalysisRuns',null);
   const cleared=await Promise.all(['hazardAnalysisRuns','runMetadata'].map(count));
   db.close();
   return {pages:[first.items.length,second.items.length,third.items.length],last:third.nextKey,keys:[...first.items,...second.items,...third.items].map(i=>i.key),counts,cleared};
  });
  assert.deepStrictEqual(result.pages,[50,50,25]);
  assert.equal(new Set(result.keys).size,125);assert(!result.keys.some(k=>k.includes('$part')));
  assert.deepStrictEqual(result.counts,[124,1,1]);assert.deepStrictEqual(result.cleared,[0,0]);
  await page.evaluate(() => {
   localStorage.setItem('settings.activeTab','storage');
   localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{id:'cleanup-fixture-one',name:'Cleanup one'},{id:'cleanup-fixture-two',name:'Cleanup two'}]));
   localStorage.setItem('cbaMeta:cleanup-fixture-one:repo','one');
   localStorage.setItem('cbaMeta:cleanup-fixture-two:repo','two');
   const React=window.req('./node_modules/react/index.js');
   const {createRoot}=window.req('./node_modules/react-dom/client.js');
   const Settings=window.req('./src/components/SettingsModal.jsx').default;
   const host=document.createElement('div');host.id='cleanup-test';document.body.appendChild(host);
   createRoot(host).render(React.createElement(Settings,{onClose:()=>{}}));
  });
  const host=page.locator('#cleanup-test');
  await host.getByRole('button', {name:/▸ Code architecture workspace/}).click({timeout:60000});
  const one=host.locator('label').filter({hasText:'Cleanup one — Analysis details'});
  await one.getByRole('checkbox').check();
  page.once('dialog',dialog=>dialog.accept());
  await host.getByRole('button',{name:'Delete Selected',exact:true}).click();
  await host.getByText(/Deleted 1 selected item/).waitFor({timeout:60000});
  assert.deepStrictEqual(await page.evaluate(()=>[localStorage.getItem('cbaMeta:cleanup-fixture-one:repo'),localStorage.getItem('cbaMeta:cleanup-fixture-two:repo')]),[null,'two']);
  console.log('PASS: rendered Settings selection and deletion preserve the unselected sibling');
  console.log('PASS: paged listing, chunk isolation, selective deletion, unrelated item preservation, and atomic paired category cleanup');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
