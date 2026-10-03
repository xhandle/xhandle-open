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
  const cell=(field,row=1)=>page.getByRole('textbox',{name:`${field}, row ${row}`,exact:true});
  await page.goto(process.env.XHANDLE_URL||'http://localhost:3000');await open();await view('Table');
  assert.equal(await cell('System Details').inputValue(),'Saved vehicle description');
  assert.equal(await cell('Subsystem Details').inputValue(),'Saved planning description');
  assert.equal(await cell('Function (To) Details',2).inputValue(),'Plan description');
  await cell('Subsystem Details').fill('Edited planning description');await cell('System Details').click();
  await page.waitForTimeout(500);
  assert.equal(await cell('Subsystem Details',2).inputValue(),'Edited planning description');
  await cell('Function (From) Details').fill('Edited plan description');await cell('System Details').click();await page.waitForTimeout(500);
  assert.equal(await cell('Function (To) Details',2).inputValue(),'Edited plan description');
  await view('Diagram');await page.getByTitle('Fit entire diagram to view',{exact:true}).click();await page.waitForTimeout(650);
  await page.locator('.project-group-drag-handle').filter({hasText:/^Planning$/}).dblclick();
  assert.equal(await page.locator('textarea').filter({visible:true}).first().inputValue(),'Edited planning description');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForTimeout(800);await page.reload();await open();await view('Table');
  assert.equal(await cell('Subsystem Details').inputValue(),'Edited planning description');
  assert.equal(await cell('Function (From) Details').inputValue(),'Edited plan description');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:process.env.VERIFY_BROWSER||'chromium',diagramToTable:true,tableToDiagram:true,allFunctionOccurrences:true,reload:true,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
