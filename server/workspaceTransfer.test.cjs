const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { exportBackend, importBackend, validateBackend, mountWorkspaceTransfer } = require('./workspaceTransfer.cjs');
async function fixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-transfer-api-')), filename=path.join(directory,'test.db');
  const db=await new Promise((resolve,reject)=>{const db=new sqlite3.Database(filename,error=>error?reject(error):resolve(db));});
  const exec=sql=>new Promise((resolve,reject)=>db.exec(sql,error=>error?reject(error):resolve()));
  await exec(`CREATE TABLE baselines(id INTEGER PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,decomposition_data TEXT);
  CREATE TABLE github_configs(account_id TEXT PRIMARY KEY,owner TEXT NOT NULL,repo TEXT NOT NULL,token TEXT);
  CREATE TABLE ai_provider_keys(account_id TEXT,provider TEXT,api_key TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT,PRIMARY KEY(account_id,provider));
  CREATE TABLE openai_keys(account_id TEXT PRIMARY KEY,api_key TEXT,created_at TEXT,updated_at TEXT);
  INSERT INTO baselines VALUES(7,'saved','now','[{"id":"a"}]');
  INSERT INTO github_configs VALUES('one','owner','repo','secret-one'),('two','other','private','secret-two');
  INSERT INTO ai_provider_keys VALUES('one','openai','one-key',1,'now','now'),('two','openai','two-key',1,'now','now');`);
  await new Promise(resolve=>db.close(resolve));
  return { filename, cleanup:()=>fs.rmSync(directory,{recursive:true,force:true}) };
}
test('account-scoped export omits secrets by default and preserves baseline IDs/content', async()=>{
  const f=await fixture();try {
    const basic=await exportBackend(f.filename,'one',false);
    assert.equal(basic.baselines[0].id,7); assert.deepEqual(JSON.parse(basic.baselines[0].decomposition_data),[{id:'a'}]);
    assert.equal(JSON.stringify(basic).includes('secret'),false); assert.equal(basic.providerKeys,undefined);
    const full=await exportBackend(f.filename,'one',true);
    assert.equal(full.repo.token,'secret-one');assert.equal(full.providerKeys[0].api_key,'one-key');assert.equal(JSON.stringify(full).includes('secret-two'),false);
  }finally{f.cleanup();}
});
test('backend import round trip is transactional, maps to destination account, and preserves excluded credentials',async()=>{
  const f=await fixture();try {
    const source=await exportBackend(f.filename,'one',true);
    const without={version:1,includeCredentials:false,baselines:[],repo:{owner:'new',repo:'new'}};
    await importBackend(f.filename,'two',without);
    const target=await exportBackend(f.filename,'two',true);
    assert.equal(target.repo.token,'secret-two');assert.equal(target.providerKeys[0].api_key,'two-key');assert.equal(target.baselines.length,0);
    await importBackend(f.filename,'two',source);
    const restored=await exportBackend(f.filename,'two',true);
    assert.equal(restored.baselines[0].id,7);assert.equal(restored.repo.token,'secret-one');assert.equal(restored.providerKeys[0].api_key,'one-key');
    assert.throws(()=>validateBackend({...source,baselines:[source.baselines[0],source.baselines[0]]}));
    const db=new sqlite3.Database(f.filename);
    await new Promise((resolve,reject)=>db.exec("CREATE TRIGGER reject_baseline BEFORE INSERT ON baselines WHEN NEW.name='reject' BEGIN SELECT RAISE(ABORT,'test failure'); END",error=>error?reject(error):resolve()));
    await new Promise(resolve=>db.close(resolve));
    await assert.rejects(importBackend(f.filename,'two',{...source,baselines:[{...source.baselines[0],name:'reject'}]}));
    assert.equal((await exportBackend(f.filename,'two',true)).baselines[0].name,'saved');
  }finally{f.cleanup();}
});
test('transfer endpoints require loopback and return no-store responses', async()=>{
  const express=require('express');const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={account_id:'one'};next();});
  const f=await fixture();mountWorkspaceTransfer(app,()=>f.filename);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace-transfer/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).baselines.length,1);
    const invalid=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace-transfer/validate`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(invalid.status,400);
  }finally{await new Promise(resolve=>server.close(resolve));f.cleanup();}
});
