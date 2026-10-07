// Isolated synthetic CSU/Functional parity fixture. No customer data or model calls.
const { chromium } = require('/tmp/xhandle-copy-check/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
 const results=[];
 try {
 for(const count of (process.env.COUNT ? [Number(process.env.COUNT)] : [1000,5000])) {
  const page = await browser.newPage({ viewport:{width:1500,height:1000} });
  await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.XHANDLE_URL || 'http://localhost:3001');
  await page.evaluate(async count=>{
   window[Object.keys(window).find(k=>k.startsWith('webpackChunk'))].push([[Date.now()],{},r=>window.req=r]);
   const R=window.req('./node_modules/react/index.js');
   const host=document.createElement('div');host.style.height='950px';document.body.replaceChildren(host);
   window.root=window.req('./node_modules/react-dom/client.js').createRoot(host);
   const {processFunctionalModel,buildFunctionalModelRows}=window.req('./src/features/code-architecture-context/functionalModel.js');
   const {ensureCodeArchitectureTraceIds}=window.req('./src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js');
   window.source=await processFunctionalModel(ensureCodeArchitectureTraceIds(Array.from({length:count},(_,i)=>({from:`Function ${i%50}`,to:`Function ${(i%50)+50}`,fromFile:'source.cpp',toFile:'target.cpp',action:`Transfer ${i}`,fromDetails:'Validate and prepare operational state. '.repeat(5),toDetails:'Consume operational state. '.repeat(5),controlActionDetails:'Validated state for the consumer. '.repeat(5),traceId:`source-${i}`,rowRef:i+1,architecture:{subsystem:'System',csci:'Software',csc:'Component',csu:'Unit'}}))),{request:async prompt=>{
    const data=JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
    return {function:{name:data[0].from,description:'Validate and prepare operational state. '.repeat(5)},relationships:data.map(r=>({index:r.index,disposition:'interaction',significance:'meaningful',target:{name:r.to,description:'Consume operational state. '.repeat(5)},action:r.action,kind:'data',description:'Validated state for the consumer. '.repeat(5),rationale:'Source-defined interaction.'}))};
   }});
   window.model=buildFunctionalModelRows(window.source);
   window.initial=JSON.stringify(window.source);window.changes=[];
   // Use the exact derived graph as the CSU comparison to match node/edge complexity.
   const sharedArchitecture={subsystem:'System',csci:'Software',csc:'Component',csu:'Unit'};
   window.comparison=window.model.map(r=>({...r,from:r.from,to:r.to,action:r.action,architecture:sharedArchitecture,fromArchitecture:sharedArchitecture,toArchitecture:sharedArchitecture,functionalModel:undefined,functionalAbstraction:undefined}));
   window.renderFixture=(kind,view='split')=>{
    localStorage.setItem(`parity-${kind}:architecture-abstraction`,kind==='functional'?'functional':'detailed');
    window.root.render(R.createElement(window.req('./src/components/generateFunctionalDecompositionFromGitHub.js').FunctionalDecompositionTable,{key:kind,data:kind==='functional'?window.source:window.comparison,repoId:`parity-${kind}`,projectId:'parity',rowsStorageKey:`parity-${kind}`,viewMode:view,onViewModeChange:next=>window.renderFixture(kind,next),onDataChange:r=>window.changes.push(r),onCollaboratorSelectionChange:s=>window.selection=s}));
   };
   window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});
  },count);
  assert.equal(await page.evaluate(()=>window.model.length),count);
  for(const kind of ['csu','functional']) {
   console.error('Rendering',count,kind);
   await page.evaluate(kind=>window.renderFixture(kind),kind);
   await page.waitForSelector('.react-flow__edge',{state:'attached',timeout:30000}).catch(async error=>{console.error(await page.locator('body').innerText(),errors);await page.screenshot({path:'/tmp/parity-failure.png'});throw error;});await page.waitForTimeout(1000);
   const table=page.getByRole('region',{name:kind==='functional'?'Functional model table':'Code architecture functional decomposition table',exact:true});
   await table.waitFor();
   const counts=await page.evaluate(()=>({nodes:document.querySelectorAll('.react-flow__node').length,functions:document.querySelectorAll('.react-flow__node-bidirectional').length,edges:document.querySelectorAll('.react-flow__edge').length}));
   console.error('Graph ready',counts);
   const trials=[];
   for(let trial=0;trial<3;trial++) {
    const timing=await page.evaluate(async()=>{
     window.longTasks=[];
     const sample=async fn=>{const frames=[];let active=true,last=performance.now();const frame=now=>{frames.push(now-last);last=now;if(active)requestAnimationFrame(frame)};requestAnimationFrame(frame);await fn();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));active=false;frames.sort((a,b)=>a-b);return {p95FrameMs:frames[Math.floor(frames.length*.95)],maxFrameMs:Math.max(...frames)};};
     const divider=await sample(async()=>{const bar=document.querySelector('[role="separator"]');bar.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:750}));for(let i=0;i<30;i++){window.dispatchEvent(new PointerEvent('pointermove',{clientX:700+i*3}));await new Promise(r=>setTimeout(r,16));}window.dispatchEvent(new PointerEvent('pointerup'));});
     const scroll=await sample(async()=>{const pane=document.querySelector('table').parentElement;for(let i=0;i<30;i++){pane.scrollTop=i*100;await new Promise(r=>setTimeout(r,16));}});
     const gestures={};for(const zoom of [false,true])gestures[zoom?'zoom':'pan']=await sample(async()=>{for(let i=0;i<30;i++){document.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:zoom,deltaY:zoom?(i<15?-2:2):8,deltaX:zoom?0:(i<15?10:-10),clientX:400,clientY:500}));await new Promise(r=>setTimeout(r,16));}});
     return {divider,scroll,...gestures,longTasks:window.longTasks};
    });trials.push(timing);
   }
   await page.evaluate(()=>{document.querySelector('table').parentElement.scrollTop=0;});await page.waitForTimeout(200);
   if(count===1000){
    await page.screenshot({path:`/tmp/parity-${kind}-split.png`});
    await page.setViewportSize({width:700,height:1000});await page.waitForTimeout(250);
    const order=await page.evaluate(()=>{const t=document.querySelector('table').closest('section').getBoundingClientRect();const d=document.querySelector('.react-flow').closest('section').getBoundingClientRect();return {diagramY:d.y,tableY:t.y}});
    assert(order.diagramY<order.tableY);await page.screenshot({path:`/tmp/parity-${kind}-narrow.png`});await page.setViewportSize({width:1500,height:1000});
   }
   await page.evaluate(kind=>window.renderFixture(kind,'table'),kind);await table.waitFor();
   assert.equal(await page.locator('.react-flow').count(),0);assert.equal(await page.getByRole('complementary',{name:'Code architecture tools sidebar'}).count(),0);
   await table.locator('tbody tr[data-virtual-key] td').first().click();
   assert((await page.evaluate(()=>window.selection.tableId)).startsWith('code-architecture-'));
   if(count===1000)await page.screenshot({path:`/tmp/parity-${kind}-table.png`});
   results.push({count,kind,counts,trials,errors});
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(window.source)===window.initial),true);assert.equal(await page.evaluate(()=>window.changes.length),0);
  await page.close();
 }
 fs.writeFileSync('/tmp/functional-parity-metrics.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
