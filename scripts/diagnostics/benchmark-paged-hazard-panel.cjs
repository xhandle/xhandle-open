// Disposable profile and synthetic data only; no installed workspace access.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),webpack=require('webpack');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-tab-stress-'));
app.setPath('userData',path.join(temp,'profile'));
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch('js-flags','--expose-gc');
const base=path.resolve(__dirname,'../../');
const source=p=>JSON.stringify(path.join(base,'src/features/code-architecture-hazard-analysis',p));
fs.writeFileSync(path.join(temp,'entry.js'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import Panel from ${source('SavedHazardPanelLoader.js')};
import upgradeHazardTable from ${source('upgradeHazardTable.js')};
import {openCodeArchitectureHazardDB,getLatestCodeArchitectureHazardRun} from ${source('codeArchitectureHazardStore.js')};
import {stageHazardRun,publishHazardRun} from ${source('hazardRunChunks.js')};
import {hazardMetadata} from ${source('hazardSchema.js')};
window.seed=async()=>{
 const fixture={id:'table-benchmark',projectId:'bench',repoId:'repo',runState:'incomplete',
  architectureRowsSnapshot:[{source:'stored evidence '.repeat(1500000)}],
  narrativeReviewInput:{evidence:['review evidence '.repeat(500000)]},
  generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard',...Array.from({length:10},(_,i)=>'Detail '+i)],...Array.from({length:15000},(_,i)=>['HA-'+i,'saved hazard '+i,...Array.from({length:10},()=> 'wide result '.repeat(8))])]}};
 const db=await openCodeArchitectureHazardDB();
 const root=await stageHazardRun(db,fixture);await publishHazardRun(db,root,hazardMetadata(fixture));
 const legacy={...root,payload:{...root.payload}};delete legacy.payload.tableIndex;await db.put('hazardAnalysisRuns',legacy);db.close();
 await upgradeHazardTable(fixture.id);
 const verified=await openCodeArchitectureHazardDB();const upgraded=await verified.get('hazardAnalysisRuns',fixture.id);verified.close();
 if(!upgraded.payload.tableIndex)throw Error('Worker upgrade did not publish index');
 return {rows:15000,sourceCharacters:32000000,chunks:root.payload.count,indexedPages:root.payload.tableIndex.pages.length};
};
window.audit=async()=>{
 let maxGap=0,last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
 const begin=performance.now();const view=createRoot(document.getElementById('app'));
 try{
  const loaded=await getLatestCodeArchitectureHazardRun({projectId:'bench'},{workingSet:true,paged:true});
  const descriptorMs=performance.now()-begin;
  view.render(React.createElement(Panel,{latestRun:loaded,cbaRows:[],operationalContexts:[],storageKey:'bench'}));
  const wait=async predicate=>{const start=performance.now();while(!predicate()){if(performance.now()-start>30000)throw Error('Panel interaction timed out: '+document.body.textContent.slice(0,1500));await new Promise(r=>setTimeout(r,20));}};
  await wait(()=>document.querySelector('tbody td'));
  const usableTableMs=performance.now()-begin,renderedRows=document.querySelectorAll('tbody tr').length;
  if(renderedRows>110)throw Error('Rendered page is not bounded');
  const next=[...document.querySelectorAll('button')].find(button=>button.textContent==='Next rows');
  if(!next || next.disabled)throw Error('Next page unavailable');
  next.click();await wait(()=>document.body.textContent.includes('101–200 of 15000'));
  const nextPageMs=performance.now()-begin-usableTableMs;
  view.unmount();await new Promise(r=>setTimeout(r,50));
  return {descriptorMs,usableTableMs,nextPageMs,renderedRows,maxEventLoopGapMs:maxGap};
 }finally{clearInterval(timer);}
};

`);
let server,win,interval;let peakKiB=0;
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 await new Promise((resolve,reject)=>{
 const compiler=webpack({mode:'development',entry:path.join(temp,'entry.js'),output:{path:temp,filename:'audit.js'},devtool:false,
 plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development'})})],
 resolve:{extensions:['.js','.jsx','.ts','.tsx','.json'],modules:[path.join(base,'node_modules'),'node_modules']},

 module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-env'),[require.resolve('@babel/preset-react'),{runtime:'automatic'}],require.resolve('@babel/preset-typescript')]}}}]}});
 compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors())reject(err||Error(stats.toString({all:false,errors:true})));else resolve();});});
 server=http.createServer((req,res)=>{const filename=path.join(temp,path.basename(req.url));const isScript=req.url.endsWith('.js') && fs.existsSync(filename);res.setHeader('Content-Type',isScript?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(isScript?fs.readFileSync(filename):'<meta charset="utf-8"><style>.max-h-80{max-height:320px}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.min-h-0{min-height:0}.overflow-hidden{overflow:hidden}.overflow-auto{overflow:auto}</style><div id="app"></div><script src="/audit.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 interval=setInterval(()=>{for(const metric of app.getAppMetrics())if(metric.type==='Tab')peakKiB=Math.max(peakKiB,metric.memory.peakWorkingSetSize);},100);
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error('renderer:',message);});
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 const seed=await win.webContents.executeJavaScript('window.seed().catch(error=>({error:error.stack}))');
 if(seed.error)throw Error(seed.error);
 win.destroy();
 peakKiB=0;
 win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error('renderer:',message);});
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 const result=await win.webContents.executeJavaScript('window.audit().catch(error=>({error:error.stack}))');
 console.log(JSON.stringify({seed,result,peakRendererKiB:peakKiB},null,2));
 if(result.error)throw Error(result.error);
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearInterval(interval);win?.destroy();if(server)await new Promise(r=>server.close(r));app.quit();});
app.on('quit',()=>fs.rmSync(temp,{recursive:true,force:true}));
setTimeout(()=>{console.error('stress diagnostic timed out');process.exitCode=1;app.quit();},300000).unref();
