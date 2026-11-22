const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

async function readAppSettings({profile,electron}) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-quality-settings-'));
  fs.chmodSync(copy,0o700);
  try {
    fs.cpSync(path.join(profile,'Local Storage'),path.join(copy,'Local Storage'),{recursive:true});
    const settings = await new Promise((resolve,reject)=>{
      const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(electron,[path.join(__dirname,'read-app-settings.electron.cjs'),copy],{env,stdio:['ignore','pipe','pipe']});
      let stdout = '', stderr = '';
      const timer = setTimeout(()=>{child.kill();reject(Error('Settings reader timed out.'));},30000);
      child.stdout.on('data',data=>{stdout += data;});
      child.stderr.on('data',data=>{stderr = (stderr + data).slice(-3000);});
      child.on('error',()=>{clearTimeout(timer);reject(Error('Settings reader could not start.'));});
      child.on('close',(code,signal)=>{
        clearTimeout(timer);
        const line = stdout.split('\n').find(value=>value.startsWith('XHANDLE_PRIVATE_SETTINGS '));
        if (code || !line) return reject(Error(`Settings reader failed (${signal || code}); the live app profile was not modified. ${stderr.split('\n').slice(0,3).join(' ')}`));
        try {resolve(JSON.parse(line.slice('XHANDLE_PRIVATE_SETTINGS '.length)));} catch {reject(Error('Invalid settings reader response.'));}
      });
    });
    return settings;
  } finally {fs.rmSync(copy,{recursive:true,force:true});}
}
module.exports = {readAppSettings};
