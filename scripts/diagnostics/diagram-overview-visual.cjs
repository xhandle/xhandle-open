const fs=require('node:fs'),assert=require('node:assert/strict');
async function compare(page,a,b){
 return page.evaluate(async({a,b})=>{
    const read=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);resolve({data:x.getImageData(0,0,c.width,c.height),c,x});};image.onerror=reject;image.src=src;});
    const aa=await read(a),bb=await read(b);let changed=0,total=aa.data.width*aa.data.height,absolute=0,perceptualChanged=0;
    for(let i=0;i<aa.data.data.length;i+=4){let d=0;for(let n=0;n<3;n++)d=Math.max(d,Math.abs(aa.data.data[i+n]-bb.data.data[i+n]));const r=aa.data.data[i]-bb.data.data[i],g=aa.data.data[i+1]-bb.data.data[i+1],b=aa.data.data[i+2]-bb.data.data[i+2];
     // YIQ color distance, the same weighting used by Playwright/pixelmatch.
     // 0.15 is stricter than Playwright's 0.2 default. Keep raw RGB metrics too.
     const y=.29889531*r+.58662247*g+.11448223*b,ii=.59597799*r-.2741761*g-.32180189*b,q=.21147017*r-.52261711*g+.31114694*b;
     if(.5053*y*y+.299*ii*ii+.1957*q*q>35215*.15*.15)perceptualChanged++;
     if(d>32){changed++;aa.data.data[i]=255;aa.data.data[i+1]=0;aa.data.data[i+2]=0;}absolute+=d;}
    aa.x.putImageData(aa.data,0,0);return {perceptualChanged,perceptualFraction:perceptualChanged/total,changed,total,fraction:changed/total,meanMaxChannelDifference:absolute/total,png:aa.c.toDataURL()};
   },{a:'data:image/png;base64,'+a.toString('base64'),b:'data:image/png;base64,'+b.toString('base64')});
}
module.exports=async({page,out,setup,zooms,report})=>{
 report.visual=[];
 for(const theme of ['light','dark']){
  await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
  for(const scale of ['overview','close']){
   await setup(zooms[scale]);
   await page.waitForFunction(()=>Number(document.querySelector('[data-edge-images-ready]')?.getAttribute('data-edge-images-ready'))>0,null,{timeout:20000});
   await page.waitForTimeout(500);
   await page.evaluate(()=>document.querySelector('.x-architecture-motion').setAttribute('data-viewport-moving',''));
   await page.waitForFunction(()=>!!document.querySelector('svg[data-edge-image-active]'),null,{timeout:5000});
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('svg[data-edge-image-active] .react-flow__edge-textwrapper')].filter(e=>getComputedStyle(e).visibility!=='hidden').length),0,'Native SVG label overrides must not duplicate cached labels');
   const image=await page.screenshot({path:out+`.${theme}.${scale}.cached.png`});
   const native=await page.addStyleTag({content:'.x-architecture-motion[data-viewport-moving] svg[data-edge-image-active]{opacity:1!important}.x-architecture-motion svg[data-edge-image-active] > g{visibility:visible!important}.x-edge-motion-image{visibility:hidden!important}.x-architecture-motion:not(.x-csu-large) svg[data-edge-image-active] .react-flow__edge-textwrapper{visibility:visible!important}'});
   const original=await page.screenshot({path:out+`.${theme}.${scale}.native.png`});
   await native.evaluate(e=>e.remove());
   const diff=await compare(page,image,original);
   fs.writeFileSync(out+`.${theme}.${scale}.diff.png`,Buffer.from(diff.png.split(',')[1],'base64'));delete diff.png;
   report.visual.push({theme,scale,...diff});console.log('Visual',theme,scale,diff);
   if(diff.fraction>=.003)fs.writeFileSync(out+`.${theme}.${scale}.paint-debug.json`,JSON.stringify(await page.evaluate(async()=>({
    images:await Promise.all([...document.querySelectorAll('.x-edge-motion-image')].map(async image=>({style:image.getAttribute('style'),text:await(await fetch(image.src)).text()}))),
    native:[...document.querySelectorAll('svg.react-flow__edges')].map(svg=>svg.outerHTML),
    paint:[...document.querySelectorAll('.react-flow__edge')].slice(0,2).map(edge=>[edge,...edge.querySelectorAll('*')].map(e=>({tag:e.tagName,class:e.getAttribute('class'),style:Object.fromEntries(['display','opacity','filter','fill','stroke','stroke-opacity','stroke-width','visibility','transform','font-family','font-size'].map(k=>[k,getComputedStyle(e).getPropertyValue(k)]))})))
   })),null,2));
   if(diff.fraction>=.003){
    // At overview scales the image and native compositor rasterize thin curves
    // differently. Require exact visible path/paint coverage and a negative
    // control in addition to the perceptual comparison; never just raise the
    // raw-pixel tolerance until a missing connection can pass.
    const structure=await page.evaluate(async()=>{
     let visible=0;const failures=[],pane=document.querySelector('.react-flow__pane').getBoundingClientRect();
     for(const image of document.querySelectorAll('.x-edge-motion-image[data-edge-image-active]')){
      let svg=image.previousElementSibling;while(svg&&!svg.matches('svg.react-flow__edges'))svg=svg.previousElementSibling;
      if(!svg){failures.push('missing native layer');continue;}
      const parsed=new DOMParser().parseFromString(await(await fetch(image.src)).text(),'image/svg+xml');
      const paints=new Map();
      for(const style of parsed.querySelectorAll('style')){
       const sheet=new CSSStyleSheet();sheet.replaceSync(style.textContent);
       for(const rule of sheet.cssRules){if(!/^\.x-edge-paint-\d+$/.test(rule.selectorText)){failures.push('unsupported cached paint rule');continue;}paints.set(rule.selectorText.slice(1),rule.style);}
      }
      const edges=new Map([...parsed.querySelectorAll('[data-testid]')].map(e=>[e.getAttribute('data-testid'),e]));
      for(const path of svg.querySelectorAll('.react-flow__edge-path')){
       const box=path.getBoundingClientRect();if(box.right<pane.left||box.left>pane.right||box.bottom<pane.top||box.top>pane.bottom)continue;
       visible++;const edge=path.closest('[data-testid]'),copy=edges.get(edge.getAttribute('data-testid'))?.querySelector('path[d]');
       if(!copy||copy.getAttribute('d')!==path.getAttribute('d')){failures.push('path '+edge.dataset.testid);continue;}
       const css=getComputedStyle(path),shared=paints.get(copy.getAttribute('class'));for(const name of ['stroke','stroke-width','stroke-opacity','fill','opacity'])if((copy.style.getPropertyValue(name)||shared?.getPropertyValue(name)||'')!==css.getPropertyValue(name))failures.push(name+' '+edge.dataset.testid);
      }
     }return {visible,failures};
    });
    assert.ok(structure.visible>0);assert.deepEqual(structure.failures,[],'Every visible cached path and its paint must match the native model');
    const absent=await page.addStyleTag({content:'.x-edge-motion-image{visibility:hidden!important}'});
    const missing=await page.screenshot({path:out+`.${theme}.${scale}.missing-connections.png`});await absent.evaluate(e=>e.remove());
    const control=await compare(page,missing,original);delete control.png;
    report.visual.at(-1).structuralCoverage=structure;report.visual.at(-1).missingConnectionsControl=control;
    console.log('Visual control',theme,scale,{structure,control});
    assert.ok(diff.perceptualFraction<.003,'Perceptual image mismatch');
    assert.ok(control.perceptualFraction>=.003&&control.meanMaxChannelDifference>diff.meanMaxChannelDifference,'Missing connections must fail the same visual acceptance criterion');
   }
   await page.evaluate(()=>document.querySelector('.x-architecture-motion').removeAttribute('data-viewport-moving'));
  }
 }
 await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 await setup(zooms.close);
 await page.waitForFunction(()=>Number(document.querySelector('[data-edge-images-ready]')?.getAttribute('data-edge-images-ready'))>0,null,{timeout:20000});await page.waitForTimeout(500);
 await page.evaluate(()=>document.querySelector('.x-architecture-motion').setAttribute('data-viewport-moving',''));
 await page.waitForFunction(()=>!!document.querySelector('svg[data-edge-image-active]'));
 const target=await page.evaluate(()=>{
  const pane=document.querySelector('.react-flow__pane').getBoundingClientRect();
  for(const path of document.querySelectorAll('.react-flow__edge-path')){
   const length=path.getTotalLength();for(const fraction of [.1,.25,.5,.75,.9]){
    const p=path.getPointAtLength(length*fraction),q=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());
    if(q.x<pane.left+20||q.y<pane.top+20||q.x>pane.right-20||q.y>pane.bottom-20)continue;
    const hit=document.elementFromPoint(q.x,q.y);if(hit?.classList.contains('react-flow__edge-interaction'))return {x:q.x,y:q.y,id:hit.closest('.react-flow__edge').dataset.testid};
   }
  }return null;
 });
 assert.ok(target,'Native edge remains hit-testable during accelerated motion');
 await page.mouse.click(target.x,target.y);
 await page.waitForFunction(id=>{
  const edge=document.querySelector(`[data-testid="${id}"]`);
  if(edge?.classList.contains('selected'))return true;
  // Aggregate edges use the existing application highlight, rather than
  // React Flow's selected flag (their IDs differ from the base edge store).
  const paint=edge?.querySelector('.react-flow__edge-path');
  return id.startsWith('rf__edge-aggregate:')&&paint&&getComputedStyle(paint).strokeWidth==='4.5px'&&getComputedStyle(paint).strokeOpacity==='1';
 },target.id,{timeout:10000});
 report.clickDuringMotion=true;
 if(await page.locator('.x-architecture-motion:not(.x-csu-large)').count()){
  await page.waitForFunction(()=>document.querySelector('.x-architecture-motion')?.getAttribute('data-edge-image-fallback')==='Animated edge paint stays native');
  await page.evaluate(()=>document.querySelector('.x-architecture-motion').setAttribute('data-viewport-moving',''));
  const animated=await page.locator(`[data-testid="${target.id}"] .react-flow__edge-path`).evaluate(path=>({animation:getComputedStyle(path).animationName,visibility:getComputedStyle(path).visibility}));
  assert.notEqual(animated.animation,'none');assert.equal(animated.visibility,'visible');
  assert.equal(await page.locator('svg[data-edge-image-active]').count(),0,'Animated aggregate highlights must retain native paint');
  report.animatedHighlightFallback=animated;
  await page.evaluate(()=>document.querySelector('.x-architecture-motion').removeAttribute('data-viewport-moving'));
 }
};
