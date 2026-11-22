const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { command, cleanEnvironment, resultFromOutput, fingerprint, killTree } = require('./electron-regression-support.cjs');
test('termination also stops a GUI main process without its own process group', { skip: process.platform === 'win32' }, async t => {
  const { spawn } = require('node:child_process'), { once } = require('node:events');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: false, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await once(child, 'spawn'); const exited = once(child, 'exit');
  killTree(child, 'SIGTERM'); await exited;
  assert.equal(child.signalCode, 'SIGTERM');
});
test('runner preserves failures and bounded timeouts instead of treating a missing result as success', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'regression-support-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const failed = await command(process.execPath,['-e','console.log("diagnostic evidence");process.exit(3)'],{cwd:root,log:path.join(root,'fail.log')});
  assert.equal(failed.exitCode,3); assert.match(fs.readFileSync(failed.log,'utf8'),/diagnostic evidence/);
  const timeout = await command(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,log:path.join(root,'timeout.log'),timeoutMs:100});
  assert.equal(timeout.timedOut,true); assert.notEqual(timeout.exitCode,0);
  assert.equal(resultFromOutput('nothing was asserted'),null);
  const resultFile = path.join(root,'result.json');fs.writeFileSync(resultFile,JSON.stringify({ok:true,checks:['asserted'],errors:[]}));
  assert.deepEqual(resultFromOutput('RESULT '+resultFile).checks,['asserted']);
  fs.writeFileSync(resultFile,JSON.stringify({ok:true,checks:['asserted'],errors:['Unhandled renderer failure']}));
  assert.throws(()=>resultFromOutput('RESULT '+resultFile),/Diagnostic failed/);
  fs.writeFileSync(resultFile,JSON.stringify({ok:true,checks:['asserted'],errors:[],failures:['A failed interaction']}));
  assert.throws(()=>resultFromOutput('RESULT '+resultFile),/Diagnostic failed/);
});
test('fixture environment excludes provider secrets and source changes alter the fingerprint', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'regression-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src','app.js'),'old');const before=fingerprint(root);
  fs.writeFileSync(path.join(root,'src','app.js'),'new');assert.notEqual(before.sha256,fingerprint(root).sha256);
  assert(!Object.keys(cleanEnvironment()).some(key=>/API_KEY|TOKEN|SECRET|PASSWORD/i.test(key)));
});
test('a timeout also stops detached GUI descendants', { skip: process.platform === 'win32' }, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'regression-child-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pidFile=path.join(root,'child.pid');
  const detached="require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
  const source="require('node:child_process').spawn(process.execPath,['-e',"+JSON.stringify(detached)+","+JSON.stringify(pidFile)+"],{detached:true,stdio:'ignore'});setInterval(()=>{},1000)";
  const result=await command(process.execPath,['-e',source],{cwd:root,log:path.join(root,'timeout.log'),timeoutMs:800});
  assert(result.timedOut);const pid=Number(fs.readFileSync(pidFile,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,100));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

 test('theme configuration and diagnostic changes invalidate certification fingerprints',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-fingerprint-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let before=fingerprint(root);fs.writeFileSync(path.join(root,'tailwind.config.js'),'theme A');assert.notEqual(before.sha256,fingerprint(root).sha256);before=fingerprint(root);
 fs.mkdirSync(path.join(root,'scripts','diagnostics'),{recursive:true});fs.writeFileSync(path.join(root,'scripts','diagnostics','theme.cjs'),'theme B');assert.notEqual(before.sha256,fingerprint(root).sha256);
 });
