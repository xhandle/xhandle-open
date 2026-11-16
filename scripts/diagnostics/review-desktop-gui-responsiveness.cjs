// Review only: actual production renderer/native shell, fresh synthetic profile; external calls and updates disabled.
// See docs/investigations/desktop-gui-responsiveness-review-2026-11-13.md for commands and measurement limits.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron,chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v.slice(2),all[i+1]]],[]));
const root=path.resolve(__dirname,'../..'),native=path.resolve(args.desktop||path.join(root,'../xhandle-desktop')),output=args.out,fixture={nodes:+(args.nodes||100),rows:+(args.rows||1000),artifacts:+(args.artifacts||1000)};
if(!output||!args.seeder)throw Error('Required: --out /tmp/run.json --seeder /tmp/fixtures/cba/seed.js. Optional: --desktop DIR --nodes N --rows N --artifacts N --cycles N --gestures N --packaged 1 --graphOnly 1 --browser chrome --extras 1 --extraSeeder FILE --broadOnly 1');
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-gui-native-')));fs.copyFileSync(__filename,output+'.harness.cjs');
const result={fixture,temp,source:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),nativeMetadata:JSON.parse(fs.readFileSync(native+'/build-metadata.json')),samples:[],errors:[],consoleErrors:[],blocked:[],phases:[],methodology:'Actual unmodified native shell and production stage; disposable profile; trusted input; synthetic saved CBA; no external network'};
const quant=a=>{const s=a.slice().sort((a,b)=>a-b);return {n:s.length,median:s.length?(s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2:null,p95Estimate:s.length>=5?s[Math.ceil(s.length*.95)-1]:null,max:s.at(-1)}};
let app,browser,server,page,cdp;const save=()=>fs.writeFileSync(output,JSON.stringify(result,null,2));
(async()=>{try{
 fs.mkdirSync(path.join(temp,'profile'));fs.mkdirSync(path.join(temp,'session'));
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 if(args.browser==='chrome'){
 const base=native+'/stage/renderer';server=require('node:http').createServer((req,res)=>{const f=path.join(base,new URL(req.url,'http://localhost').pathname);const target=fs.existsSync(f)&&fs.statSync(f).isFile()?f:path.join(base,'index.html');res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html');fs.createReadStream(target).pipe(res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,env});const context=await browser.newContext({viewport:{width:1440,height:809},deviceScaleFactor:2});await context.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'&&!u.pathname.startsWith('/api/')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'[]'})});page=await context.newPage();result.runtime={browser:browser.version(),shell:'Chrome; API fixtures, no native backend'};await page.goto('http://127.0.0.1:'+server.address().port);
 }else{
 fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'xhandle-gui-audit',version:'0.2.16',main:'main.cjs'}));
 fs.writeFileSync(path.join(temp,'main.cjs'),`const {app,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp,'profile'))});app.setPath('sessionData',${JSON.stringify(path.join(temp,'session'))});app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const u=new URL(details.url);callback({cancel:!['xhandle:','data:','blob:','devtools:','chrome-extension:'].includes(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)});}));require(${JSON.stringify(native+'/electron/main.cjs')});`);
 app=await _electron.launch({executablePath:args.packaged==='1'?args.binary||native+'/dist-signed/mac-arm64/xHandle.app/Contents/MacOS/xHandle':process.env.ELECTRON_PATH||require(path.join(native,'node_modules/electron')),args:args.packaged==='1'?['--user-data-dir='+path.join(temp,'profile'),'--disk-cache-dir='+path.join(temp,'cache')]:[temp],env});
 if(args.packaged==='1') await app.evaluate(({app,session})=>{
  const r=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
  const u=r('electron-updater').autoUpdater;
  u.autoDownload=false;u.autoInstallOnAppQuit=false;u.autoRunAppAfterInstall=false;
  u.checkForUpdates=async()=>({isUpdateAvailable:false,updateInfo:{version:app.getVersion()}});
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
   const url=new URL(details.url);
   callback({cancel:!['xhandle:','data:','blob:','devtools:','chrome-extension:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)});
  });
 });
 page=await app.firstWindow();await page.waitForURL('xhandle://app/');
 result.runtime=await app.evaluate(({app})=>({pid:process.pid,versions:process.versions,profile:app.getPath('userData'),gpu:app.getGPUFeatureStatus(),packaged:app.isPackaged}));assert.equal(result.runtime.profile,path.join(temp,'profile'));
 }
 page.setDefaultTimeout(90000);page.on('pageerror',e=>{result.errors.push(e.message);save()});page.on('console',msg=>{if(msg.type()==='error')result.consoleErrors.push(msg.text().slice(0,400))});
 await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
 const init=()=>{
  window.__audit={long:[],inputs:[],commits:[],reads:[],writes:[],frames:[],active:false};
  const push=(key,value)=>{if(window.__audit[key].length<20000)window.__audit[key].push(value)};
  window.__auditObserver=new PerformanceObserver(l=>l.getEntries().forEach(e=>push('long',{start:e.startTime,ms:e.duration})));window.__auditObserver.observe({type:'longtask',buffered:false});
  for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown','input'])document.addEventListener(type,e=>{if(e.isTrusted)push('inputs',{type,time:performance.now(),eventAt:e.timeStamp})},{passive:true,capture:true});
  for(const type of ['get','getAll','openCursor']){const orig=IDBObjectStore.prototype[type];IDBObjectStore.prototype[type]=function(){const t=performance.now();const r=orig.apply(this,arguments);const e={store:this.name,method:type,start:t};push('reads',e);r.addEventListener('success',()=>{e.ms=performance.now()-t;e.count=Array.isArray(r.result)?r.result.length:null});return r}}
  for(const type of ['setItem','getItem']){const orig=Storage.prototype[type];Storage.prototype[type]=function(k,v){const t=performance.now();const r=orig.apply(this,arguments);if(type==='setItem')push('writes',{key:k,ms:performance.now()-t,chars:v?.length||0});return r}}
 };
 await page.context().addInitScript(init);await page.evaluate(init);
 cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Performance.enable');
 result.harnessHash=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
 result.seederHash=crypto.createHash('sha256').update(fs.readFileSync(args.seeder)).digest('hex');
 const renderer=app?await app.evaluate(({app})=>app.isPackaged?process.resourcesPath+'/renderer':null):null;result.renderer=renderer||path.join(native,'stage/renderer');
 result.entryHashes=Object.fromEntries(JSON.parse(fs.readFileSync(path.join(result.renderer,'asset-manifest.json'))).entrypoints.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(result.renderer,name))).digest('hex')]));
 if(app)result.loadedMetadata=await page.evaluate(()=>window.xhandleDesktop.getBuildInfo());
 result.screen=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screen:{width:screen.width,height:screen.height},visibility:document.visibilityState}));
 await page.addScriptTag({path:args.seeder});
 console.log('SEED',fixture);result.seed=await page.evaluate(({nodes,rows,artifacts})=>window.seedCbaPerformance(rows,nodes,artifacts),fixture);
 await page.evaluate(()=>{localStorage.setItem('xhandle.sidebarLocked','true');localStorage.setItem('xhandle.projects',JSON.stringify([{id:'perf',name:'Functional performance fixture'},{id:'other',name:'Small project'}]));localStorage.setItem('xhandle.projectData',JSON.stringify({perf:{responseRows:Array.from({length:1000},(_,i)=>({id:'functional-'+i,fromFunction:'Function '+i%500,toFunction:'Function '+(i+1)%500,controlAction:'Command '+i})),riskMethod:'STPA',riskRegister:[],requirements:[]},other:{responseRows:[{fromFunction:'Small A',toFunction:'Small B',controlAction:'Status'}]}}));});
 if(args.extras==='1'){await page.addScriptTag({path:args.extraSeeder||path.resolve(path.dirname(args.seeder),'../extra.seed.js')});result.extras=await page.evaluate(rows=>window.seedAuditExtras({assessmentRows:rows}),fixture.rows);}
 await page.reload();await page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().waitFor();
 const reset=()=>page.evaluate(()=>{window.__auditObserver.takeRecords();for(const k of ['long','reads','writes','inputs','commits'])window.__audit[k]=[];window.__start=performance.now();});
 const collect=()=>page.evaluate(()=>{window.__auditObserver.takeRecords().forEach(e=>window.__audit.long.push({start:e.startTime,ms:e.duration}));return {...window.__audit,frames:undefined,start:window.__start,elapsed:performance.now()-window.__start,heap:performance.memory?.usedJSHeapSize,dom:document.querySelectorAll('*').length,nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,rows:document.querySelectorAll('tbody tr').length,visibility:document.visibilityState,focused:document.hasFocus()}});
 const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const measure=async(name,action,ready,profile=false)=>{console.log('MEASURE',name);await reset();if(profile)await cdp.send('Profiler.start');let failure;try{await action();await ready();await frame()}catch(e){failure=e.message}const sample={name,...await collect(),failure};const first=sample.inputs.find(e=>['pointerdown','keydown','input'].includes(e.type));if(first){sample.automationLeadMs=first.eventAt-windowStart(sample);sample.inputToUsableMs=sample.elapsed-(first.eventAt-windowStart(sample));}function windowStart(v){return v.start;} if(profile){const {profile:p}=await cdp.send('Profiler.stop');fs.writeFileSync(output+'.'+name.replace(/[^a-z0-9]/gi,'_')+'.cpuprofile',JSON.stringify(p))}result.samples.push(sample);save();if(failure)throw Error(name+': '+failure);return sample};
 const graph=()=>page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length>0&&!document.body.textContent.includes('Arranging diagram...'));
 const graphReady=()=>page.waitForFunction(({nodes,relationships})=>document.querySelectorAll('.react-flow__node-bidirectional').length===nodes&&document.querySelectorAll('.react-flow__edge-path').length===relationships,{nodes:fixture.nodes,relationships:result.seed.architectureRows});
 const menu=()=>page.getByLabel('Code architecture actions',{exact:true}).click();
 const memory=async label=>{result.phases.push({label,at:Date.now(),heap:await page.evaluate(()=>performance.memory?.usedJSHeapSize),processes:app?await app.evaluate(({app})=>app.getAppMetrics()):[]});save()};
 async function gesture(name,type,profile=false){
 await page.locator('.react-flow__controls-fitview').click();await page.waitForTimeout(800);const pane=await page.locator('.react-flow__pane').boundingBox();assert(pane);const p=await page.evaluate(()=>{const r=document.querySelector('.react-flow__pane').getBoundingClientRect();for(let y=Math.max(120,r.top+20);y<Math.min(innerHeight-90,r.bottom-90);y+=30)for(let x=Math.max(300,r.left+200);x<Math.min(innerWidth-170,r.right-170);x+=35)if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return {x,y};return null});assert(p,'Visible unobstructed pane required');await page.mouse.move(p.x,p.y);
 const before=await page.locator('.react-flow__viewport').getAttribute('style');await reset();
 await page.evaluate(()=>{window.__audit.frames=[];window.__audit.active=true;let last=performance.now();const tick=t=>{if(!window.__audit.active)return;window.__audit.frames.push({at:t,ms:t-last,transform:document.querySelector('.react-flow__viewport')?.getAttribute('style')});last=t;requestAnimationFrame(tick)};requestAnimationFrame(tick)});
 if(profile){await cdp.send('Profiler.start');await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,cc,gpu',transferMode:'ReturnAsStream'})}
 if(type==='pan'){await page.mouse.down({button:'middle'});for(let i=0;i<30;i++){await page.mouse.move(p.x-i*2,p.y-i);await page.waitForTimeout(16)}await page.mouse.up({button:'middle'})}else for(let i=0;i<30;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY:i%2?-6:6,modifiers:2});await page.waitForTimeout(16)}
 await frame();const after=await page.locator('.react-flow__viewport').getAttribute('style');const active=await page.evaluate(()=>{window.__audit.active=false;const events=window.__audit.inputs.filter(e=>['pointerdown','pointermove','pointerup','wheel'].includes(e.type));const start=events[0]?.time,end=events.at(-1)?.time;return {events:events.length,start,end,frames:window.__audit.frames.filter(f=>f.at-f.ms>=start&&f.at<=end).map(f=>f.ms),transformStates:new Set(window.__audit.frames.map(f=>f.transform)).size}});
 const sample={name,...await collect(),gesture:{...active,rawFrameMs:active.frames,frames:quant(active.frames),transformChanged:before!==after}};result.samples.push(sample);save();
 if(profile){const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const {stream}=await done;let trace='';for(;;){const c=await cdp.send('IO.read',{handle:stream});trace+=c.data;if(c.eof)break}await cdp.send('IO.close',{handle:stream});fs.writeFileSync(output+'.'+name+'.trace.json',trace);const {profile:p}=await cdp.send('Profiler.stop');fs.writeFileSync(output+'.'+name+'.cpuprofile',JSON.stringify(p));}
 assert(active.events>0);assert(active.transformStates>1,'Actual camera transforms must change during input');if(type==='pan')assert(before!==after,'Pan must change actual viewport');
 }
 if(args.broadOnly==='1'){await require('./desktop-gui-responsiveness-scenario.cjs')({page,cdp,result,measure,scroll,frame,save,gesture});return;}
 await measure('CBA cold graph',()=>page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().click(),graphReady,true);await page.waitForTimeout(1200);await memory('graph loaded');
 if(args.inspect==='1'){result.body=await page.locator('body').innerText();save();return}
 if(args.isolateEdges==='1'){await page.addStyleTag({content:'.react-flow__edge { visibility: hidden !important }'});result.diagnosticOnly='Edge visibility removed for attribution, not acceptance';}
 if(args.gestures!=='0'){await gesture('warmup-pan','pan');await gesture('warmup-zoom','zoom');for(let i=0;i<+(args.gestures||5);i++){await gesture('pan-'+i,'pan',i===0);await gesture('zoom-'+i,'zoom',i===0)}}
 if(args.graphOnly==='1')return;
 for(const level of ['CSC','CSCI','Subsystem','Functional','CSU'])await measure('Abstraction '+level,()=>page.getByRole('button',{name:level,exact:true}).click(),level==='CSU'?graphReady:graph,true);
 await menu();await measure('CBA Architecture Table',()=>page.getByRole('button',{name:'Table',exact:true}).click(),()=>page.getByRole('button',{name:'Copy code architecture functional decomposition table',exact:true}).waitFor(),true);
 const views={
 'Software Requirements':()=>page.locator('tbody').filter({hasText:'SWR-0'}).waitFor(),
 'System Requirements':()=>page.locator('tbody').filter({hasText:'SYS-0'}).waitFor(),
 'Subsystem Requirements':()=>page.locator('tbody').filter({hasText:'SUB-0'}).waitFor(),
 'System / Subsystem Design':()=>page.locator('tbody').filter({hasText:'DES-0'}).waitFor(),
 'Traceability Matrix':()=>page.locator('tbody').filter({hasText:'TRACE-'}).waitFor(),
 'Hazard & Remediation':async()=>{await page.locator('tbody td').first().waitFor()}};
 async function scroll(name){const handle=await page.locator('tbody').first().evaluateHandle(body=>{let e=body.parentElement;while(e){if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+100)return e;e=e.parentElement}return null});const box=await handle.asElement()?.boundingBox();if(!box){result.samples.push({name:'Scroll '+name,unavailable:'No overflowing table'});save();return}const before=await handle.evaluate(e=>e.scrollTop);await measure('Scroll '+name,async()=>{await page.mouse.move(box.x+box.width*.4,box.y+Math.min(150,box.height*.4));for(let i=0;i<20;i++){await page.mouse.wheel(0,150);await page.waitForTimeout(16)}},()=>frame());const after=await handle.evaluate(e=>e.scrollTop);result.samples.at(-1).scroll={before,after};assert(after>before,'Actual table must scroll');save()}
 for(const [name,ready]of Object.entries(views)){await measure('CBA '+name,()=>page.getByRole('button',{name,exact:true}).click(),ready,true);await scroll(name)}
 for(let i=0;i<+(args.cycles||25);i++){for(const name of ['Software Requirements','Hazard & Remediation'])await measure('Warm '+name,async()=>{await page.getByRole('button',{name,exact:true}).click();if(name==='Hazard & Remediation'&&await page.getByRole('button',{name:'Code Architecture Hazard Analysis',exact:true}).isVisible())await page.getByRole('button',{name:'Code Architecture Hazard Analysis',exact:true}).click()},views[name]);if(i%5===0)await memory('cycle '+i)}
 await memory('after cycles');
 await measure('Small CBA project',async()=>{await page.getByRole('button',{name:'Other CBA fixture',exact:true}).first().click();await page.getByRole('button',{name:'Architecture Diagram',exact:true}).click();await menu();await page.getByRole('button',{name:'Architecture',exact:true}).click()},graph,true);
 await measure('Return large CBA',()=>page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().click(),graphReady,true);
 for(const name of ['Reports','Design Management','System Test','Safety Case','Collaborator']){await measure('Area '+name,()=>page.getByRole('button',{name,exact:true}).first().click(),()=>frame(),true);await page.waitForTimeout(800);result.phases.push({label:'body '+name,text:(await page.locator('body').innerText()).slice(0,10000)});save()}
 result.summary=Object.fromEntries([...new Set(result.samples.map(s=>s.name))].map(name=>[name,quant(result.samples.filter(s=>s.name===name&&s.elapsed!=null).map(s=>s.elapsed))]));
 }catch(e){result.fatal=e.stack;console.error(e);if(page&&!page.isClosed())fs.writeFileSync(output+'.body.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1}finally{save();if(app)await app.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});if(server)server.close();console.log('OUTPUT',output)}})();
