const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const mode=process.argv[2];if(!['chrome','electron'].includes(mode))throw Error('Specify chrome or electron executable');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-collaborator-large-'));
const env={...process.env,XHANDLE_AUDIT_TEMPLATE:path.join(__dirname,'large.template.js'),XHANDLE_AUDIT_OUTPUT:output,NODE_OPTIONS:'--max-old-space-size=1536'};delete env.ELECTRON_RUN_AS_NODE;
const shared=path.join(__dirname,'../collaborator-stage2');
if(process.env.XHANDLE_ACCEPTANCE_SMALL==='1'){
 const template=fs.readFileSync(env.XHANDLE_AUDIT_TEMPLATE,'utf8').replaceAll('5500','200').replaceAll('27125','1000').replaceAll('5000','500').replaceAll('37125','2000').replaceAll('10000','1000').replaceAll('600*1024*1024','20*1024*1024').replaceAll('5499','199');
 env.XHANDLE_AUDIT_TEMPLATE=path.join(output,'small.template.js');fs.writeFileSync(env.XHANDLE_AUDIT_TEMPLATE,template);
}
const build=spawnSync(process.execPath,[path.join(shared,'build.cjs')],{env,encoding:'utf8',timeout:60000});
fs.writeFileSync(path.join(output,'build.log'),build.stdout+build.stderr);if(build.status!==0)throw Error('Fixture build failed: '+output);
// Increase the fixture deadline for deliberately slow disk/low-memory machines.
for(const file of ['chrome.cjs','main.cjs'])fs.writeFileSync(path.join(output,file),fs.readFileSync(path.join(output,file),'utf8').replace('180000','360000'));
const mainFile=path.join(output,'main.cjs');
fs.writeFileSync(mainFile,fs.readFileSync(mainFile,'utf8').replace('app.whenReady()',`const processPeaks=new Map();const resourceMeter=setInterval(()=>{for(const row of app.getAppMetrics()){const key=row.pid+':'+row.type;const old=processPeaks.get(key)||{pid:row.pid,type:row.type,workingSetSizeKiB:0};old.workingSetSizeKiB=Math.max(old.workingSetSizeKiB,row.memory?.workingSetSize||0);processPeaks.set(key,old);}},250);app.whenReady()`).replace("fs.writeFileSync(path.join(__dirname,'results.json')", "result.processPeaks=[...processPeaks.values()];clearInterval(resourceMeter);fs.writeFileSync(path.join(__dirname,'results.json')"));
fs.writeFileSync(mainFile,fs.readFileSync(mainFile,'utf8').replace('await win.loadFile',`win.webContents.on('console-message',event=>{if(event.message?.startsWith('INDEX_STEP')||event.message?.startsWith('ACCEPTANCE_PHASE'))fs.appendFileSync(path.join(__dirname,'progress.log'),event.message+'\\n');});await win.loadFile`));
const runtime=spawnSync(mode==='chrome'?process.execPath:process.argv[3],[path.join(output,mode==='chrome'?'chrome.cjs':'main.cjs')],{env,encoding:'utf8',timeout:380000});
fs.writeFileSync(path.join(output,'run.log'),runtime.stdout+runtime.stderr);
if(runtime.status!==0)throw Error('Large fixture failed; inspect '+output+'/run.log');
console.log(JSON.stringify({output,...JSON.parse(fs.readFileSync(path.join(output,mode==='chrome'?'chrome-results.json':'results.json'),'utf8'))},null,2));
