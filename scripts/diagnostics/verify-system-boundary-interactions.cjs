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
  const node=page.locator('.react-flow__node[data-id="g:planning"]');
  const header=await node.locator('.project-group-drag-handle').boundingBox();
  const zoom=await page.evaluate(()=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
  const pointer={x:header.x+header.width/2,y:header.y+header.height/2};
  await page.mouse.move(pointer.x,pointer.y);await page.mouse.down();
  const samples=[];
  for(let dx=10;dx<=320;dx+=10){
   await page.mouse.move(pointer.x+dx*zoom,pointer.y);await page.waitForTimeout(35);
   samples.push(await page.evaluate(()=>{
    const el=document.querySelector('.react-flow__node[data-id="g:vehicle"]');
    const sub=document.querySelector('.react-flow__node[data-id="g:planning"]');
    return {width:parseFloat(el.style.width),x:new DOMMatrix(getComputedStyle(sub).transform).e};
   }));
  }
  await page.mouse.up();await settle();
  for(let i=1;i<samples.length;i++){
   assert(samples[i].width>=samples[i-1].width,'Container shrank during outward drag');
   assert(samples[i].width-samples[i-1].width<15,'Container expansion jumped');
   assert(samples[i].x-samples[i-1].x>0 && samples[i].x-samples[i-1].x<15,'Subsystem failed to follow pointer');
  }
  const moved=await state();
  const vehicle=moved.boxes.find(box=>box.id==='g:vehicle');
  const sub=moved.boxes.find(box=>box.id==='g:planning');
  assert(sub.position.x>340 && sub.position.x<360);
  assert(vehicle.width>1100 && vehicle.width<1130);
  assert.equal(sub.position.y,60);
  // Push the subsystem left and up by shrinking the system's right/bottom edges.
  await resize('g:vehicle',['bottom','right'],-100,-450);
  const shrunk=await state();
  const shrunkSub=shrunk.boxes.find(box=>box.id==='g:planning');
  const shrunkSystem=shrunk.boxes.find(box=>box.id==='g:vehicle');
  assert.equal(shrunkSub.position.x,shrunkSystem.width-750-18);
  assert.equal(shrunkSub.position.y,shrunkSystem.height-280-18);
  const functionOffsets=state=>{
   const xy=node=>node.transform.match(/-?[\d.]+/g).map(Number);
   const group=xy(state.nodes.find(node=>node.id==='g:planning'));
   return state.nodes.filter(node=>node.id.startsWith('n:')).map(node=>{
    const pos=xy(node);
    return {id:node.id,x:Math.round(pos[0]-group[0]),y:Math.round(pos[1]-group[1])};
   });
  };
  assert.deepEqual(functionOffsets(shrunk),functionOffsets(before),'Shrinking distorted subsystem contents');
  await page.reload();await open();assert.deepEqual((await state()).nodes,shrunk.nodes);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:process.env.VERIFY_BROWSER||'chromium',smoothDrag:true,shrinkPushesContents:true,reload:true,errors,samples:samples.slice(-3)},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
