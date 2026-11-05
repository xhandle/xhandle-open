// Launch an existing disposable preview only after its previous process exits.
// Never terminate an app, remove locks, or copy a live IndexedDB directory.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch(error) { if(error.code === 'ESRCH') return false; throw error; } };
async function launch(descriptorPath, executable, logPath) {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  if(!path.isAbsolute(descriptor.project) || !path.isAbsolute(descriptor.profile)) throw Error('Preview project and profile must be absolute paths.');
  const deadline = Date.now() + 30000;
  while(descriptor.pid && alive(descriptor.pid)) {
    if(Date.now() >= deadline) throw Error('The existing preview is still running. Close it before restarting.');
    await sleep(250);
  }
  // Electron's single-instance lock is the final guard. Check database owners
  // too: a storage helper can briefly outlive its main process on macOS.
  const indexedDB = path.join(descriptor.profile, 'IndexedDB');
  if(process.platform === 'darwin' && fs.existsSync(indexedDB)) {
    for(const entry of fs.readdirSync(indexedDB)) {
      const lock = path.join(indexedDB, entry, 'LOCK');
      if(!fs.existsSync(lock)) continue;
      for(;;) {
        const result = spawnSync('/usr/sbin/lsof', ['-t', lock], {encoding:'utf8'});
        if(result.error) throw result.error;
        if(result.status === 1 && !result.stderr.trim()) break;
        if(result.status !== 0) throw Error('Could not verify that the preview database is closed: '+result.stderr.trim());
        if(!result.stdout.trim()) break;
        if(Date.now() >= deadline) throw Error('A process still owns the preview database. Wait for shutdown before retrying.');
        await sleep(250);
      }
    }
  }
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(logPath, 'w');
  let child;
  try {
    child = spawn(executable, ['--inspect=127.0.0.1:0', descriptor.project, '--user-data-dir='+descriptor.profile], {env, detached:true, stdio:['ignore',log,log]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  } finally { fs.closeSync(log); }
  child.unref();
  descriptor.pid = child.pid;
  descriptor.version = JSON.parse(fs.readFileSync(path.join(descriptor.project, 'package.json'),'utf8')).version;
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor,null,2));
  console.log(JSON.stringify(descriptor));
}
if(require.main === module) {
  const [descriptor, executable, log] = process.argv.slice(2);
  if(!descriptor || !executable || !log) throw Error('Usage: node launch-existing-electron-preview.cjs DESCRIPTOR ELECTRON_EXECUTABLE LOG');
  launch(descriptor, executable, log).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports = {launch};
