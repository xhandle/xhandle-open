// Isolated browser fixture; requires the dev server and XHANDLE_PLAYWRIGHT_PATH / XHANDLE_CHROME_PATH.
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));
 await page.goto('http://localhost:3000');
 await page.evaluate(()=>{
 const k=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[k].push([[Date.now()],{},r=>window.req=r]);
 const React=window.req('./node_modules/react/index.js');const root=window.req('./node_modules/react-dom/client.js').createRoot(document.createElement('div'));document.body.replaceChildren(root._internalRoot.containerInfo);
 const arch={subsystem:'System',csci:'Software',csc:'Component',csu:'Unit'};
 const rows=Array.from({length:15},(_,i)=>({fromFunction:`Function ${String(i).padStart(2,'0')}`,toFunction:`Function ${String(i+1).padStart(2,'0')}`,fromFile:'unit.py',toFile:'unit.py',controlAction:`Call ${i}`,architecture:arch,fromArchitecture:arch,toArchitecture:arch}));
 root.render(React.createElement(window.req('./src/components/LiteSummaryDiagramReactFlowGitHub.js').default,{rows,architectureMode:true,architectureAbstraction:'detailed',storageKey:'spacing-fixture',cleanOnceKey:'initial-fixture',height:900}));
 });
 await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node-bidirectional').length===16,{timeout:30000});
 await page.waitForTimeout(1500);
 const nodes=await page.locator('.react-flow__node-bidirectional').evaluateAll(els=>els.map(el=>{const r=el.querySelector('.x-node').getBoundingClientRect();const zoom=new DOMMatrix(document.querySelector('.react-flow__viewport').style.transform).a;return {x:r.x/zoom,y:r.y/zoom,w:r.width/zoom,h:r.height/zoom};}));
 const horizontal=[],vertical=[];
 for(const a of nodes)for(const b of nodes){if(Math.abs(a.y-b.y)<.1&&b.x>a.x)horizontal.push(b.x-a.x-a.w);if(Math.abs(a.x-b.x)<.1&&b.y>a.y)vertical.push(b.y-a.y-a.h);}
 assert.ok(Math.abs(Math.min(...horizontal)-216)<1,JSON.stringify(horizontal));assert.ok(Math.abs(Math.min(...vertical)-160)<1,JSON.stringify(vertical));
 const styles=await page.locator('.react-flow__node-bidirectional .x-node').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor));
 assert.ok(styles.every(color=>color==='rgb(255, 255, 255)'));
 const groups=await page.locator('.react-flow__node-groupBox').evaluateAll(els=>els.map(el=>({background:getComputedStyle(el.firstElementChild).backgroundColor,label:el.textContent})));
 assert.equal(groups.length,4);
 assert.ok(groups.every(group=>group.background!=='rgba(0, 0, 0, 0)'), 'Every hierarchy level should have a visible tint');
 assert.equal(await page.locator('.react-flow__edge').count(),15);
 await page.screenshot({path:'/tmp/xhandle-csu-readability.png'});
 console.log(JSON.stringify({groups,functions:nodes.length,horizontalGap:Math.min(...horizontal),verticalGap:Math.min(...vertical)}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
