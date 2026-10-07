// Isolated synthetic browser fixture. Set XHANDLE_URL to old/current dev server.
const { chromium } = require('/tmp/xhandle-copy-check/node_modules/playwright-core');
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
 const page = await browser.newPage({viewport:{width:1500,height:1000}});
 await page.route('**/api/**', r => r.fulfill({status:401,body:'fixture'}));
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.XHANDLE_URL || 'http://localhost:3001');
 const count=Number(process.env.COUNT || 800);
 await page.evaluate(({count,stress}) => {
 window[Object.keys(window).find(k=>k.startsWith('webpackChunk'))].push([[Date.now()],{},r=>window.req=r]);
 const raw=window.req; const r=name=>raw(raw.m[name] ? name : Object.keys(raw.m).find(k=>k.endsWith(name.replace('./node_modules','/node_modules')))); window.req=r; const R=r('./node_modules/react/index.js');
 const el=document.createElement('div');el.style.height='950px';document.body.replaceChildren(el);
 window.root=r('./node_modules/react-dom/client.js').createRoot(el);window.ref=R.createRef();
 window.rows=Array.from({length:count},(_,i)=>({from:`function_${i}`,to:`function_${i+1}`,fromFunction:`function_${i}`,toFunction:`function_${i+1}`,action:'Call',controlAction:'Call',fromFile:'fixture.cpp',toFile:'fixture.cpp',fromDetails:'Compute and validate operational state.',toDetails:'Receive operational state.',controlActionDetails:'Supplied state.',architecture:{subsystem:'System',csci:'Software',csc:`Component ${Math.floor(i/80)}`,csu:`Unit ${Math.floor(i/20)}`},traceId:`row-${i}`,rowRef:i+1}));
 if(stress) {
   window.rows=window.rows.map((row,i)=>{
     const from=`Evaluate long operational responsibility ${Math.floor(i/4)}`;
     const to=i%31===0?from:`Consume long operational responsibility ${(i*17)%Math.max(1,count/2)}`;
     return {...row,from,to,fromFunction:from,toFunction:to,edgeId:`stress-edge-${i}`};
   });
   localStorage.setItem('benchmark:csu-edge-routing',JSON.stringify({defaultStyle:'rectangular',manualRoutes:{'stress-edge-0':{model:'segment-v2',axis:'x',corridor:2000,sourceOffset:500,targetOffset:500}}}));
 }
 window.started=performance.now();
 window.root.render(R.createElement(r('./src/components/LiteSummaryDiagramReactFlowGitHub.js').default,{ref:window.ref,rows:window.rows,architectureMode:true,architectureAbstraction:'detailed',cleanOnceKey:'benchmark',storageKey:'benchmark',height:900}));
 },{count,stress:process.env.STRESS==='1'});
 await page.waitForSelector('.react-flow__edge',{timeout:120000});
 const firstEdgesMs=await page.evaluate(()=>performance.now()-window.started);
 await page.waitForTimeout(3000);await page.evaluate(()=>window.ref.current.fitViewToDiagram());await page.waitForTimeout(800);
 const counts=await page.evaluate(()=>({nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,handles:document.querySelectorAll('.react-flow__handle').length,dom:document.querySelectorAll('*').length}));
 const gestures={};
 for(const zoom of [false,true]) gestures[zoom?'zoom':'pan']=await page.evaluate(async zoom=>{
  const times=[];let active=true,last=performance.now();
  const frame=now=>{times.push(now-last);last=now;if(active)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  const start=performance.now();
  for(let i=0;i<60;i++){document.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:zoom,deltaY:zoom?(i<30?-2:2):12,deltaX:zoom?0:(i<30?15:-15),clientX:750,clientY:450}));await new Promise(r=>setTimeout(r,16));}
  active=false;times.sort((a,b)=>a-b);return {durationMs:performance.now()-start,p95FrameMs:times[Math.floor(times.length*.95)],frames:times.length};
 },zoom);
 await page.evaluate(()=>{const R=window.req('./node_modules/react/index.js');window.started=performance.now();window.root.render(R.createElement(window.req('./src/components/generateFunctionalDecompositionFromGitHub.js').FunctionalDecompositionTable,{data:window.rows,viewMode:'table',repoId:'fixture',projectId:'fixture',rowsStorageKey:'fixture'}));});
 await page.waitForSelector('tbody tr',{timeout:120000});
 const table=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {firstPaintMs:performance.now()-window.started,rows:document.querySelectorAll('tbody tr').length,dom:document.querySelectorAll('*').length};});
 table.clickMs=await page.evaluate(async()=>{const start=performance.now();document.querySelector('tbody tr[data-virtual-key], tbody tr:not([aria-hidden])').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;});
 console.log(JSON.stringify({url:process.env.XHANDLE_URL,count,firstEdgesMs,counts,gestures,table,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
