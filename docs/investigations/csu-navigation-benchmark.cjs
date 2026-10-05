// Isolated development-browser benchmark. Requires dev server and XHANDLE_PLAYWRIGHT_PATH / XHANDLE_CHROME_PATH.
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && /Maximum update|React Flow|handle id/.test(m.text()))errors.push(m.text());});
 await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));await page.goto('http://localhost:3000');
 await page.evaluate(()=>{
 const k=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[k].push([[Date.now()],{},r=>window.req=r]);
 const React=window.req('./node_modules/react/index.js');const host=document.createElement('div');document.body.replaceChildren(host);const root=window.req('./node_modules/react-dom/client.js').createRoot(host);
 const arch=i=>({subsystem:'System',csci:'Software',csc:`Component ${Math.floor(i/120)}`,csu:`Unit ${Math.floor(i/30)}`});
 const rows=Array.from({length:600},(_,i)=>[1,7].map((step,j)=>{const t=(i+step)%600;return {edgeId:`edge-${i}-${j}`,rowRef:i*2+j+1,fromFunction:`Function ${String(i).padStart(3,'0')}`,toFunction:`Function ${String(t).padStart(3,'0')}`,fromFile:'unit.py',toFile:'unit.py',controlAction:`Call ${i}-${t}`,architecture:arch(i),fromArchitecture:arch(i),toArchitecture:arch(t)};})).flat();
 window.diagramRef=React.createRef();window.renderFixture=(architectureAbstraction='detailed')=>root.render(React.createElement(window.req('./src/components/LiteSummaryDiagramReactFlowGitHub.js').default,{ref:window.diagramRef,rows,architectureMode:true,architectureAbstraction,storageKey:'perf-fixture',cleanOnceKey:'initial-fixture',height:900}));window.renderFixture();
 });
 await page.locator('.react-flow__edge').first().waitFor({state:'attached',timeout:90000});await page.waitForTimeout(3000);
 const result={};await page.evaluate(()=>{window.labelQueries=0;const query=Element.prototype.querySelector;Element.prototype.querySelector=function(selector){if(selector==='.react-flow__edgelabel-renderer')window.labelQueries++;return query.call(this,selector);};});
 const run=async(name,ctrlKey=false)=>{result[name]=await page.evaluate(async(ctrlKey)=>{
 const el=document.querySelector('.react-flow__pane');const before=document.querySelector('.react-flow__viewport').style.transform;
 const deltas=[];let previous=performance.now();for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);const now=performance.now();deltas.push(now-previous);previous=now;el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:900,clientY:450,deltaX:ctrlKey?0:(i%2?8:-8),deltaY:ctrlKey?(i<20?-2:2):(i%2?4:-4),ctrlKey}));}
 const sorted=deltas.slice(5).sort((a,b)=>a-b);return {p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],nodes:document.querySelectorAll('.react-flow__node-bidirectional').length,edges:document.querySelectorAll('.react-flow__edge').length,dom:document.querySelectorAll('*').length,before,after:document.querySelector('.react-flow__viewport').style.transform};
 },ctrlKey);await page.waitForTimeout(300);};
 await run('overviewPan');await run('overviewZoom',true);await page.evaluate(()=>window.diagramRef.current.fitViewToDiagram());await page.waitForTimeout(700);
 await page.evaluate(async()=>{const el=document.querySelector('.react-flow__pane');const rects=[...document.querySelectorAll('.react-flow__node-bidirectional')].map(n=>n.getBoundingClientRect());const r=rects.find(r=>r.x>700&&r.x<1100&&r.y>200&&r.y<650)||rects[0];for(let i=0;i<4;i++){el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:-65,ctrlKey:true}));await new Promise(resolve=>setTimeout(resolve,100));}});await page.waitForTimeout(700);
 await run('detailPan');await run('detailZoom',true);
 assert.ok(result.detailPan.nodes>0&&result.detailPan.nodes<600, 'Populated region must be culled');
 assert.notEqual(result.detailPan.before,result.detailPan.after);
 await page.waitForFunction(()=>!document.querySelector('[data-viewport-moving]'));
 assert.equal(await page.locator('.react-flow__edgelabel-renderer').evaluate(el=>getComputedStyle(el).visibility),'visible');
 await page.evaluate(()=>window.diagramRef.current.fitViewToDiagram());await page.waitForTimeout(800);
 assert.equal(await page.locator('.react-flow__node-bidirectional').count(),600);
 assert.equal(await page.locator('.react-flow__edge').count(),1200);
 result.labelQueries=await page.evaluate(()=>window.labelQueries);assert.ok(result.labelQueries<10,'No per-edge DOM queries during navigation');
 await page.evaluate(()=>window.renderFixture('csc'));await page.waitForTimeout(500);assert.equal(await page.locator('.x-csu-large').count(),0);
 assert.deepEqual(errors,[]);result.errors=errors;console.log(JSON.stringify(result,null,2));if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
