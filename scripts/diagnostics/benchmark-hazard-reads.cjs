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
import {saveCodeArchitectureHazardRun,openCodeArchitectureHazardDB} from ${source('codeArchitectureHazardStore.js')};
import {hydrateHazardRun,HAZARD_CHUNKS} from ${source('hazardRunChunks.js')};
window.audit=async()=>{
 const fixture={id:'read-benchmark',projectId:'bench',repoId:'repo',status:'partial',
  evidence:'stored evidence '.repeat(1500000),
  generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],...Array.from({length:15000},(_,i)=>['HA-'+i,'saved hazard '+i]) ]}};
 await saveCodeArchitectureHazardRun(fixture,{notify:false});
 const db=await openCodeArchitectureHazardDB(),root=await db.get('hazardAnalysisRuns',fixture.id);
 const samples=[];
 try{
  for(const serial of [true,false]){
   let reads=0,maxGap=0,last=performance.now();
   const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
   const reader={transaction:(...args)=>{
    const tx=db.transaction(...args);
    return {done:tx.done,abort:()=>tx.abort(),objectStore:name=>{
     const store=tx.objectStore(name);
     return {get:key=>store.get(key),getAll:async(range,count)=>{
      if(!serial){reads++;return store.getAll(range,count);}
      const start=Number(range.lower.slice(-12)),end=Number(range.upper.slice(-12)),prefix=range.lower.slice(0,-12),parts=[];
      for(let n=start;n<=end;n++){reads++;const part=await store.get(prefix+String(n).padStart(12,'0'));if(part)parts.push(part);}
      return parts;
     }};
    }};
   }};
   const begin=performance.now();
   try {
    const loaded=await hydrateHazardRun(reader,root);
    const elapsedMs=performance.now()-begin;
    if(loaded.evidence!==fixture.evidence||loaded.generatedSheets.Summary.length!==15001)throw Error('Data mismatch');
    await new Promise(r=>setTimeout(r,20));
    samples.push({mode:serial?'serial':'batched',elapsedMs,reads,maxEventLoopGapMs:maxGap});
   }finally{clearInterval(timer);}
  }
  return {rows:15000,evidenceCharacters:fixture.evidence.length,chunks:root.payload.count,samples};
 }finally{db.close();}
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
