// Full production App, disposable profile, fixture-only network. No installed shell/updater.
// node ... --build /absolute/build --out /tmp/run.json --nodes 100 --rows 1000
// Fast attribution: --graphOnly 1 --isolate '.react-flow__edge' --isolateStyle 'visibility:hidden !important'
// Isolation changes presentation only and is never acceptance evidence. --trace 0 omits gesture profiling/tracing.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const { _electron, chromium }=require(process.env.PLAYWRIGHT_MODULE || '/tmp/xhandle-delete-browser/node_modules/playwright-core');
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v.slice(2),all[i+1]]],[]));
const build=path.resolve(args.build),out=path.resolve(args.out),nodes=+(args.nodes||100),rows=+(args.rows||1000);
const samples=Number(args.samples??3);
if(!Number.isInteger(samples)||samples<1)throw Error('--samples must be a positive integer (use at least 3 for acceptance runs)');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-full-app-perf-'));
const electron=process.env.ELECTRON_PATH || '/Users/Nick/xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const quant=a=>{const s=a.slice().sort((x,y)=>x-y);return {n:s.length,median:s[Math.floor(s.length*.5)],...(s.length>=5?{p95:s[Math.ceil(s.length*.95)-1]}:{}),max:s.at(-1)};};
(async()=>{
 let app,browser,server,page,context;
 const errors=[],requests=[],result={fixture:{nodes,relationships:nodes*2,hazardRows:rows,seed:30},build,workspace:args.workspace||'functional-project',seederHash:args.workspace==='cba'?crypto.createHash('sha256').update(fs.readFileSync(path.resolve(args.seeder||'/tmp/xhandle-interaction-seeder/seed.js'))).digest('hex'):null,buildHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(build,'asset-manifest.json'))).digest('hex'),hardware:{cpu:os.cpus()[0].model,ram:os.totalmem(),arch:os.arch()},temp};
 result.methodology={version:2,samplesPerGesture:samples,gestureFrames:'rAF intervals wholly within first/last trusted input; no idle tail',warmup:'one discarded pan and zoom before samples',sampleStart:'Fit View, then wait for stable transform',tracedGestures:args.trace!=='0',graphOnly:args.graphOnly==='1',note:'Version 1 timings include setup and idle frames; rerun both builds with this harness for matched comparisons.'};
 result.harnessHashes=Object.fromEntries([__filename,path.join(__dirname,'desktop-performance-cba-scenario.cjs'),path.join(__dirname,'cba-rendering-regression.cjs')].map(file=>[path.basename(file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 if(args.hazardScroll==='1')result.harnessHashes['continuous-hazard-scrolling.cjs']=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'continuous-hazard-scrolling.cjs'))).digest('hex');
 if(args.loadingUi==='1')result.harnessHashes['verify-cba-tab-loading.cjs']=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'verify-cba-tab-loading.cjs'))).digest('hex');
 const manifest=JSON.parse(fs.readFileSync(path.join(build,'asset-manifest.json'),'utf8'));
 result.entryAssetHashes=Object.fromEntries((manifest.entrypoints||[]).map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(build,file.replace(/^\//,'')))).digest('hex')]));
 try{

 if(args.browser==='chrome'){
  server=require('node:http').createServer((req,res)=>{let f=path.join(build,decodeURIComponent(req.url.split('?')[0]));if(!fs.existsSync(f)||!fs.statSync(f).isFile())f=path.join(build,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:false,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});context=await browser.newContext({viewport:{width:1440,height:920},deviceScaleFactor:+(args.dpr||2)});page=await context.newPage();result.runtime={chrome:browser.version(),systemInfo:await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo')};result.url='http://127.0.0.1:'+server.address().port;
 }else{
  const main=path.join(temp,'main.cjs');fs.writeFileSync(main,`const {app,BrowserWindow,protocol,net,session}=require('electron');const {pathToFileURL}=require('node:url');const path=require('node:path');app.setPath('userData',${JSON.stringify(path.join(temp,'profile'))});protocol.registerSchemesAsPrivileged([{scheme:'xhandle',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));protocol.handle('xhandle',req=>{let p=decodeURIComponent(new URL(req.url).pathname);if(p==='/')p='/index.html';return net.fetch(pathToFileURL(path.join(${JSON.stringify(build)},p)).href);});new BrowserWindow({width:1440,height:920,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}).loadURL('about:blank');});`);
  app=await _electron.launch({executablePath:electron,args:[main],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});page=await app.firstWindow();context=app.context();result.runtime=await app.evaluate(async({app})=>({versions:process.versions,gpu:app.getGPUFeatureStatus(),gpuInfo:await app.getGPUInfo('basic'),flags:process.argv}));result.url='xhandle://app/';
 }
 page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const u=route.request().url();if(u.includes('/api/')||(!u.startsWith(result.url)&&!u.startsWith('data:')&&!u.startsWith('blob:'))){requests.push(u);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(u.includes('settings')?{}:[])});}return route.continue();});
 await context.addInitScript(()=>{
  window.__perf={commits:[],long:[],storage:[],reads:[],writes:[],events:[]};let id=0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>++id,onCommitFiberRoot:(renderer,root)=>window.__perf.commits.push({time:performance.now(),duration:root.current.actualDuration??null}),onCommitFiberUnmount:()=>{}};
  new PerformanceObserver(l=>window.__perf.long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  for(const name of ['getItem','setItem']){const orig=Storage.prototype[name];Storage.prototype[name]=function(k,v){const t=performance.now();const r=orig.apply(this,arguments);window.__perf.storage.push({name,key:k,chars:(name==='getItem'?r:v)?.length||0,ms:performance.now()-t});return r;};}
  for(const name of ['put','add','delete']){const original=IDBObjectStore.prototype[name];IDBObjectStore.prototype[name]=function(value){window.__perf.writes.push({store:this.name,method:name,key:value?.key||value?.id||null,time:performance.now()});return original.apply(this,arguments);};}
  for(const name of ['xhandle:data-changed','xhandle:code-architecture-assurance:changed','xhandle:code-architecture-hazard-analysis:changed'])window.addEventListener(name,()=>window.__perf.events.push({name,time:performance.now()}));
  for(const name of ['get','getAll','openCursor']){const orig=IDBObjectStore.prototype[name];IDBObjectStore.prototype[name]=function(){const r=orig.apply(this,arguments);const entry={store:this.name,method:name,time:performance.now()};window.__perf.reads.push(entry);r.addEventListener('success',()=>{const v=r.result;entry.bytes=typeof v==='string'?v.length*2:null;});return r;};}
 });
 console.log('loading',result.url);await page.goto(result.url);await page.waitForTimeout(500);console.log('seeding');
 result.fixtureStorage=args.workspace==='cba'?null:await page.evaluate(async({nodes,rows})=>{
  const data=Array.from({length:nodes*2},(_,i)=>({id:'r'+i,fromFunction:'Function '+i%nodes,toFunction:'Function '+(i+(i<nodes?1:7))%nodes,controlAction:'Command '+i,fromDetails:'Validates sensor state and rejects outdated commands. '.repeat(3),toDetails:'Reports state with timestamp.',controlDetails:'Sequence, timeout and acknowledgement checks.',source:{file:'src/controller_'+i%25+'.cpp',line:i+1}}));
  const summary=[['Raw Analysis Row ID','Function (From)','Function (To)','Control Action','Hazard','Loss','Causal Scenario','Mitigation Strategy'],...Array.from({length:rows},(_,i)=>['HA-'+i,'Function '+i%nodes,'Function '+(i+1)%nodes,'Command '+i% (nodes*2),'Unsafe motion '+i,'Physical injury','Outdated command accepted after operating state changes. '.repeat(2),'Validate command sequence and expiration before actuation.'])];
  localStorage.setItem('xhandle.projects',JSON.stringify([{id:'perf',name:'Performance fixture',createdAt:'2026-10-30T00:00:00Z'},{id:'other',name:'Other fixture',createdAt:'2026-10-30T00:00:00Z'}]));
  const map={perf:{responseRows:data,analysisResult:{Summary:summary},riskMethod:'STPA',riskRegister:[],requirements:[]},other:{responseRows:data.slice(0,10),riskRegister:[],requirements:[]}};
  const text=JSON.stringify(map);localStorage.setItem('xhandle.projectData',text);localStorage.setItem('xhandle.sidebarProjectsOpen','true');localStorage.setItem('xhandle.sidebarLocked','true');
  // Saved layout removes auto-layout variability; geometry and all graph elements remain real.
  const positions=Array.from({length:nodes},(_,i)=>['n:Function '+i,{position:{x:(i%20)*300,y:Math.floor(i/20)*160}}]);localStorage.setItem('diagram:positions:perf',JSON.stringify(positions));localStorage.setItem('diagram:positions:perf:initial-layout:v1','complete');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle-perf-inactive',1);r.onupgradeneeded=()=>r.result.createObjectStore('history');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const evidence='Evidence for deterministic source review. '.repeat(25000);await new Promise((resolve,reject)=>{const tx=db.transaction('history','readwrite');for(let i=0;i<24;i++)tx.objectStore('history').put({source:'file-'+i,checkpoint:i,text:evidence},i);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  return {projectMapUTF8Bytes:new TextEncoder().encode(text).length,inactiveEvidenceUTF8Bytes:evidence.length*24,storageEstimate:await navigator.storage.estimate()};
 },{nodes,rows});
 if(args.workspace==='cba'){await page.addScriptTag({path:path.resolve(args.seeder||'/tmp/xhandle-interaction-seeder/seed.js')});result.cbaFixture=await page.evaluate(({rows,nodes,artifacts})=>window.seedCbaPerformance(rows,nodes,artifacts),{rows,nodes,artifacts:+(args.artifacts||1000)});console.log('CBA fixture',result.cbaFixture);}
 if(result.cbaFixture)result.fixture.relationships=result.cbaFixture.architectureRows;
 console.log('fixture',result.fixtureStorage);await page.reload();console.log('opening project');
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Profiler.enable');
 const processMemory=async()=>{
  if(app)return (await app.evaluate(({app})=>app.getAppMetrics())).map(({type,memory})=>({type,...memory}));
  const session=await browser.newBrowserCDPSession();const {processInfo}=await session.send('SystemInfo.getProcessInfo');await session.detach();
  const ids=processInfo.map(p=>p.id).filter(Number.isInteger);if(!ids.length)return [];
  const output=require('node:child_process').execFileSync('ps',['-o','pid=,rss=','-p',ids.join(',')],{encoding:'utf8'});
  const rss=new Map(output.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)));
  return processInfo.filter(p=>rss.has(p.id)).map(p=>({type:p.type,residentKiB:rss.get(p.id)}));
 };
 const reset=()=>page.evaluate(()=>{for(const k of Object.keys(window.__perf))window.__perf[k]=[];window.__start=performance.now();});
 const collect=async()=>page.evaluate(()=>{const pane=document.querySelector('.react-flow__pane')?.getBoundingClientRect();return {...window.__perf,elapsed:performance.now()-window.__start,heap:performance.memory?.usedJSHeapSize,dom:document.querySelectorAll('*').length,handles:document.querySelectorAll('.react-flow__handle').length,nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,rows:document.querySelectorAll('tbody tr').length,accessibleRowCount:document.querySelector('table[aria-rowcount]')?.getAttribute('aria-rowcount'),viewport:{width:window.innerWidth,height:window.innerHeight},pane:pane?{x:pane.x,y:pane.y,width:pane.width,height:pane.height}:null,dpr:devicePixelRatio,visibility:document.visibilityState,focused:document.hasFocus()};});
 const finishGraphOnly=async()=>{result.graphOnly=true;result.finalGraph=await collect();await cdp.send('HeapProfiler.collectGarbage');result.heapAfterDiagnosticGC=await page.evaluate(()=>performance.memory?.usedJSHeapSize);result.domCounters=await cdp.send('Memory.getDOMCounters');result.finalMetrics=await cdp.send('Performance.getMetrics');result.processMetrics=app?await app.evaluate(({app})=>app.getAppMetrics()):null;};
 const readyGraph=()=>page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length>0&&document.querySelector('.react-flow')?.style.visibility==='visible');
 if(args.workspace==='cba'){
  await require('./desktop-performance-cba-scenario.cjs')({page,cdp,reset,collect,interaction,prepareInteractions,finishGraphOnly,result,args,out,quant,app});
  if(args.verify==='1')assert.deepEqual(errors,[],'Actual App must not emit page errors');
  result.errors=errors;result.fixtureAPIRequests=requests;fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({out,cba:result.cbaSummary,errors},null,2));return;
 }
 await reset();await cdp.send('Profiler.start');await page.getByRole('button',{name:'Performance fixture',exact:true}).click();await readyGraph();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));result.cold=await collect();const coldProfile=await cdp.send('Profiler.stop');fs.writeFileSync(out+'.cold.cpuprofile',JSON.stringify(coldProfile.profile));console.log('cold',result.cold.elapsed);await page.waitForTimeout(2000);
 if(args.verifyPaint==='1'){
  const readPaint=()=>page.evaluate(()=>{
   const edge=document.querySelector('.react-flow__edge-path');
   const style=getComputedStyle(edge);
   const id=edge.getAttribute('marker-end')?.replace(/^url\(['"]?#/,'').replace(/['"]?\)$/,'');
   const glyph=id&&document.getElementById(id)?.querySelector('polyline');
   return {opacity:style.opacity,strokeOpacity:style.strokeOpacity,stroke:style.stroke,markerFill:glyph&&getComputedStyle(glyph).fill};
  });
  result.functionalPaint={light:await readPaint()};
  assert.equal(Number(result.functionalPaint.light.opacity),1);
  assert.equal(Number(result.functionalPaint.light.strokeOpacity),0.92);
  assert.match(result.functionalPaint.light.markerFill,/0\.92\)/);
  const wasDark=await page.evaluate(()=>{const root=document.documentElement;const dark=root.classList.contains('dark');root.classList.add('dark');return dark;});
  result.functionalPaint.dark=await readPaint();
  assert.equal(Number(result.functionalPaint.dark.strokeOpacity),0.92);
  assert.equal(result.functionalPaint.dark.stroke,'rgb(106, 168, 255)');
  if(!wasDark)await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 }
 if(args.verifyports==='1'){const assert=require('node:assert/strict');const initial=await page.locator('.react-flow__handle').count();assert.ok(initial<=nodes*8,'Large project diagram must prune idle ports');const paths=await page.locator('.react-flow__edge-path').evaluateAll(es=>es.map(e=>e.getAttribute('d')));const node=page.locator('.react-flow__node-bidirectional').nth(Math.floor(nodes/2));await node.hover({force:true});await page.waitForTimeout(200);assert.equal(await node.locator('.react-flow__handle').count(),32);await page.mouse.move(5,5);await page.waitForTimeout(200);assert.equal(await page.locator('.react-flow__handle').count(),initial);assert.deepEqual(await page.locator('.react-flow__edge-path').evaluateAll(es=>es.map(e=>e.getAttribute('d'))),paths);result.portVerification={initial,hover:32,geometryPreserved:true};}
 async function fitForInteraction(){
  await page.evaluate(()=>{let element=document.querySelector('.react-flow');while(element){element.scrollLeft=0;element.scrollTop=0;element=element.parentElement;}});
  await page.locator('.react-flow__controls-fitview').click();
  // Fit animations and presentation-detail restoration must finish outside the measured interval.
  await page.waitForTimeout(650);
  await page.evaluate(()=>new Promise((resolve,reject)=>{let last='',stable=0,frames=0;const tick=()=>{const next=document.querySelector('.react-flow__viewport')?.getAttribute('style');stable=next&&next===last?stable+1:0;last=next;if(stable>=4)return resolve();if(++frames>240)return reject(Error('Viewport did not settle after Fit View'));requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
 }
 async function prepareInteractions(){
  if(args.isolate){
   const selector=args.isolate,style=args.isolateStyle||'visibility: hidden !important';
   const matched=await page.locator(selector).count();assert.ok(matched>0,'Isolation selector must match actual App elements');
   const appliedSelector=args.isolateWhen==='moving'?`.x-csu-large[data-viewport-moving] ${selector}`:selector;
   await page.addStyleTag({content:`${appliedSelector} { ${style} }`});
   result.isolation={selector:appliedSelector,style,matched,diagnosticOnly:true,note:'Presentation is deliberately altered for attribution; this run is not acceptance evidence.'};
  }
  if(args.interactions==='skip')return;
  result.gestureWarmup=[];
  for(const kind of ['pan','zoom'])result.gestureWarmup.push(await interaction('warmup-'+kind,kind,true));
 }
 async function interaction(name,kind,warmup=false){
  console.log(name);await fitForInteraction();
  const memoryBefore=args.processMemory==='1'&&!warmup?await processMemory():null;
  const point=await page.evaluate(()=>{const r=document.querySelector('.react-flow__pane').getBoundingClientRect();for(let y=Math.max(120,r.top+20);y<Math.min(window.innerHeight-90,r.bottom-90);y+=30)for(let x=Math.max(300,r.left+200);x<Math.min(window.innerWidth-170,r.right-170);x+=35){const e=document.elementFromPoint(x,y);if(e?.classList.contains('react-flow__pane'))return {x,y};}return null;});
  if(!point)throw Error('No visible unobstructed diagram pane for trusted input');await page.mouse.move(point.x,point.y);
  const traceEnabled=!warmup&&args.trace!=='0';
  if(traceEnabled){await cdp.send('Profiler.start');await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing'+(args.gpuTrace==='1'?',cc,gpu,viz,benchmark,disabled-by-default-devtools.timeline.frame':''),transferMode:'ReturnAsStream'});}
  await reset();
  await page.evaluate(kind=>{
   const viewport=document.querySelector('.react-flow__viewport');
   const sample={before:viewport?.getAttribute('style'),frames:[],transforms:[],events:[],first:null,last:null,active:true,raf:null};
   const types=kind==='pan'?['pointerdown','pointermove','pointerup']:['wheel'];
   const onInput=event=>{if(kind==='pan'&&event.type==='pointermove'&&!(event.buttons&4))return;const time=performance.now();if(sample.first===null)sample.first=time;sample.last=time;sample.events.push({type:event.type,time,trusted:event.isTrusted});};
   types.forEach(type=>window.addEventListener(type,onInput,{capture:true,passive:true}));
   let last=performance.now();const tick=time=>{if(!sample.active)return;sample.frames.push({start:last,end:time,ms:time-last});sample.transforms.push({time,style:viewport?.getAttribute('style')});last=time;sample.raf=requestAnimationFrame(tick);};sample.raf=requestAnimationFrame(tick);
   sample.stop=()=>{sample.active=false;cancelAnimationFrame(sample.raf);types.forEach(type=>window.removeEventListener(type,onInput,true));};window.__gesture=sample;
  },kind);
  try{
   if(kind==='pan'){await page.mouse.down({button:'middle'});for(let i=0;i<35;i++){await page.mouse.move(point.x+i*4,point.y+i*2);await page.waitForTimeout(16);}await page.mouse.up({button:'middle'});}
   else for(let i=0;i<35;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:0,deltaY:i%2?-3:3,modifiers:2});await page.waitForTimeout(16);}
  }finally{await page.evaluate(()=>window.__gesture?.stop());}
  const measured=await page.evaluate(()=>{const s=window.__gesture;const frames=s.frames.filter(f=>s.first!==null&&f.start>=s.first&&f.end<=s.last).map(f=>f.ms);return {frames,inputStart:s.first,inputEnd:s.last,firstRafAfterInputMs:s.frames.find(f=>f.end>=s.first)?.end-s.first,activeInputMs:s.last-s.first,inputEvents:s.events,transformSamples:[s.before,...s.transforms.filter(t=>t.time>=s.first&&t.time<=s.last).map(t=>t.style),document.querySelector('.react-flow__viewport')?.getAttribute('style')]};});
  const active=await collect();const transforms=measured.transformSamples;const scales=transforms.map(s=>s?.match(/scale\(([^)]+)\)/)?.[1]);
  const memoryAfterInput=args.processMemory==='1'&&!warmup?await processMemory():null;
  assert.ok(measured.inputEvents.length>2&&measured.inputEvents.every(event=>event.trusted),'Gesture must contain trusted browser inputs');
  assert.ok(measured.frames.length>3,'Gesture must contain enough active-input frame intervals');
  if(kind==='zoom'&&new Set(scales).size<2)throw Error('Trusted pinch did not change zoom scale');
  if(new Set(transforms).size<2)throw Error('Trusted '+name+' input did not change viewport');
  const costs={};
  if(traceEnabled){
   const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await done;let trace='';for(;;){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});fs.writeFileSync(out+'.'+name+'.trace.json',trace);const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(out+'.'+name+'.cpuprofile',JSON.stringify(profile));
   for(const event of JSON.parse(trace).traceEvents)if(event.ph==='X'&&event.dur&&['Layout','Paint','UpdateLayoutTree','FunctionCall','MinorGC','MajorGC','RunTask'].includes(event.name))costs[event.name]=(costs[event.name]||0)+event.dur/1000;
  }
  // Idle restoration is recorded separately, never mixed into active-input frame quantiles.
  await page.waitForTimeout(300);
  const settled=await page.evaluate(()=>({time:performance.now(),viewportMoving:document.querySelector('.x-csu-large, .project-functional-diagram')?.hasAttribute('data-viewport-moving')||false,willChange:getComputedStyle(document.querySelector('.react-flow__viewport')).willChange,transform:document.querySelector('.react-flow__viewport')?.getAttribute('style')}));
  const memorySettled=args.processMemory==='1'&&!warmup?await processMemory():null;
  if(args.verify==='1'){assert.equal(settled.viewportMoving,false,'Motion detail must restore after idle');assert.notEqual(settled.willChange,'transform','Temporary compositor hint must release after idle');}
  const sample={...active,frames:quant(measured.frames),over25ms:measured.frames.filter(v=>v>25).length,firstRafAfterInputMs:measured.firstRafAfterInputMs,activeInputMs:measured.activeInputMs,inputEvents:measured.inputEvents,transformChanged:new Set(transforms).size>1,transformSamples:transforms,zoomScaleChanges:new Set(scales).size,traceCostsMs:costs,traced:traceEnabled,memoryBefore,memoryAfterInput,memorySettled,settled:{afterInputMs:settled.time-measured.inputEnd,viewportMoving:settled.viewportMoving,willChange:settled.willChange,transform:settled.transform}};
  if(!warmup)result[name]=sample;return sample;
 }
 await prepareInteractions();
 for(let i=0;i<(args.interactions==='skip'?0:samples);i++){await interaction('pan'+i,'pan');await interaction('zoom'+i,'zoom');}
 if(args.graphOnly==='1'){await finishGraphOnly();result.errors=errors;result.fixtureAPIRequests=requests;if(args.verify==='1')assert.deepEqual(errors,[],'Actual App must not emit page errors');fs.writeFileSync(out,JSON.stringify(result,null,2));return;}
 // Actual table renderer and trusted wheel input.
 console.log('table');await page.getByLabel('Functional diagram actions',{exact:true}).click();await reset();await page.getByRole('button',{name:'Table',exact:true}).click();await page.getByRole('textbox',{name:'Function (From), row 1',exact:true}).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));result.openFunctionalTable=await collect();
 await reset();await page.evaluate(()=>{window.__frames=[];window.__active=true;window.__last=performance.now();const tick=t=>{if(!window.__active)return;window.__frames.push(t-window.__last);window.__last=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);});const cell=page.getByRole('textbox',{name:'Function (From), row 1',exact:true});await cell.hover();await page.evaluate(()=>{window.__scrollStart=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+200&&getComputedStyle(e).overflowY==='auto').map(e=>({el:e,top:e.scrollTop}));});
 for(let i=0;i<30;i++){await page.mouse.wheel(0,200);await page.waitForTimeout(16);}result.tableScroll={...await collect(),frames:quant(await page.evaluate(()=>{window.__active=false;return window.__frames.slice(3);})),scrollChanges:await page.evaluate(()=>window.__scrollStart.map(({el,top})=>({before:top,after:el.scrollTop})))};
 assert.ok(result.tableScroll.scrollChanges.some(change=>change.after>change.before),'Trusted wheel input must move the actual functional table');
 result.switches=[];for(let i=0;i<+(args.cycles||20);i++){
  for(const name of ['Hazard Analysis','Functional Diagramming']){await reset();await page.getByRole('tab',{name,exact:true}).click();if(name==='Hazard Analysis')await page.locator('tbody td').first().waitFor();else await page.getByRole('textbox',{name:'Function (From), row 1',exact:true}).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const s=await collect();result.switches.push({tab:name,...s});}
 }
 result.switchSummary=Object.fromEntries(['Hazard Analysis','Functional Diagramming'].map(t=>[t,quant(result.switches.filter(s=>s.tab===t).map(s=>s.elapsed))]));
 result.navigationHeapBeforeGC=await page.evaluate(()=>performance.memory?.usedJSHeapSize);await cdp.send('HeapProfiler.collectGarbage');result.navigationHeapAfterGC=await page.evaluate(()=>performance.memory?.usedJSHeapSize);
 if(args.verify==='1') {
 const assert=require('node:assert/strict');result.verification={};
 const total=nodes*2;assert.ok(await page.locator('tbody tr').count()<100,'Functional table must bound mounted rows');
 result.verification.boundedRows=true;
 await page.getByRole('button',{name:'Quick search',exact:true}).click();
 await page.getByRole('combobox',{name:'Search current view'}).fill('Command '+(total-1));
 await page.getByRole('listbox',{name:'Search results'}).getByRole('option').first().click();
 const last=page.getByRole('textbox',{name:'Control Action, row '+total,exact:true});await last.waitFor();
 assert.equal(await last.inputValue(),'Command '+(total-1));result.verification.offscreenSearch=true;
 await last.fill('INTERACTION-EDIT '+(total-1));await page.getByRole('tab',{name:'Hazard Analysis',exact:true}).click();
 await page.getByRole('tab',{name:'Functional Diagramming',exact:true}).click();
 await page.getByRole('button',{name:'Quick search',exact:true}).click();await page.getByRole('combobox',{name:'Search current view'}).fill('INTERACTION-EDIT');
 await page.getByRole('listbox',{name:'Search results'}).getByRole('option').first().click();assert.equal(await last.inputValue(),'INTERACTION-EDIT '+(total-1));
 await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData')).perf.responseRows.length),total);result.verification.fullRowCountRetained=true;
 await page.getByRole('button',{name:'Other fixture',exact:true}).click();await page.waitForTimeout(500);await page.getByRole('button',{name:'Performance fixture',exact:true}).click();await page.waitForTimeout(1000);
 await page.reload();await page.getByRole('button',{name:'Performance fixture',exact:true}).click();await readyGraph();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xhandle.projectData')).perf.responseRows.at(-1).controlAction),'INTERACTION-EDIT '+(total-1));result.verification.editSurvivesScopeSwitchAndReload=true;
}
 result.idleMemory=[];for(let i=0;i<3;i++){await page.waitForTimeout(1000);result.idleMemory.push(await page.evaluate(()=>performance.memory?.usedJSHeapSize));}await cdp.send('HeapProfiler.collectGarbage');result.heapAfterDiagnosticGC=await page.evaluate(()=>performance.memory?.usedJSHeapSize);result.finalMetrics=await cdp.send('Performance.getMetrics');result.processMetrics=app?await app.evaluate(({app})=>app.getAppMetrics()):null;result.errors=errors;result.fixtureAPIRequests=requests;
 if(args.verify==='1')assert.deepEqual(errors,[],'Actual App must not emit page errors');
 fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({out,cold:result.cold.elapsed,switches:result.switchSummary,pan:result.pan0?.frames,errors},null,2));
 }catch(error){fs.writeFileSync(out+'.partial.json',JSON.stringify(result,null,2));if(page&&!page.isClosed()){fs.writeFileSync(out+'.body.txt',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:out+'.error.png'}).catch(()=>{});}throw error;}finally{await app?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{fs.writeFileSync(out+'.error.txt',e.stack);console.error(e);process.exitCode=1;});
