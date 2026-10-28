// Run with the desktop Electron binary and ELECTRON_RUN_AS_NODE unset.
// Uses a fresh temporary profile and a loopback fixture origin; no user data.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-storage-audit-'));
app.setPath('userData', profile);
const listing = fs.readFileSync(path.resolve(__dirname, '../../src/components/storageCategoryItems.js'), 'utf8').replaceAll('export function', 'function');
const scanner = fs.readFileSync(path.resolve(__dirname, '../../src/components/inspectStorageStore.js'), 'utf8').replace('export function', 'function');
let server;
app.whenReady().then(async () => {
  server = http.createServer((req, res) => res.end('<!doctype html><title>Isolated storage audit</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  const result = await win.webContents.executeJavaScript(`(async () => {
    ${scanner}
    const size = value => new Blob([typeof value === 'string' ? value : JSON.stringify(value ?? '')]).size;
    const db = await new Promise((resolve,reject) => {
      const r = indexedDB.open('synthetic-storage-audit',1);
      r.onupgradeneeded = () => r.result.createObjectStore('records');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve,reject) => {
      const tx = db.transaction('records','readwrite');
      tx.objectStore('records').put({text:'x'.repeat(8*1024*1024)},'large');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    ${listing}
    await new Promise((resolve,reject) => {
      const tx=db.transaction('records','readwrite'), store=tx.objectStore('records');
      for(let i=0;i<125;i++) store.put({name:'Synthetic '+i},String(i).padStart(3,'0'));
      const sparse=[];sparse.length=1000000;sparse[999999]='x';
      store.put(sparse,'sparse');store.put(new Uint8Array(1024*1024),'binary');
      store.put(new Blob(['x'.repeat(1024*1024)]),'blob');
      store.put('internal','001:$part:0');
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    // Fail immediately if either code path tries to read values or cursor payloads.
    const originalGet=IDBObjectStore.prototype.get;
    const originalCursor=IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.get=function(){throw new Error('Unexpected record read');};
    IDBObjectStore.prototype.openCursor=function(){throw new Error('Unexpected value cursor');};
    const start=performance.now();
    const first=await readStoragePage(db,'records');
    const second=await readStoragePage(db,'records',first.nextKey);
    const third=await readStoragePage(db,'records',second.nextKey);
    const controller=new AbortController();
    const cancelled=readStoragePage(db,'records',undefined,50,{signal:controller.signal}).then(()=>false,()=>true);
    controller.abort();
    const cancellation=await cancelled;
    await deleteStorageRecords(db,'records',['000']);
    const scanned=await inspectStorageStore(db,'records');
    const elapsedMs=performance.now()-start;
    IDBObjectStore.prototype.get=originalGet;
    IDBObjectStore.prototype.openCursor=originalCursor;
    return {electron:navigator.userAgent,scanned,elapsedMs,pages:[first.items.length,second.items.length,third.items.length],keys:[...first.items,...second.items,...third.items].map(x=>x.key),nextKey:third.nextKey,cancellation};
  })()`);
  assert.equal(result.scanned.count,129); // 130 physical rows minus one selected row
  assert.equal(result.scanned.bytes,null);
  assert.equal(result.scanned.error,'');
  assert.deepStrictEqual(result.pages,[50,50,29]);
  assert.equal(new Set(result.keys).size,129);
  assert(!result.keys.some(key=>key.includes(':$part:')));
  assert.equal(result.nextKey,undefined);
  assert.equal(result.cancellation,true);
  delete result.keys;
  console.log(JSON.stringify(result,null,2));
  win.destroy();
}).catch(error => { console.error(error);process.exitCode=1; }).finally(async () => {
  if(server) await new Promise(resolve=>server.close(resolve));
  app.quit();
});
app.on('quit',()=>{fs.rmSync(profile,{recursive:true,force:true});});
