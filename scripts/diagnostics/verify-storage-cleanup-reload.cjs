const assert=require('assert');
const {chromium}=require('/tmp/xhandle-hazard-review/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
 const page=await browser.newPage();
 await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));
 await page.goto('http://localhost:3000');
 await page.evaluate(async()=>{
  localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify(['One','Two','Three'].map((name,i)=>({id:'p'+i,name:'Cleanup '+name,repos:[{id:'r'+i,owner:'fixture',repo:'repo'+i}],activeRepoId:'r'+i}))));
  localStorage.setItem('repoOwner','legacy-owner');localStorage.setItem('repoName','legacy-repo');
  localStorage.setItem('settings.activeTab','storage');
  await new Promise((resolve,reject)=>{
   const r=indexedDB.open('xhandle',4);
   r.onupgradeneeded=()=>{for(const n of ['code_index','copilot_baseline','diagram_positions'])if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n,{keyPath:'key'});};
   r.onsuccess=()=>{const db=r.result,tx=db.transaction('copilot_baseline','readwrite');for(let i=0;i<3;i++)tx.objectStore('copilot_baseline').put({key:`cba:p${i}:r${i}`,value:[]});tx.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);
  });
 });
 await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const checkbox=page.getByRole('checkbox',{name:'Delete entire Code architecture analysis category',exact:true});
 await checkbox.check({timeout:60000});
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Delete Selected',exact:true}).click();
 await page.getByText('✅ Deleted all of Code architecture analysis.',{exact:true}).waitFor({timeout:60000});
 assert.deepStrictEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))),[]);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 assert.equal(await page.getByText('Cleanup One',{exact:true}).count(),0);
 await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
 assert.deepStrictEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))),[]);
 assert.equal(await page.getByText('Cleanup One',{exact:true}).count(),0);
 console.log('PASS: three projects removed through actual Settings UI and remain absent after reload, with legacy repository settings retained');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
