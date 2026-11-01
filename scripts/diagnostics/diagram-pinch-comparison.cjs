const assert=require('node:assert/strict');
module.exports=async({page,cdp,setup,zooms,report,repeats=3,zoomLimits=[0,Infinity]})=>{
 report.singleZoomInputs=[];
 for(let repeat=0;repeat<repeats;repeat++)for(const scale of ['overview','close'])for(const direction of ['in','out'])for(const kind of ['button','pinch']){
  await setup(zooms[scale]);await page.waitForTimeout(300);
  const pane=await page.locator('.react-flow__pane').boundingBox();
  await page.evaluate(kind=>{
   const viewport=document.querySelector('.react-flow__viewport'),s=window.__singleZoom={before:viewport.style.transform,frames:[],input:null,changed:null};
   const type=kind==='button'?'click':'wheel';
   const renderer=document.querySelector('.react-flow__renderer'),bounds=renderer.getBoundingClientRect(),origin={x:bounds.left+renderer.clientLeft,y:bounds.top+renderer.clientTop};s.cameraBefore={...renderer.__zoom};
   const input=e=>{s.input=performance.now();s.trusted=e.isTrusted;s.anchor=kind==='button'?{x:bounds.width/2,y:bounds.height/2}:{x:e.clientX-origin.x,y:e.clientY-origin.y};};
   window.addEventListener(type,input,{capture:true,once:true});
   const observer=new MutationObserver(()=>{if(s.changed===null&&viewport.style.transform!==s.before)s.changed=performance.now();});observer.observe(viewport,{attributes:true,attributeFilter:['style']});
   const tick=t=>{s.frames.push({time:t,transform:viewport.style.transform,moving:!!viewport.closest('[data-viewport-moving]')});s.raf=requestAnimationFrame(tick);};s.raf=requestAnimationFrame(tick);
   s.stop=()=>{cancelAnimationFrame(s.raf);observer.disconnect();window.removeEventListener(type,input,true);};
  },kind);
  if(kind==='button')await page.locator('.react-flow__controls-zoom'+direction).click();
  else await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:pane.x+pane.width/2,y:pane.y+pane.height/2,deltaX:0,deltaY:(direction==='in'?-1:1)*Math.log2(1.2)/.02,modifiers:2});
  await page.waitForTimeout(500);
  const measured=await page.evaluate(()=>{const s=window.__singleZoom;s.stop();const frame=s.frames.find(f=>f.time>=s.input&&f.transform!==s.before),before={a:s.cameraBefore.k,e:s.cameraBefore.x,f:s.cameraBefore.y},camera=document.querySelector('.react-flow__renderer').__zoom,after={a:camera.k,e:camera.x,f:camera.y},anchor=s.anchor,anchorError=Math.hypot((anchor.x-before.e)/before.a*after.a+after.e-anchor.x,(anchor.y-before.f)/before.a*after.a+after.f-anchor.y);return {anchorError,zoomRatio:after.a/before.a,before:s.before,after:document.querySelector('.react-flow__viewport').style.transform,trusted:s.trusted,commitMs:s.changed-s.input,changedFrameMs:frame?.time-s.input,movingFrames:s.frames.filter(f=>f.moving).length,frames:s.frames.length};});
  const beforeZoom=Number(measured.before.match(/scale\(([^)]+)\)/)[1]),factor=direction==='in'?1.2:1/1.2;
  const expectedRatio=Math.max(zoomLimits[0],Math.min(zoomLimits[1],beforeZoom*factor))/beforeZoom;
  assert.equal(measured.trusted,true);assert.ok(Number.isFinite(measured.changedFrameMs));assert.ok(measured.anchorError<.02,'Zoom stays anchored to the cursor/viewport center');assert.ok(Math.abs(measured.zoomRatio-expectedRatio)<.001,`Matched button and pinch scale: ${JSON.stringify({repeat,scale,direction,kind,expectedRatio,...measured})}`);report.singleZoomInputs.push({repeat,scale,direction,kind,expectedRatio,...measured});
  console.log('Single zoom',JSON.stringify(report.singleZoomInputs.at(-1)));
 }
};
