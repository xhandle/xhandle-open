// Disposable profile and synthetic data only; no installed workspace access.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),webpack=require('webpack');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-tab-stress-'));
app.setPath('userData',path.join(temp,'profile'));
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('js-flags','--expose-gc');
const base=path.resolve(__dirname,'../../');
const source=p=>JSON.stringify(path.join(base,'src/features/code-architecture-hazard-analysis',p));
fs.writeFileSync(path.join(temp,'panel.js'),'export function PreparedCodeArchitectureHazardPanel(){return null;}');
fs.writeFileSync(path.join(temp,'entry.js'),`
import {openCodeArchitectureHazardDB,getLatestCodeArchitectureHazardRun} from ${source('codeArchitectureHazardStore.js')};
import {stageHazardRun,publishHazardRun} from ${source('hazardRunChunks.js')};
import {hazardMetadata} from ${source('hazardSchema.js')};
window.audit=async()=>{
 const fixture={id:'table-benchmark',projectId:'bench',repoId:'repo',runState:'incomplete',
  architectureRowsSnapshot:[{source:'stored evidence '.repeat(1500000)}],
  narrativeReviewInput:{evidence:['review evidence '.repeat(500000)]},
  generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],...Array.from({length:15000},(_,i)=>['HA-'+i,'saved hazard '+i])]}};
 const db=await openCodeArchitectureHazardDB();
 const root=await stageHazardRun(db,fixture);await publishHazardRun(db,root,hazardMetadata(fixture));db.close();
 const samples=[];
 for(const mode of ['full','legacy-conversion','cached-1','cached-2']){
  let reads=0,maxGap=0,last=performance.now();
  const original=IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll=function(...args){if(this.name==='hazardRunChunks')reads++;return original.apply(this,args);};
  const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
  const begin=performance.now();
  try {
    const loaded=await getLatestCodeArchitectureHazardRun({projectId:'bench'},{workingSet:mode!=='full'});
    const elapsedMs=performance.now()-begin;
    if(loaded.generatedSheets.Summary.length!==15001 || loaded.generatedSheets.Summary[15000][0]!=='HA-14999')throw Error('Table mismatch');
    if(mode!=='full' && loaded.architectureRowsSnapshot!==undefined)throw Error('Evidence loaded into table');
    if(mode.startsWith('cached') && reads!==0)throw Error('Cached opening read source chunks');
    await new Promise(r=>setTimeout(r,20));
    samples.push({mode,elapsedMs,sourceBatchReads:reads,maxEventLoopGapMs:maxGap});
  }finally{clearInterval(timer);IDBObjectStore.prototype.getAll=original;}
 }
 return {rows:15000,sourceCharacters:32000000,chunks:root.payload.count,samples};
};
`);
let server,win,interval;let peakKiB=0;
app.whenReady().then(async()=>{
 await new Promise((resolve,reject)=>{
 const compiler=webpack({mode:'development',entry:path.join(temp,'entry.js'),output:{path:temp,filename:'audit.js'},devtool:false,
 resolve:{extensions:['.js','.jsx','.json'],modules:[path.join(base,'node_modules'),'node_modules']},
 plugins:[new webpack.NormalModuleReplacementPlugin(/\.\/CodeArchitectureHazardPanel$/,path.join(temp,'panel.js'))],
 module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-env'),require.resolve('@babel/preset-react')]}}}]}});
 compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});});
 server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/audit.js'?'text/javascript':'text/html');res.end(req.url==='/audit.js'?fs.readFileSync(path.join(temp,'audit.js')):'<div id="app"></div><script src="/audit.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 interval=setInterval(()=>{for(const metric of app.getAppMetrics())if(metric.type==='Tab')peakKiB=Math.max(peakKiB,metric.memory.peakWorkingSetSize);},100);
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 console.log(JSON.stringify({result:await win.webContents.executeJavaScript('window.audit()'),peakRendererKiB:peakKiB},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearInterval(interval);win?.destroy();if(server)await new Promise(r=>server.close(r));app.quit();});
app.on('quit',()=>fs.rmSync(temp,{recursive:true,force:true}));
setTimeout(()=>{console.error('stress diagnostic timed out');process.exitCode=1;app.quit();},300000).unref();
