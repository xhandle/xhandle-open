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
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun} from ${source('codeArchitectureHazardStore.js')};
import useRestore from ${source('useHazardRunRestoration.js')};
import Loader from ${source('SavedHazardPanelLoader.js')};
import {useHazardPreparationCache} from ${source('hazardPreparationCache.js')};
import {createHazardRunRegistry} from ${source('hazardRunRegistry.js')};
window.audit=async()=>{
 let value=null,api,reads=0,payloadReads=0;const registry={current:createHazardRunRegistry()},pending={current:null},version={current:0},empty=[];let cache;
 const original=IDBObjectStore.prototype.get;
 IDBObjectStore.prototype.get=function(...args){if(this.name==='hazardAnalysisRuns')payloadReads++;return original.apply(this,args);};
 const root=createRoot(document.getElementById('app'));
 const config={projectId:'stress',connectionId:'repo',repoId:'repo',registry,pendingContextSave:pending,contextVersion:version,
 read:async(...args)=>{reads++;return getLatestCodeArchitectureHazardRun(...args);},save:()=>{},align:r=>r,getCurrentRun:()=>value,publish:r=>{value=r;}};
 function Harness({enabled}){api=useRestore({...config,enabled});const inputs={latestRun:value,cbaRows:empty,operationalContexts:empty};cache=useHazardPreparationCache(inputs,'stress');return enabled&&value?React.createElement(Loader,{...inputs,preparationCache:cache}):null;}
 const render=enabled=>flushSync(()=>root.render(React.createElement(Harness,{enabled})));
 const wait=async(predicate)=>{const start=performance.now();while(!predicate()){if(performance.now()-start>30000)throw Error('stress wait timed out');await new Promise(r=>setTimeout(r,10));}};
 await saveCodeArchitectureHazardRun({id:'stress-run',projectId:'stress',repoId:'repo',status:'partial',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],...Array.from({length:14483},(_,i)=>['HA-'+i,'evidence '.repeat(8)+i])]}},{notify:false});
 const samples=[];let peak=0;const meter=setInterval(()=>peak=Math.max(peak,performance.memory.usedJSHeapSize),10);
 const mark=label=>samples.push({label,heapMiB:performance.memory.usedJSHeapSize/1048576,payloadReads,metadataChecks:reads});
 try{
 render(true);await wait(()=>api.status==='loaded');render(true);await wait(()=>!!cache.current);
 const first=value;const firstPrepared=cache.current.result;mark('loaded and prepared');const baselineReads=payloadReads;
 for(let i=0;i<100;i++){
  const expectedChecks=reads+1;render(false);render(true);await wait(()=>reads>=expectedChecks&&api.status==='loaded');render(true);
  if(value!==first||cache.current.result!==firstPrepared)throw Error('Unchanged reentry replaced current data');
  if(i%20===19)mark('switch '+(i+1));
 }
 if(payloadReads!==baselineReads)throw Error('Payload reread on unchanged reentry');
 await new Promise(r=>setTimeout(r,1000));mark('idle');
 if(typeof gc==='function'){gc();await new Promise(r=>setTimeout(r,100));mark('idle after explicit diagnostic GC');}
 return {switches:100,rows:14483,peakHeapMiB:peak/1048576,samples,note:'Real restoration and preparation components; final table renderer replaced by a no-op to isolate data/preparation lifetime.'};
 }finally{clearInterval(meter);root.unmount();cache.current=null;value=null;IDBObjectStore.prototype.get=original;}
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
setTimeout(()=>{console.error('stress diagnostic timed out');process.exitCode=1;app.quit();},120000).unref();
