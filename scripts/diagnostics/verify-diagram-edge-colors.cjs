// Isolated fixtures: no customer data or paid model calls.
const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.XHANDLE_PLAYWRIGHT_PATH||'playwright-core');
(async()=>{
 const browser=process.env.VERIFY_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/chat',route=>route.fulfill({status:401,body:'No AI calls in this diagnostic'}));
  await page.addInitScript(()=>{
   if(sessionStorage.getItem('details-seeded'))return;
   const id='table-details',key=`diagram:positions:${id}`;
   localStorage.setItem('xhandle.projects',JSON.stringify([{id,name:'Table details fixture'}]));
   localStorage.setItem('xhandle.sidebarProjectsOpen','true');
   localStorage.setItem('xhandle.projectData',JSON.stringify({[id]:{responseRows:[
    {system:'Vehicle',subsystem:'Planning',fromFunction:'Plan',fromDetails:'Plan description',controlAction:'Command',toFunction:'Control',toDetails:'Control description'},
    {system:'Vehicle',subsystem:'Planning',fromFunction:'Control',fromDetails:'',controlAction:'Feedback',toFunction:'Plan',toDetails:'Outdated plan'}
   ]}}));
   localStorage.setItem(key+':groups:v1',JSON.stringify([
    {id:'g:vehicle',elementType:'system',label:'Vehicle',description:'Saved vehicle description',descriptionUserEdited:true,position:{x:0,y:0},width:900,height:700},
    {id:'g:planning',label:'Planning',description:'Saved planning description',descriptionUserEdited:true,parentNode:'g:vehicle',position:{x:50,y:80},width:750,height:400}
   ]));
   localStorage.setItem(key,JSON.stringify([['n:Plan',{position:{x:30,y:60},parentId:'g:planning',groupingIntent:'explicit'}],['n:Control',{position:{x:400,y:60},parentId:'g:planning',groupingIntent:'explicit'}]]));
   localStorage.setItem(key+':initial-layout:v1','complete');sessionStorage.setItem('details-seeded','true');
  });
  const open=async()=>{await page.getByRole('button',{name:'Table details fixture',exact:true}).click({timeout:60000});await page.waitForTimeout(900);};
  const view=async name=>{await page.locator('summary[aria-label="Functional diagram actions"]').click();await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(400);};
  await page.goto(process.env.XHANDLE_URL||'http://localhost:3000');await open();await view('Diagram');
  await page.getByTitle('Fit entire diagram to view',{exact:true}).click();await page.waitForTimeout(650);
  // Dispatch on the real SVG edge to avoid depending on route hit testing coordinates.
  await page.locator('.react-flow__edge').first().dispatchEvent('dblclick');
  await page.getByLabel('Custom color',{exact:true}).fill('#123456');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const assertColors=async()=>{
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.react-flow__edge-path')).every(p=>getComputedStyle(p).stroke==='rgb(18, 52, 86)'));
    const colors=await page.locator('.react-flow__edge-path').evaluateAll(paths=>paths.map(p=>getComputedStyle(p).stroke));
    assert.ok(colors.length>0);assert.ok(colors.every(c=>c==='rgb(18, 52, 86)'));
  };
  await assertColors();
  await page.getByTitle('Auto arrange',{exact:true}).click();await assertColors();
  await page.getByTitle('Expand all bidirectional bundles',{exact:true}).click();await assertColors();
  assert.equal(await page.locator('.react-flow__edge').count(),2);
  await page.getByTitle('Set all edges to Bezier routing',{exact:true}).click();await assertColors();
  await page.reload();await open();await view('Diagram');await assertColors();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:process.env.VERIFY_BROWSER||'chromium',edgeColor:true,bundleExpansion:true,autoArrange:true,routing:true,reload:true,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
