// Real resize handles with isolated synthetic storage; never connects to user projects.
const assert = require('node:assert/strict');
const {chromium,webkit}=require(process.env.XHANDLE_PLAYWRIGHT_PATH||'playwright-core');
(async()=>{
 const browser=process.env.VERIFY_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const id='manual-resize-fixture',key=`diagram:positions:${id}`;
  await page.addInitScript(({id,key})=>{
   if(sessionStorage.getItem('resize-fixture'))return;
   localStorage.setItem('xhandle.projects',JSON.stringify([{id,name:'Manual resize fixture'}]));
   localStorage.setItem('xhandle.sidebarProjectsOpen','true');
   localStorage.setItem('xhandle.projectData',JSON.stringify({[id]:{responseRows:[{system:'Vehicle',subsystem:'Planning',fromFunction:'Plan',controlAction:'Command',toFunction:'Control'}]}}));
   localStorage.setItem(key+':groups:v1',JSON.stringify([
    {id:'g:external',elementType:'system',label:'External',position:{x:1250,y:100},width:420,height:330},
    {id:'g:vehicle',elementType:'system',label:'Vehicle',position:{x:100,y:100},width:1000,height:750},
    {id:'g:planning',label:'Planning',parentNode:'g:vehicle',position:{x:30,y:60},width:750,height:280},
   ]));
   localStorage.setItem(key,JSON.stringify([
    ['n:Plan',{position:{x:30,y:60},parentId:'g:planning',groupingIntent:'explicit'}],
    ['n:Control',{position:{x:400,y:60},parentId:'g:planning',groupingIntent:'explicit'}],
   ]));
   localStorage.setItem(key+':initial-layout:v1','complete');
   sessionStorage.setItem('resize-fixture','true');
  },{id,key});
  const settle=()=>page.waitForTimeout(750);
  const open=async()=>{await page.getByRole('button',{name:'Manual resize fixture',exact:true}).click({timeout:60000});await page.waitForFunction(()=>document.querySelector('.react-flow')?.style.visibility==='visible');await settle();};
  const state=()=>page.evaluate(key=>({
   boxes:JSON.parse(localStorage.getItem(key+':groups:v1')),
   nodes:[...document.querySelectorAll('.react-flow__node')].map(el=>({id:el.dataset.id,transform:el.style.transform,width:el.style.width,height:el.style.height})).sort((a,b)=>a.id.localeCompare(b.id)),
   viewport:getComputedStyle(document.querySelector('.react-flow__viewport')).transform,
  }),key);
  const resize=async(id,corner,dx,dy)=>{
   const node=page.locator(`.react-flow__node[data-id="${id}"]`);
   await node.locator('.project-group-drag-handle').click();
   const zoom=await page.evaluate(()=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
   if(process.env.VERIFY_BROWSER==='webkit'){
    const handle=await node.locator('.react-flow__resize-control.handle.'+corner.join('.')).boundingBox();
    const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+dx*zoom,y+dy*zoom,{steps:20});await page.mouse.up();await settle();
    return state();
   }
   // Use edge controls: rounded containers can clip the corner handles in Chromium.
   for (const side of corner) {
    const handle=node.locator('.react-flow__resize-control.line.'+side);
    const bounds=await handle.boundingBox();
    const pointer=await page.evaluate(({bounds,side})=>{
     const cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
     for(let offset=-3;offset<=3;offset+=.25){
      const point={x:cx+(['left','right'].includes(side)?offset:0),y:cy+(['top','bottom'].includes(side)?offset:0)};
      const el=document.elementFromPoint(point.x,point.y);
      if(el?.classList.contains('react-flow__resize-control')&&el.classList.contains(side))return point;
     }
     return null;
    },{bounds,side});
    assert(pointer,`No visible ${side} resize control`);
    const horizontal=side==='left'||side==='right';
    await page.mouse.move(pointer.x,pointer.y);await page.mouse.down();
    await page.mouse.move(pointer.x+(horizontal?dx*zoom:0),pointer.y+(horizontal?0:dy*zoom),{steps:20});
    await page.mouse.up();await settle();
   }
   return state();
  };
  await page.goto(process.env.XHANDLE_URL||'http://localhost:3000');await open();
  await page.getByTitle('Fit entire diagram to view',{exact:true}).click();await settle();
  const before=await state();
  const stableContents=state=>state.nodes.filter(node=>node.id!=='g:vehicle');
  const after=await resize('g:vehicle',['top','right'],100,-160);
  assert.deepEqual(stableContents(after),stableContents(before),'System resize moved descendants or neighboring systems');
  const vehicle=after.boxes.find(box=>box.id==='g:vehicle');
  if(process.env.RESIZE_DEBUG)console.log(JSON.stringify({before,after},null,2));
  assert.equal(vehicle.position.x,100);assert(vehicle.position.y<100);
  assert(vehicle.width>1000 && vehicle.width<1070,'Resize must stop before clearance violation');
  assert.equal(after.viewport,before.viewport,'Resize changed viewport');
  const expanded=await resize('g:vehicle',['top','left'],-60,-60);
  assert.deepEqual(stableContents(expanded),stableContents(before),'Top/left resize moved contents');
  for(let i=0;i<(process.env.VERIFY_BROWSER==='webkit'?1:2);i++){await page.getByTitle('Undo last diagram change',{exact:true}).click();await settle();}
  assert.deepEqual((await state()).nodes,after.nodes);
  for(let i=0;i<(process.env.VERIFY_BROWSER==='webkit'?1:2);i++){await page.getByTitle('Redo diagram change',{exact:true}).click();await settle();}
  assert.deepEqual((await state()).nodes,expanded.nodes);
  await page.reload();await open();assert.deepEqual((await state()).nodes,expanded.nodes);
  const nested=await resize('g:planning',['bottom','right'],30,30);
  assert.deepEqual(nested.nodes.filter(node=>node.id.startsWith('n:')),expanded.nodes.filter(node=>node.id.startsWith('n:')));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:process.env.VERIFY_BROWSER||'chromium',clearanceStopsResize:true,descendantsStationary:true,topLeftResize:true,nestedResize:true,undoRedo:true,reload:true,errors},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
