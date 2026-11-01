const assert=require('node:assert/strict');
module.exports=async({page,cdp,setup,zooms,report,expectSmooth=false})=>{
 report.pinchContinuity=[];
 for(let repeat=0;repeat<2;repeat++)for(const kind of ['single','clustered']){
  if(repeat)await setup(zooms.close);
  await setup(zooms.overview);await page.waitForTimeout(500);
  const box=await page.locator('.react-flow__pane').boundingBox();
  await page.evaluate(()=>{
   const renderer=document.querySelector('.react-flow__renderer'),box=renderer.getBoundingClientRect();
   const host=document.querySelector('.x-architecture-motion');
   const s=window.__pinchContinuity={before:{...renderer.__zoom},frames:[],events:[],motionChanges:[],origin:{x:box.left+renderer.clientLeft,y:box.top+renderer.clientTop}};
   const observer=new MutationObserver(()=>s.motionChanges.push({time:performance.now(),moving:host.hasAttribute('data-viewport-moving')}));observer.observe(host,{attributes:true,attributeFilter:['data-viewport-moving']});
   const input=e=>{s.events.push({time:performance.now(),delta:e.deltaY,trusted:e.isTrusted});s.anchor={x:e.clientX-s.origin.x,y:e.clientY-s.origin.y};};
   window.addEventListener('wheel',input,{capture:true,passive:true});
   const tick=time=>{s.frames.push({time,...renderer.__zoom,moving:host.hasAttribute('data-viewport-moving')});s.raf=requestAnimationFrame(tick);};s.raf=requestAnimationFrame(tick);
   s.stop=()=>{cancelAnimationFrame(s.raf);observer.disconnect();window.removeEventListener('wheel',input,true);};
  });
  const count=kind==='single'?1:10,pending=[];
  for(let i=0;i<count;i++){
   pending.push(cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width/2,y:box.y+box.height/2,deltaX:0,deltaY:-Math.log2(1.8)/.02/count,modifiers:2}));
   if(count>1)await new Promise(resolve=>setTimeout(resolve,8));
  }
  await Promise.all(pending);
  await page.waitForFunction(()=>{
   const s=window.__pinchContinuity,actual=document.querySelector('.react-flow__renderer').__zoom;
   return s.events.length&&Math.abs(actual.k/s.before.k-1.8)<.00001&&performance.now()-s.events.at(-1).time>650;
  },null,{timeout:20000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const sample=await page.evaluate(()=>{
   const s=window.__pinchContinuity;s.stop();const first=s.events[0].time,after={...document.querySelector('.react-flow__renderer').__zoom};
   let previous=s.before;const changed=[];
   for(const f of s.frames)if(f.time>=first&&Math.abs(f.k-previous.k)>1e-12){changed.push({...f,logStep:Math.abs(Math.log(f.k/previous.k))});previous=f;}
   return {before:s.before,after,events:s.events,motionChanges:s.motionChanges,changedFrames:changed,firstChangedFrameMs:changed[0]?.time-first,completeMs:changed.at(-1)?.time-first,
    anchorError:Math.max(...changed.map(f=>Math.hypot((s.anchor.x-s.before.x)/s.before.k*f.k+f.x-s.anchor.x,(s.anchor.y-s.before.y)/s.before.k*f.k+f.y-s.anchor.y))),
    maximumStepFraction:Math.max(...changed.map(f=>f.logStep/Math.log(1.8)))};
  });
  assert.ok(sample.events.every(e=>e.trusted));assert.ok(sample.anchorError<.02,'Every intermediate frame stays cursor anchored');
  assert.ok(Math.abs(sample.after.k/sample.before.k-1.8)<.00001,'No pinch input is lost');
  if(expectSmooth){assert.ok(sample.changedFrames.length>=4,'Large pinch must show multiple intermediate frames');assert.ok(sample.maximumStepFraction<.5,'No frame should consume most of the requested zoom');assert.ok(sample.changedFrames.every(frame=>frame.moving),'Motion presentation stays active until the final zoom frame');}
  report.pinchContinuity.push({repeat,kind,...sample});console.log('Pinch continuity',JSON.stringify({repeat,kind,frames:sample.changedFrames.length,firstMs:sample.firstChangedFrameMs,completeMs:sample.completeMs,maxStepFraction:sample.maximumStepFraction}));
 }
};
