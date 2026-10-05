// Synthetic local-folder workflow. All AI requests are intercepted; no user source is read.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const engines = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const engine = process.env.XHANDLE_BROWSER || 'chromium';
(async () => {
 const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'xhandle-local-'));
 const folder = path.join(temp, 'fixture');
 await fs.mkdir(folder);
 await fs.writeFile(path.join(folder, 'control.js'), 'export function brake() { return true; }\nexport function drive() { return brake(); }\n');
 await fs.writeFile(path.join(folder, 'README.md'), '# Controller\nA vehicle controller calls the brake function.');
 await fs.writeFile(path.join(folder, '.env'), 'SECRET_SHOULD_NEVER_BE_SENT=yes');
 const browser = await engines[engine].launch({headless:true, ...(engine === 'chromium' ? {executablePath:process.env.XHANDLE_CHROME_PATH} : {})});
 try {
  const page = await browser.newPage({viewport:{width:1500,height:1000}});
  const errors = [], forbidden = [], requests = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/github\.com|githubusercontent\.com|\/api\/github\//, r => { forbidden.push(r.request().url()); return r.abort(); });
  await page.route('**/api/chat', r => {
   const body = r.request().postData() || ''; requests.push(body);
   assert.ok(!body.includes('SECRET_SHOULD_NEVER_BE_SENT'));
   let content = 'A vehicle controller calls the brake function.';
   if (body.includes('Function (From) Related File(s)')) content = '| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| drive | control.js | Calls brake. | Call brake | Request braking. | brake | control.js | Applies braking. |';
   else if (body.includes('CSCI')) content = '[]';
   return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content}}],content,result:content})});
  });
  await page.route('**/__local-fixture', r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('http://localhost:3000/__local-fixture');
  await page.evaluate(()=>{
   localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'local-test',name:'Local fixture',repos:[]}]));
   localStorage.setItem('xhandle.activeCodeArchitectureProjectId','local-test');
  });
  await page.addInitScript(()=>{window.showDirectoryPicker=undefined;});
  await page.goto('http://localhost:3000');
  await page.getByRole('button',{name:'Local fixture',exact:true}).first().click({timeout:60000});
  await page.getByLabel('Code architecture actions',{exact:true}).click();
  await page.getByRole('button',{name:'GitHub config',exact:true}).click();
  await page.getByLabel('Code source').selectOption('local');
  await page.getByLabel('Select local project folder').setInputFiles(folder);
  await page.getByText('fixture', {exact:true}).waitFor();
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  await page.getByRole('button',{name:/Include 1 type/i}).click();
  await page.waitForFunction(()=>{
   const project=JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')||'[]')[0];
   return project?.repos?.[0]?.snapshotId;
  },{},{timeout:90000});
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0]);
  const repo=saved.repos[0];
  assert.equal(repo.sourceType,'local'); assert.ok(repo.sourceId); assert.ok(repo.snapshotId); assert.equal(repo.owner,''); assert.equal(repo.repoUrl,'');
  const rows = await page.evaluate(async ({projectId,repoId})=>new Promise((resolve,reject)=>{
   const req=indexedDB.open('xhandle',4); req.onerror=()=>reject(req.error); req.onsuccess=()=>{
    const db=req.result, tx=db.transaction('copilot_baseline'), get=tx.objectStore('copilot_baseline').get(`cba:${projectId}:${repoId}`); get.onsuccess=()=>resolve(get.result?.value); tx.oncomplete=()=>db.close();
   };
  }),{projectId:saved.id,repoId:repo.id});
  assert.ok(rows.length); assert.equal(rows[0].sourceId,repo.sourceId); assert.equal(rows[0].snapshotId,repo.snapshotId); assert.equal(rows[0].codeEvidence.sourceFunctions[0].sourceUrl,'');
  await page.reload();
  await page.getByRole('button',{name:'Local fixture',exact:true}).first().click({timeout:60000});
  await page.getByLabel('Code architecture actions',{exact:true}).click();
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  await page.getByText('Reconnect this local project folder', {exact:false}).waitFor();
  assert.equal(await page.getByLabel('Code source').inputValue(),'local');
  await page.getByRole('button',{name:'Reconnect folder',exact:true}).click();
  await page.getByLabel('Select local project folder').setInputFiles(folder);
  await page.getByText('fixture', {exact:true}).waitFor();
  await page.getByRole('button',{name:'Verify & save',exact:true}).click();
  await page.getByText('Repository saved.',{exact:true}).waitFor();
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].repos[0]);
  assert.equal(restored.sourceId,repo.sourceId); assert.equal(restored.snapshotId,repo.snapshotId);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  // A failed rerun must leave both saved results and their snapshot intact.
  await page.route('**/api/chat', r=>r.fulfill({status:400,body:'Synthetic AI failure'}));
  await page.getByLabel('Code architecture actions',{exact:true}).click();
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  await page.getByText('Local analysis is incomplete', {exact:false}).waitFor({timeout:60000});
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].repos[0])).snapshotId,repo.snapshotId);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Code-Based Architecture/}).first().click();
  await page.getByRole('heading',{name:'Code architecture dashboard',exact:true}).waitFor();
  await page.getByLabel('Code architecture actions',{exact:true}).click();
  await page.getByRole('button',{name:'Export Project',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const download=await downloadPromise;
  const exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(exported.repos[0].repo.sourceId,repo.sourceId);
  assert.equal(exported.repos[0].repo.snapshotId,repo.snapshotId);
  assert.equal(exported.repos[0].rows.length,rows.length);
  assert.equal(exported.repos[0].repo.token,undefined);
  exported.project.name='Imported local fixture';
  await page.locator('input[type="file"][accept=".json,application/json"]').first().setInputFiles({name:'local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.getByRole('button',{name:'Imported local fixture',exact:true}).first().waitFor();
  const imported=await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')).find(p=>p.name==='Imported local fixture'));
  assert.equal(imported.repos[0].sourceId,repo.sourceId);
  assert.equal(imported.repos[0].snapshotId,repo.snapshotId);
  assert.deepEqual(forbidden,[]); assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine,rows:rows.length,aiRequests:requests.length,reconnect:true,failedRerunPreservesResults:true,exportImport:true,errors,forbidden}));
 } finally { await browser.close(); await fs.rm(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
