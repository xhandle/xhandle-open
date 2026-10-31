// Isolated actual SummaryTable + real saved-row workers in React development
// StrictMode. Uses disposable browser profiles; never opens a user's workspace.
// node scripts/diagnostics/stress-continuous-hazard-development.cjs --sourceRoot /absolute/source --out /tmp/dev-hazard.json --browser chrome
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const webpack = require('webpack');
const {chromium, _electron} = require(process.env.PLAYWRIGHT_MODULE || '/tmp/xhandle-delete-browser/node_modules/playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => index % 2 ? all : [...all, [value.slice(2), values[index + 1]]], []));
const base = path.resolve(__dirname, '../..');
const sourceRoot = path.resolve(args.sourceRoot || base);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhandle-hazard-dev-'));
const out = path.resolve(args.out || '/tmp/hazard-development.json');
const source = file => JSON.stringify(path.join(sourceRoot, 'src/features/code-architecture-hazard-analysis', file));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cssBuild = path.resolve(args.cssBuild || '/tmp/xhandle-hazard-scroll-20261031/final-build');
const cssManifest = JSON.parse(fs.readFileSync(path.join(cssBuild, 'asset-manifest.json')));
const css = (cssManifest.entrypoints || []).filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(cssBuild, file), 'utf8')).join('\n');
fs.writeFileSync(path.join(temp, 'style.css'), css);
fs.writeFileSync(path.join(temp, 'entry.jsx'), `
import React, {useEffect,useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import Table from ${source('CodeArchitectureHazardSummaryTable.js')};
import useContinuousHazardRows from ${source('useContinuousHazardRows.js')};
import requestHazardRows from ${source('requestHazardRows.js')};
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun} from ${source('codeArchitectureHazardStore.js')};
const noop=()=>{},empty=[];
window.audit={errors:[],commits:0,maxCommitsInFrame:0,frames:0,frameCommits:0,focusResolved:[],activeWorkers:0,maxWorkers:0,trustedWheels:0};
window.addEventListener('wheel',event=>{if(event.isTrusted&&document.querySelector('table')?.parentElement.contains(event.target))window.audit.trustedWheels++;},{capture:true,passive:true});
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.auditActive=true;window.audit.activeWorkers++;window.audit.maxWorkers=Math.max(window.audit.maxWorkers,window.audit.activeWorkers);}terminate(){if(this.auditActive){this.auditActive=false;window.audit.activeWorkers--;}return super.terminate();}};
const frame=()=>{window.audit.frames++;window.audit.maxCommitsInFrame=Math.max(window.audit.maxCommitsInFrame,window.audit.frameCommits);window.audit.frameCommits=0;requestAnimationFrame(frame);};requestAnimationFrame(frame);
class Boundary extends React.Component{state={error:null};static getDerivedStateFromError(error){return {error};}componentDidCatch(error,info){window.audit.errors.push({message:error.message,stack:error.stack,componentStack:info.componentStack});}render(){return this.state.error?React.createElement('pre',{'data-fatal':true},this.state.error.message):this.props.children;}}
const root=createRoot(document.getElementById('app'));let sheet,run,sequence=0;
function Remote({focus}){
 const [layout,setLayout]=useState(null),[indices,setIndices]=useState(empty),[required,setRequired]=useState(empty);
 const queryKey='dev:'+run.id;
 useEffect(()=>{const abort=new AbortController();requestHazardRows(run,{operation:'layout',signal:abort.signal}).then(setLayout).catch(error=>{if(error.name!=='AbortError')window.audit.errors.push({message:error.message,stack:error.stack});});return()=>abort.abort();},[]);
 const requestRows=useCallback((next,requiredNext)=>{setIndices(old=>old.length===next.length&&old.every((v,i)=>v===next[i])?old:next);setRequired(old=>old.length===requiredNext.length&&old.every((v,i)=>v===requiredNext[i])?old:requiredNext);},[]);
 const cache=useContinuousHazardRows({run,partial:false,queryKey,layout,requestedRowIndices:indices,requiredRowIndices:required});
 const remotePage={continuous:true,queryKey,layout,headers:sheet[0],total:layout?.total||0,rowsByIndex:cache.rowsByIndex,requestRows,cacheStats:cache.cacheStats,filters:{},options:[],setFilter:noop,requestOptions:noop,clearFilters:noop,copy:noop};
 return React.createElement(Table,{summarySheet:[sheet[0]],remotePage,showReview:false,className:'h-full',storageKey:queryKey,highlightedRowIndex:focus,focusRequestKey:focus==null?null:'focus:'+focus,onRowFocusResolved:key=>window.audit.focusResolved.push(key)});
}
window.mountFixture=async({mode,pattern='mixed',rows=15000})=>{
 root.render(null);await new Promise(resolve=>setTimeout(resolve,0));sequence++;
 window.audit.errors=[];window.audit.focusResolved=[];window.audit.maxCommitsInFrame=0;window.audit.frameCommits=0;
 const headers=pattern==='few'?['Raw Analysis Row ID','Hazard']:['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Hazard','Causal Scenario'];
 const makeText=i=>{
  if(pattern==='few')return i%29===0?'LONGTOKEN'.repeat(80)+' '+('wrapped safety description '.repeat(120)):'h'+i;
  if(i%1000<700)return i%37===0?'wideword'.repeat(150):'h'+i;
  return ('line '+i+' with a detailed causal explanation and recovery state'+String.fromCharCode(10)).repeat(i%17===0?90:6);
 };
 sheet=[headers,...Array.from({length:rows},(_,i)=>pattern==='few'?['HA-'+i,makeText(i)]:['HA-'+i,'Source','Command','Target','Hazard '+i,makeText(i)])];
 if(mode==='remote'){
  const identity='dev-scroll-'+sequence;
  await saveCodeArchitectureHazardRun({id:identity,projectId:identity,repoId:'isolated',updatedAt:new Date().toISOString(),method:'STPA',generatedSheets:{Summary:sheet}});
  run=await getLatestCodeArchitectureHazardRun({projectId:identity,repoId:'isolated'},{workingSet:true,paged:true});
  if(run.id!==identity)throw Error('Fixture loaded the wrong saved run');
 }
 const render=(focus=null)=>root.render(React.createElement(React.StrictMode,null,React.createElement(Boundary,{key:sequence},React.createElement(React.Profiler,{id:'hazard',onRender:()=>{window.audit.commits++;window.audit.frameCommits++;}},mode==='remote'?React.createElement(Remote,{focus}):React.createElement(Table,{summarySheet:sheet,showReview:false,className:'h-full',storageKey:'local:'+sequence,highlightedRowIndex:focus,focusRequestKey:focus==null?null:'focus:'+focus,onRowFocusResolved:key=>window.audit.focusResolved.push(key)})))));
 window.focusRow=index=>render(index);render();return {mode,pattern,rows,reactVersion:React.version,development:process.env.NODE_ENV};
};
window.unmountFixture=()=>root.render(null);
`);

async function main() {
  const result = {sourceRoot, temp, browser: args.browser || 'chrome', development: true, strictMode: true, rows: Number(args.rows || 15000), errors: [], scenarios: [], limitations: 'Actual SummaryTable/hooks, development React and production styles in an isolated host; remote mode uses the real saved store, layout worker and bounded cell cache. This does not mount the complete App.', sourceHashes: {}};
  for (const file of ['CodeArchitectureHazardSummaryTable.js','useHazardRowWindow.js','useContinuousHazardRowWindow.js','useContinuousHazardRows.js']) result.sourceHashes[file] = hash(path.join(sourceRoot,'src/features/code-architecture-hazard-analysis',file));
  result.harnessSha256 = hash(__filename); result.cssSha256 = hash(path.join(temp,'style.css'));
  let server, browser, app;
  const save = () => fs.writeFileSync(out, JSON.stringify(result, null, 2));
  try {
    await new Promise((resolve,reject)=>{
      const compiler=webpack({mode:'development',entry:path.join(temp,'entry.jsx'),output:{path:temp,filename:'audit.js'},devtool:'source-map',plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development'})})],resolve:{extensions:['.js','.jsx','.ts','.tsx','.json'],modules:[path.join(base,'node_modules'),'node_modules']},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-env'),[require.resolve('@babel/preset-react'),{runtime:'automatic'}],require.resolve('@babel/preset-typescript')]}}}]}});
      compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
    });
    if (args.buildOnly === '1') { result.built = true; save(); return; }
    server=http.createServer((request,response)=>{
      const file=path.join(temp,path.basename(request.url.split('?')[0]));
      if(fs.existsSync(file)&&fs.statSync(file).isFile()){response.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.map')?'application/json':'text/javascript');response.end(fs.readFileSync(file));}
      else{response.setHeader('Content-Type','text/html');response.end('<meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0}#app{width:1100px;height:680px;overflow:hidden}</style><div id="app"></div><script src="/audit.js"></script>');}
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let page;
    if(result.browser==='chrome'){
      browser=await chromium.launch({headless:false,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
      page=await browser.newPage({viewport:{width:1440,height:920},deviceScaleFactor:2});result.version=browser.version();
    }else{
      const mainFile=path.join(temp,'main.cjs');fs.writeFileSync(mainFile,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp,'profile'))});app.whenReady().then(()=>new BrowserWindow({width:1440,height:920,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}).loadURL('about:blank'));`);
      app=await _electron.launch({executablePath:process.env.ELECTRON_PATH||'/Users/Nick/xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',args:[mainFile],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});page=await app.firstWindow();result.version=await app.evaluate(()=>process.versions);
    }
    page.setDefaultTimeout(30000);
    page.on('pageerror',error=>result.errors.push({kind:'pageerror',message:error.message,stack:error.stack}));
    page.on('console',message=>{if(message.type()==='error')result.errors.push({kind:'console',message:message.text()});});
    await page.goto('http://127.0.0.1:'+server.address().port);
    const read=()=>page.evaluate(()=>{
      const table=document.querySelector('table[aria-label="Code architecture hazard analysis"]'),scroller=table?.parentElement;
      const bounds=scroller?.getBoundingClientRect(),headerHeight=table?.tHead?.getBoundingClientRect().height||0;
      return {top:scroller?.scrollTop,height:scroller?.clientHeight,scrollHeight:scroller?.scrollHeight,width:table?.getBoundingClientRect().width,configuredMinWidth:table?.style.minWidth,configuredWidth:table?.style.width,columnWidths:[...table?.querySelectorAll('col')||[]].map(column=>({configured:column.style.width,actual:column.getBoundingClientRect().width})),mounted:table?.querySelectorAll('tbody tr').length,cacheRows:Number(table?.dataset.hazardCacheRows)||null,cacheBytes:Number(table?.dataset.hazardCacheBytes)||null,loaded:[...table?.querySelectorAll('[data-hazard-row-index]')||[]].map(row=>{const rect=row.getBoundingClientRect();return {id:Number(row.dataset.hazardRowIndex),height:rect.height,viewportOffset:rect.top-bounds.top-headerHeight,visible:rect.bottom>bounds.top+headerHeight&&rect.top<bounds.bottom};}),loading:table?.querySelectorAll('[data-hazard-loading-row]').length,errors:window.audit.errors.slice(),commits:window.audit.commits,maxCommitsInFrame:window.audit.maxCommitsInFrame,activeWorkers:window.audit.activeWorkers,maxWorkers:window.audit.maxWorkers,focusResolved:window.audit.focusResolved.slice()};
    });
    const ready=()=>page.waitForFunction(()=>document.querySelector('[data-fatal]')||document.querySelector('table [data-hazard-row-index]'));
    for(const mode of (args.modes||'local,remote').split(',')) for(const pattern of (args.patterns||'mixed,few').split(',')){
      const scenario={mode,pattern,samples:[]};result.scenarios.push(scenario);
      scenario.fixture=await page.evaluate(values=>window.mountFixture(values),{mode,pattern,rows:result.rows});await ready();scenario.initial=await read();save();
      if(scenario.initial.errors.length)continue;
      const scroller=page.locator('table[aria-label="Code architecture hazard analysis"]').locator('..');
      if(args.navigationOnly!=='1'&&mode==='remote'&&pattern==='mixed'){
        const box=await scroller.boundingBox();await page.mouse.move(box.x+Math.min(200,box.width/2),box.y+Math.min(100,box.height/2));
        const begin=Date.now(),trustedBefore=await page.evaluate(()=>window.audit.trustedWheels);
        scenario.sustainedDown={requestedInputs:640,samples:[]};
        for(let tick=0;tick<640;tick++){
          await page.mouse.wheel(0,tick%4===0?4200:1200);
          if(tick%40===0){scenario.sustainedDown.samples.push(await read());if(scenario.sustainedDown.samples.at(-1).errors.length)break;}
        }
        scenario.sustainedDown.durationMs=Date.now()-begin;
        scenario.sustainedDown.trustedInputs=(await page.evaluate(()=>window.audit.trustedWheels))-trustedBefore;
        save();
        if(scenario.sustainedDown.samples.at(-1)?.errors.length){scenario.final=await read();continue;}
      }
      for(let round=0;round<(args.navigationOnly==='1'?0:3);round++){
        const box=await scroller.boundingBox();await page.mouse.move(box.x+Math.min(200,box.width/2),box.y+Math.min(100,box.height/2));
        for(let tick=0;tick<160;tick++){
          await page.mouse.wheel(0,(round%2?-1:1)*(tick%4===0?4200:1200));
          if(tick%20===0){scenario.samples.push(await read());if(scenario.samples.at(-1).errors.length)break;}
        }
        if(scenario.samples.at(-1)?.errors.length)break;
        for(const fraction of [1,0.499,0.501,0.2,0.8,0]){
          await scroller.evaluate((element,value)=>{element.scrollTop=(element.scrollHeight-element.clientHeight)*value;},fraction);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          scenario.samples.push({fraction,...await read()});if(scenario.samples.at(-1).errors.length)break;
        }
        if(scenario.samples.at(-1)?.errors.length)break;
        await page.locator('#app').evaluate((element,round)=>{element.style.width=[640,1400,1100][round]+'px';element.style.height=[320,880,680][round]+'px';},round);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        scenario.samples.push({resize:round,...await read()});save();
        if(scenario.samples.at(-1).errors.length)break;
      }
      scenario.final=await read();save();
      if(scenario.final.errors.length){await page.evaluate(()=>window.unmountFixture());continue;}
      if(args.columnResize==='1'){
        const target=pattern==='few'?725:714;
        await page.evaluate(index=>{window.audit.focusResolved=[];window.focusRow(index);},target);
        await page.waitForFunction(index=>window.audit.errors.length||window.audit.focusResolved.includes('focus:'+index),target);
        await page.waitForFunction(()=>window.audit.activeWorkers===0);
        const targetBox=await page.locator('[data-hazard-row-index="'+target+'"]').boundingBox(),scrollBox=await scroller.boundingBox();
        await page.mouse.move(scrollBox.x+Math.min(200,scrollBox.width/2),scrollBox.y+Math.min(180,scrollBox.height/2));
        await page.mouse.wheel(0,Math.min(1200,targetBox.height*0.6));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        // Keep the last column's eight-pixel handle clear of macOS's overlay
        // scrollbar hit region in this isolated fixture host.
        await scroller.evaluate(element=>{element.style.paddingRight='24px';});
        const resize=page.getByRole('button',{name:'Resize '+(pattern==='few'?'Hazard':'Causal Scenario'),exact:true});
        await resize.scrollIntoViewIfNeeded();
        scenario.columnResizes=[];
        for(const amount of [-160,220]){
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
          const before=await read(),box=await resize.boundingBox();assert.ok(box);
          const pointerProbe=await page.evaluate(({x,y})=>{const target=document.elementFromPoint(x,y);return {tag:target?.tagName,label:target?.getAttribute('aria-label'),viewport:{width:innerWidth,height:innerHeight}};},{x:box.x+box.width/2,y:box.y+box.height/2});
          await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
          const cursorAfterDown=await page.evaluate(()=>document.body.style.cursor);
          await page.mouse.move(box.x+box.width/2+amount,box.y+box.height/2,{steps:8});await page.mouse.up();
          await page.waitForFunction(()=>window.audit.activeWorkers===0);
          await page.waitForTimeout(250);
          const after=await read(),beforeAnchor=before.loaded.find(row=>row.visible),afterAnchor=after.loaded.find(row=>row.visible);
          scenario.columnResizes.push({amount,box,pointerProbe,cursorAfterDown,before,after,beforeAnchor,afterAnchor});save();
          assert.equal(afterAnchor?.id,beforeAnchor?.id,'Internal column resize must retain the visible source row');
          assert.ok(Math.abs(afterAnchor.viewportOffset-beforeAnchor.viewportOffset)<=2,'Internal column resize must retain the visible row offset');
          assert.notEqual(after.configuredWidth,before.configuredWidth,'The real resize button must change configured column width');
        }
      }
      await page.evaluate(()=>{window.audit.focusResolved=[];});
      await page.evaluate(index=>window.focusRow(index),result.rows-1);
      await page.waitForFunction(index=>window.audit.errors.length||window.audit.focusResolved.includes('focus:'+index),result.rows-1);
      scenario.focus=await read();
      await page.waitForFunction(()=>window.audit.activeWorkers===0);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))));
      scenario.idleStart=await read();await page.waitForTimeout(250);scenario.idle=await read();scenario.idleCommits=scenario.idle.commits-scenario.idleStart.commits;
      scenario.idleGeometryStable=scenario.idle.loaded.length===scenario.idleStart.loaded.length
        &&scenario.idle.loaded.every((row,index)=>row.id===scenario.idleStart.loaded[index].id&&Math.abs(row.height-scenario.idleStart.loaded[index].height)<=1)
        &&Math.abs(scenario.idle.width-scenario.idleStart.width)<=1&&Math.abs(scenario.idle.top-scenario.idleStart.top)<=1;
      await page.evaluate(()=>window.unmountFixture());await page.waitForFunction(()=>window.audit.activeWorkers===0);save();
    }
    result.finalAudit=await page.evaluate(()=>window.audit);save();
    assert.equal(result.finalAudit.errors.length,0,'Actual table must not throw while fast scrolling');
    assert.ok(result.scenarios.every(s=>!s.initial.errors.length&&!s.final?.errors.length),'Every scenario must remain free of table errors');
    assert.equal(result.errors.filter(error=>/maximum update depth|uncaught|resizeobserver loop/i.test(error.message)).length,0,'No update-depth or resize-observer loop errors');
    assert.ok(result.scenarios.every(s=>s.focus?.focusResolved.includes('focus:'+(result.rows-1))),'Every table mode must finish far-row focus');
    assert.ok(result.scenarios.every(s=>s.idleCommits<=2),'Measurements must settle instead of becoming an endless animation-frame render loop');
    assert.ok(result.scenarios.every(s=>s.idleGeometryStable),'Visible identities, row heights and table geometry must converge during idle');
    if(args.requireStableGeometry==='1')for(const scenario of result.scenarios){
      const samples=[scenario.initial,...scenario.samples,...(scenario.sustainedDown?.samples||[]),scenario.focus,scenario.idle];
      assert.ok(samples.every(sample=>sample.configuredWidth&&Math.abs(sample.width-parseFloat(sample.configuredWidth))<=2),'Explicit table width must remain stable across mounted row windows');
    }
    result.passed=true;save();
  }catch(error){result.failure={message:error.message,stack:error.stack};save();throw error;}
  finally{await browser?.close();await app?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
