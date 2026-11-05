// Synthetic, disposable profiles only. Uses the shared native runtime harness.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-collaborator-stage4-'));
const mode=process.argv[2];if(!['chrome','electron'].includes(mode))throw Error('Specify chrome or electron followed by its executable.');
const template=path.join(output,'entry.template.js');
fs.writeFileSync(template,fs.readFileSync(path.join(__dirname,'../collaborator-stage3/entry.template.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'entry.template.js'),'utf8'));
const env={...process.env,XHANDLE_AUDIT_TEMPLATE:template,NODE_OPTIONS:'--max-old-space-size=1536'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawnSync(process.execPath,[path.join(__dirname,'../collaborator-stage2/run.cjs'),...process.argv.slice(2)],{env,encoding:'utf8',timeout:240000});
fs.writeFileSync(path.join(output,'run.log'),(child.stdout||'')+(child.stderr||''));
if(child.status!==0)throw Error('Native audit failed; inspect '+path.join(output,'run.log'));
const summary=JSON.parse(child.stdout),native=JSON.parse(fs.readFileSync(path.join(summary.output,mode==='chrome'?'chrome-results.json':'results.json'),'utf8'));
console.log(JSON.stringify({...summary,stage4:native.stage4},null,2));
