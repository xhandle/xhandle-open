// Isolated browser fixture. Requires the local dev server and XHANDLE_PLAYWRIGHT_PATH / XHANDLE_CHROME_PATH.
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
try{
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>r.fulfill({status:401,body:'fixture'}));
await page.goto('http://localhost:3000');
await page.evaluate(()=>{
const k=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[k].push([[Date.now()],{},r=>window.req=r]);
const React=window.req('./node_modules/react/index.js');const host=document.createElement('div');document.body.replaceChildren(host);const root=window.req('./node_modules/react-dom/client.js').createRoot(host);
const arch={subsystem:'System',csci:'Software',csc:'Component',csu:'Unit'};
const rows=[['Alpha','Beta'],['Alpha','Beta'],['Beta','Alpha'],['Beta','Gamma']].map(([fromFunction,toFunction],i)=>({edgeId:'edge'+i,rowRef:i+1,fromFunction,toFunction,fromFile:'unit.py',toFile:'unit.py',controlAction:`Call ${i}`,architecture:arch,fromArchitecture:arch,toArchitecture:arch}));
window.fixtureRender=(level='detailed',scope='edge-fixture',reviewMode=false)=>root.render(React.createElement(window.req('./src/components/LiteSummaryDiagramReactFlowGitHub.js').default,{key:scope,rows,architectureMode:true,architectureAbstraction:level,storageKey:scope,cleanOnceKey:'initial-'+scope,reviewMode,height:900}));
window.fixtureRender();window.routeEvents=0;window.addEventListener('xhandle:manual-edge-route-change',()=>window.routeEvents++);
});
await page.locator('.react-flow__edge-manualOrthogonal').first().waitFor({timeout:30000});await page.waitForTimeout(1200);
const edge=page.locator('[data-testid="rf__edge-edge0"]');const path=edge.locator('.react-flow__edge-path');
await edge.dispatchEvent('click');
const control=page.getByRole('button',{name:'Adjust selected edge sourceOffset',exact:true}).first();await control.waitFor();
const normalized=p=>p.replace(/-?\d+(?:\.\d+)?/g,v=>String(Math.round(Number(v)*10)/10));
const nodePositions=await page.locator('.react-flow__node').evaluateAll(els=>els.map(el=>el.style.transform));
const before=normalized(await path.getAttribute('d'));const box=await control.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+55,box.y+box.height/2+45,{steps:6});await page.mouse.up();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('edge-fixture:csu-edge-routing')||'{}').manualRoutes?.edge0);
const moved=normalized(await path.getAttribute('d'));assert.notEqual(moved,before);assert.deepEqual(await page.locator('.react-flow__node').evaluateAll(els=>els.map(el=>el.style.transform)),nodePositions);assert.equal(await page.evaluate(()=>window.routeEvents),0);
await page.getByRole('button',{name:'Use Bezier routing for all edges',exact:true}).click();await page.locator('.react-flow__edge-smartBezier').first().waitFor();
await page.getByRole('button',{name:'Use rectangular routing for all edges',exact:true}).click();assert.equal(normalized(await path.getAttribute('d')),moved);
await page.evaluate(()=>window.fixtureRender('csc'));await page.waitForFunction(()=>document.querySelectorAll('.react-flow__edge-manualOrthogonal').length===0);assert.equal(await page.locator('.react-flow__edge-manualOrthogonal').count(),0);
await page.evaluate(()=>window.fixtureRender());await path.waitFor({state:"attached"});assert.equal(normalized(await path.getAttribute('d')),moved);
await page.evaluate(()=>window.fixtureRender('detailed','another-scope'));await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('another-scope:csu-edge-routing')).manualRoutes.edge0),undefined);
await page.evaluate(()=>window.fixtureRender());await page.waitForTimeout(1000);assert.equal(normalized(await path.getAttribute('d')),moved);
await edge.dispatchEvent('click');await page.getByRole('button',{name:'Reset selected edge route',exact:true}).click();assert.equal(normalized(await path.getAttribute('d')),before);
const functionNode=page.locator('.react-flow__node-bidirectional').filter({hasText:'Alpha'}).first();const fnBox=await functionNode.boundingBox();await page.mouse.move(fnBox.x+fnBox.width/2,fnBox.y+fnBox.height/2);await page.mouse.down();await page.mouse.move(fnBox.x+fnBox.width/2+35,fnBox.y+fnBox.height/2+25,{steps:6});await page.mouse.up();await page.waitForTimeout(200);assert.notEqual(normalized(await path.getAttribute('d')),before);
await page.getByRole('button',{name:'Toggle all bidirectional edge bundles',exact:true}).click();const bundle=page.locator('.react-flow__edge-manualOrthogonal').filter({has:page.locator('[marker-start]')}).first();await bundle.waitFor();await bundle.dispatchEvent('click');await page.getByRole('button',{name:'Adjust selected edge corridor',exact:true}).first().waitFor();assert.ok(await bundle.locator('.react-flow__edge-path').getAttribute('marker-end'));assert.ok(await bundle.locator('.react-flow__edge-path').getAttribute('marker-start'));
const bundleControl=page.getByRole('button',{name:'Adjust selected edge sourceOffset',exact:true}).first();const bc=await bundleControl.boundingBox();await page.mouse.move(bc.x+bc.width/2,bc.y+bc.height/2);await page.mouse.down();await page.mouse.move(bc.x+bc.width/2+30,bc.y+bc.height/2+35,{steps:4});await page.mouse.up();assert.ok(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('edge-fixture:csu-edge-routing')).manualRoutes).some(key=>key.startsWith('e:cba-aggregate:bidirectional:'))));
await page.evaluate(()=>window.fixtureRender('detailed','edge-fixture',true));await page.waitForTimeout(200);assert.equal(await page.getByRole('button',{name:'Adjust selected edge corridor',exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('PASS: CSU orthogonal rendering, segment drag, scoped callbacks, style toggles, compact view, scoped persistence, reset, bidirectional markers, node attachment during movement, isolated bundle adjustments, and read-only controls.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
