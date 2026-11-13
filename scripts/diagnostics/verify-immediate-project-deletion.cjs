// Run with Electron (ELECTRON_RUN_AS_NODE unset) after npm run build.
// Uses synthetic data in a fresh temporary profile; never opens a user profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-instant-delete-ui-'));
app.setPath('userData', profile);
const build = path.resolve(process.env.XHANDLE_AUDIT_BUILD_DIR || path.join(__dirname, '../../build'));
let server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/fixture-setup') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Fixture setup</title>'); return; }
    if (req.url.startsWith('/api/')) { res.writeHead(401); res.end('{}'); return; }
    let file = path.join(build, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(build) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(build, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const reload = () => new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  const run = async code => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{return await eval(${JSON.stringify(code)})}catch(error){return {diagnosticError:error.stack||String(error)}}})()`);
    if (result?.diagnosticError) throw new Error(result.diagnosticError);
    return result;
  };
  const until = async code => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) { if (await run(code)) return; await wait(50); }
    throw new Error(`Timed out: ${code}`);
  };
  const settings = async () => {
    await until(`!!document.querySelector('button[aria-label="Settings"]')`);
    await run(`document.querySelector('button[aria-label="Settings"]').click()`);
    await until(`[...document.querySelectorAll('button')].some(b => b.textContent==='Refresh saved work' && !b.disabled)`);
  };
  const refresh = async () => {
    await run(`[...document.querySelectorAll('button')].find(b => b.textContent==='Refresh saved work').click()`);
    await until(`[...document.querySelectorAll('button')].some(b => b.textContent==='Refresh saved work' && !b.disabled)`);
  };
  await win.loadURL(`http://127.0.0.1:${server.address().port}/fixture-setup`);
  await run(`localStorage.setItem('settings.activeTab','storage'); localStorage.setItem('xhandle.projects','[]'); localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'active',name:'Active fixture',repos:[]}])); localStorage.setItem('githubToken','fixture-token');`);
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await settings();
  await run(`(async()=>{
    const r=indexedDB.open('xhandle-workspace-graph');
    await new Promise((resolve,reject)=>{r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
    const db=r.result,tx=db.transaction('projects','readwrite');
    for(const [id,name,source] of [['instant','Immediate fixture','xhandle.codeArchitectureProjects'],['bulk','Bulk fixture','xhandle.projects'],[123,'Numeric fixture','xhandle.projects']])tx.objectStore('projects').put({id,name,sourceStore:'localStorage:'+source,sourceData:{id,name,repos:[]}});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();
  })()`);
  await refresh();
  await until(`!!document.querySelector('button[aria-label="Permanently delete Immediate fixture"]')`);
  const elapsed = await run(`(async()=>{
    // Artificially slow storage to prove that the UI does not wait for it.
    const open=indexedDB.open.bind(indexedDB);
    indexedDB.open=function(name,...args){
      const request=open(name,...args);
      if(name!=='xhandle')return request;
      return new Proxy(request,{get:(target,key)=>Reflect.get(target,key,target),set(target,key,value){target[key]=key==='onsuccess'?(event=>setTimeout(()=>value.call(target,event),5000)):value;return true;}});
    };
    window.confirm=()=>true;
    const start=performance.now();
    document.querySelector('button[aria-label="Permanently delete Immediate fixture"]').click();
    while(document.querySelector('button[aria-label="Permanently delete Immediate fixture"]'))await new Promise(r=>setTimeout(r,0));
    return {ms:performance.now()-start, status:JSON.parse(localStorage.getItem('xhandle:deleted-project:v1:code-architecture:instant')).status,otherEnabled:!document.querySelector('button[aria-label="Permanently delete Bulk fixture"]').disabled};
  })()`);
  assert(elapsed.ms < 1000, JSON.stringify(elapsed));
  assert.equal(elapsed.status, 'queued');
  assert(elapsed.otherEnabled);
  console.log('PASS immediate row removal while storage is delayed:', JSON.stringify(elapsed));
  await reload();
  await settings();
  await until(`JSON.parse(localStorage.getItem('xhandle:deleted-project:v1:code-architecture:instant')||'{}').status==='complete'`);
  assert.equal(await run(`!!document.querySelector('button[aria-label="Permanently delete Immediate fixture"]')`), false);
  console.log('PASS reload resumes pending cleanup without restoring the deleted row');
  await refresh();
  await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Permanently delete all removed projects') && !b.disabled)`);
  await run(`window.confirm=()=>true;localStorage.setItem('xhandle:results-review:items','broken JSON');[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Permanently delete all removed projects')).click()`);
  await until(`!document.querySelector('button[aria-label="Permanently delete Bulk fixture"]') && !document.querySelector('button[aria-label="Permanently delete Numeric fixture"]')`);
  await until(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Retry cleanup')`);
  await refresh();
  assert.equal(await run(`!!document.querySelector('button[aria-label="Permanently delete Bulk fixture"]')`), false);
  await run(`localStorage.setItem('xhandle:results-review:items','[]');[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry cleanup').click()`);
  await until(`['bulk','123'].every(id=>JSON.parse(localStorage.getItem('xhandle:deleted-project:v1:functional:'+id)||'{}').status==='complete')`);
  assert.equal(await run(`localStorage.getItem('githubToken')`), 'fixture-token');
  assert.equal(await run(`JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'))[0].id`), 'active');
  console.log('PASS bulk deletion, failure without reappearance, retry, numeric IDs and active-project/credential preservation');
  win.destroy();
  server.close();
  app.quit();
}).catch(error => { console.error(error); server?.close(); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
