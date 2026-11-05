const test = require('node:test');
const assert = require('node:assert/strict');
const {fork} = require('node:child_process');
const {mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
test('production chat route streams all three providers and returns correlated safe timings', {timeout:30000}, async () => {
  const cwd = mkdtempSync(path.join(tmpdir(),'xhandle-stage4-route-'));
  // Do not inherit provider keys or read the developer environment file/database.
  const env = {PATH:process.env.PATH,HOME:cwd,TMPDIR:tmpdir(),NODE_ENV:'production'};
  let child;
  try {
    const result = await new Promise((resolve,reject) => {
      child = fork(path.resolve(__dirname,'../scripts/diagnostics/collaborator-stage4/route-fixture.cjs'),[],{cwd,env,stdio:['ignore','pipe','pipe','ipc']});
      let message, diagnostic='';child.stdout.on('data',chunk=>{diagnostic+=chunk;});child.stderr.on('data',chunk=>{diagnostic+=chunk;});
      child.on('message',value=>{message=value;});child.on('error',reject);
      child.on('exit',code=>code===0&&message?.ok?resolve(message):reject(Error(message?.error||diagnostic||'Fixture exited '+code)));
    });
    assert.equal(result.output.length,3);
    console.log(JSON.stringify(result.output.map(({provider,firstOutputMs,completeMs})=>({provider,firstOutputMs,completeMs}))));
  } finally {child?.kill();rmSync(cwd,{recursive:true,force:true});}
});
