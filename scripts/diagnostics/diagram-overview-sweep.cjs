const assert=require('node:assert/strict');
module.exports=async({page,cdp,setup,zooms,report})=>{
 await setup(zooms.overview);await page.waitForTimeout(700);
 const pane=await page.locator('.react-flow__pane').boundingBox();
 await page.evaluate(()=>{
  window.__sweep={frames:[],cached:0,total:0,zooms:[]};const s=window.__sweep;let last=performance.now();
  const tick=t=>{s.frames.push(t-last);last=t;s.total++;s.cached+=Number(!!document.querySelector('svg[data-edge-image-active]'));s.zooms.push(new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);s.raf=requestAnimationFrame(tick);};s.raf=requestAnimationFrame(tick);
 });
 try{
  for(const direction of [-1,1])for(let i=0;i<48;i++){
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:pane.x+pane.width/2,y:pane.y+pane.height/2,deltaX:0,deltaY:direction*4,modifiers:2});await page.waitForTimeout(16);
  }
 }finally{await page.evaluate(()=>cancelAnimationFrame(window.__sweep.raf));}
 report.sweep=await page.evaluate(()=>{const s=window.__sweep,a=s.frames.slice(1).sort((a,b)=>a-b);return {inputs:96,frames:a.length,median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1),cachedFrames:s.cached,totalFrames:s.total,minZoom:Math.min(...s.zooms),maxZoom:Math.max(...s.zooms)};});
 assert.ok(report.sweep.maxZoom/report.sweep.minZoom>8,'Sustained sweep traverses multiple zoom scales');
 await page.waitForTimeout(800);
 assert.equal(await page.locator('svg[data-edge-image-active]').count(),0,'Native scene restores after sustained zoom');
 assert.ok(await page.locator('.x-edge-motion-image').count()<=16,'Cache remains bounded after repeated reframing');
 console.log('Sustained zoom',JSON.stringify(report.sweep));
};
