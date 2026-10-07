// Disposable Chromium context, synthetic rows; no customer storage or model calls.
const {chromium}=require('/tmp/xhandle-copy-check/node_modules/playwright-core');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));await page.goto(process.env.XHANDLE_URL||'http://localhost:3001');
await page.evaluate(()=>{
window[Object.keys(window).find(k=>k.startsWith('webpackChunk'))].push([[Date.now()],{},r=>window.req=r]);
const R=req('./node_modules/react/index.js'); const el=document.createElement('div');el.style.height='950px';document.body.replaceChildren(el);
const root=req('./node_modules/react-dom/client.js').createRoot(el),C=req('./src/components/generateFunctionalDecompositionFromGitHub.js').FunctionalDecompositionTable;
window.rows=Array.from({length:10000},(_,i)=>({traceId:`trace-${i}`,rowRef:i+1,from:`caller ${i}`,to:`receiver ${i}`,action:'Call',fromDetails:'Variable length description. '.repeat(i%12+1),architecture:{subsystem:'System',csci:'Software',csc:'Component',csu:'Unit'}}));
window.props={viewMode:'table',data:window.rows,rowsStorageKey:'virtual-fixture',onRowFocusResolved:key=>window.resolved=key,onDataChange:rows=>{window.rows=rows;window.props.data=rows;window.render();}};
window.render=()=>root.render(R.createElement(C,window.props));window.render();
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});
});
await page.waitForSelector('[data-virtual-key]');
assert(await page.locator('[data-virtual-key]').count()<40);
await page.evaluate(()=>{window.props.highlightedRowIndex=9999;window.props.forceTableOpenKey='first';window.render();});
await page.waitForFunction(()=>window.resolved==='first');
const target=page.locator('[data-virtual-key="trace-9999"]');await target.waitFor();assert(await target.isVisible());
const box=await target.boundingBox();assert(box.y<1000&&box.y+box.height>0);
await target.getByRole('textbox',{name:'Function (From) Details, row 10000',exact:true}).fill('Retained edit');
await page.waitForFunction(()=>window.rows[9999].fromDetails==='Retained edit');
await page.evaluate(()=>{const row=document.querySelector('[data-virtual-key="trace-9999"]');let el=row.parentElement;while(el&&!/auto|scroll/.test(getComputedStyle(el).overflowY))el=el.parentElement;el.scrollTop=0;});
await page.waitForTimeout(300);assert(await target.count()===1,'focused editor should remain mounted');
await page.getByRole('button',{name:'Copy code architecture functional decomposition table'}).click();
await page.waitForFunction(()=>window.copied?.includes('caller 0')&&window.copied?.includes('caller 9999'));
assert(await page.evaluate(()=>window.copied.includes('Retained edit')));
assert(await page.locator('[data-virtual-key]').count()<40);
await page.evaluate(()=>{
const entries=req('./src/components/quickSearchUtils.js').tableSearchEntries();
const entry=entries.find(e=>e.id.endsWith(':trace-5000'));if(!entry)throw Error('Offscreen search result missing');entry.activate('caller 5000');
});
await page.waitForFunction(()=>document.activeElement?.dataset.virtualKey==='trace-5000');
assert.deepEqual(errors,[]);console.log(JSON.stringify({rows:10000,mounted:await page.locator('[data-virtual-key]').count(),firstClickOffscreen:true,offscreenSearch:true,editing:true,fullCopy:true,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
