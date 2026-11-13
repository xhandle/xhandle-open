// Production worker diagnostic. Only a disposable synthetic IndexedDB profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-project-load-'));
app.setPath('userData', profile);
let server;
app.whenReady().then(async () => {
  const build = path.resolve(process.env.XHANDLE_AUDIT_BUILD_DIR || path.join(__dirname, '../../build'));
  const worker = fs.readdirSync(path.join(build, 'static/js')).find(name => name.endsWith('.js') && fs.readFileSync(path.join(build, 'static/js', name), 'utf8').includes('Unknown artifact background operation.'));
  assert(worker);
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.end('<!doctype html><button id="probe">Workspace action</button>'); return; }
    const file = path.join(build, req.url.split('?')[0]);
    if (!file.startsWith(build) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const request = indexedDB.open('xhandle-design-artifacts', 1);
    request.onupgradeneeded = () => {
      for (const name of ['metadata','jobs','revisions','baselines']) {
        const store = request.result.createObjectStore(name, { keyPath: 'id' });
        store.createIndex('projectId','projectId'); if(name !== 'metadata') store.createIndex('artifactId','artifactId');
      }
    };
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const members = Array.from({length:20},(_,i)=>({ id:'a'+i }));
    const evidence = 'Original implementation evidence. '.repeat(65000);
    const tx = db.transaction(['metadata','jobs','revisions','baselines'],'readwrite');
    tx.objectStore('metadata').put({id:'p',recordType:'systems-engineering-project',title:'Large project',state:'accepted',config:{system:'Vehicle'},ownerProjects:[],members});
    for(const member of members) {
      tx.objectStore('metadata').put({id:member.id,programId:'p',title:member.id,revision:1,config:{},templateId:'architecture'});
      tx.objectStore('jobs').put({id:member.id,artifactId:member.id,state:'paused',sections:{scope:[{text:'Saved section'}]},sources:{evidence}});
      tx.objectStore('revisions').put({id:member.id+':1',artifactId:member.id,number:1,objects:[{id:member.id+':n',kind:'requirement',title:'Control command',text:'Retain command',sourceIds:['source'],sourceEvidence:[{id:'source',title:'Implementation',sourceType:'architecture-element',diagramId:'d',diagramHash:'saved',row:{evidence}}]}]});
      tx.objectStore('baselines').put({id:member.id+':b',artifactId:member.id,label:'Baseline'});
    }
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)}); db.close();
    async function load(operation) {
      const thread = new Worker('/static/js/${worker}');
      const progress=[]; let last=performance.now(), maxGap=0, ticks=0;
      const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;document.getElementById('probe').click()},20);
      const started=performance.now();
      try {
        const value=await new Promise((resolve,reject)=>{
          thread.onmessage=({data})=>{if(data.progress){progress.push(data.progress.percent);return;}data.error?reject(new Error(data.error.message)):resolve(data.result)};
          thread.onerror=e=>reject(new Error(e.message)); thread.postMessage({operation,payload:{id:'p'}});
        });
        return {durationMs:Math.round(performance.now()-started),maxGapMs:Math.round(Math.max(maxGap,performance.now()-last)),ticks,progress,bytes:JSON.stringify(value).length,documents:value.records?.length,nodes:value.nodes?.length};
      } finally {clearInterval(timer);thread.terminate();}
    }
    return {evidenceCharacters:evidence.length*members.length*2,legacy:await load('project-overview'),warm:await load('project-overview'),trace:await load('project-trace')};
  })()`);
  for (const key of ['legacy','warm','trace']) {
    const value=result[key]; assert.equal(value.progress[0],0);assert.equal(value.progress.at(-1),100);
    assert(value.progress.every((v,i)=>!i||v>=value.progress[i-1]));assert(value.maxGapMs<1000,JSON.stringify(value));assert(value.bytes<30000);
  }
  assert.equal(result.warm.documents,20);assert(result.warm.durationMs<2000);assert(result.trace.nodes>20);
  console.log('PASS compact project loading, legacy summary migration, 0–100 progress, on-demand trace and responsive UI', JSON.stringify(result));
  win.destroy(); server.close(); app.exit(0);
}).catch(error=>{console.error(error);server?.close();app.exit(1)});
app.on('quit',()=>{try{fs.rmSync(profile,{recursive:true,force:true})}catch{}});
