const fs = require('node:fs');
const assert = require('node:assert/strict');
const quant = values => { const a = values.slice().sort((x,y)=>x-y); return {n:a.length,median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}; };
module.exports = async ({page,cdp,result,args,out,app,reset,collect}) => {
  const level=args.level||'CSU', samples=+(args.samples||3), steps=+(args.steps||24);
  const report=result.overview={level,samples,steps,measurements:[],isolates:[],traces:[]};
  result.methodology={scenario:'same graph at overview, intermediate and close zoom',version:1,samples,steps,intervalMs:16,warmup:args.warmup==='0'?'disabled':'one discarded pan and zoom',
    frames:'rAF intervals contained between first and last trusted input; not presentation FPS',
    visibility:'element bounding-box overlap with the clipped diagram viewport; edge bounds can overestimate visible paths',
    setup:'Fit View, change scale via trusted pinch-wheel around viewport center, wait for stable transform; restore before every sample',
    isolates:'Temporary CSS in disposable test profiles only. Altered scenes are attribution experiments, not accepted UI changes.'};
  const save=()=>fs.writeFileSync(out+'.partial.json',JSON.stringify(result,null,2));
  await page.getByRole('button',{name:args.workspace==='cba'?'CBA performance fixture':'Performance fixture',exact:true}).first().click();
  await page.locator('.react-flow__node').first().waitFor();
  if(args.workspace==='cba'&&level!=='CSU'){
    await page.getByRole('button',{name:level,exact:true}).click();
    await page.locator('.react-flow__node').first().waitFor();
  }
  await page.waitForFunction(()=>!document.body.textContent.includes('Arranging diagram...'));
  if(args.curved==='1')await page.getByRole('button',{name:'Use Bezier routing for all edges',exact:true}).click();
  if(args.requireLabels==='1'){
    await page.waitForFunction(()=>[...document.querySelectorAll('.react-flow__edge-text')].some(e=>e.textContent.trim()));
    report.textLabels=await page.locator('.react-flow__edge-text').count();
  }
  const view=()=>page.evaluate(()=>{
    const pane=document.querySelector('.react-flow__pane').getBoundingClientRect();
    const m=new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
    return {x:m.e,y:m.f,zoom:m.a,pane:{x:pane.x,y:pane.y,width:pane.width,height:pane.height}};
  });
  const stable=async()=>{
    await page.waitForTimeout(400);
    await page.evaluate(()=>new Promise((resolve,reject)=>{let last='',n=0,t=0;const tick=()=>{const style=document.querySelector('.react-flow__viewport')?.getAttribute('style');n=style===last?n+1:0;last=style;if(n>=4)return resolve();if(++t>180)return reject(Error('Viewport did not settle'));requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
  };
  async function fit(){
    await page.evaluate(()=>{for(let e=document.querySelector('.react-flow');e;e=e.parentElement){e.scrollTop=0;e.scrollLeft=0;}});
    await page.locator('.react-flow__controls-fitview').click();await page.waitForTimeout(700);await stable();return view();
  }
  const fitted=await fit();report.fitted=fitted;
  const zooms={overview:fitted.zoom,intermediate:Math.min(.7,Math.max(fitted.zoom*4,.2)),close:1};
  const center={x:fitted.pane.x+fitted.pane.width/2,y:fitted.pane.y+fitted.pane.height/2};
  async function setup(zoom){
    await fit();
    for(let i=0;i<8;i++){
      const current=await view();if(Math.abs(current.zoom/zoom-1)<.025)break;
      const delta=Math.max(-180,Math.min(180,-Math.log2(zoom/current.zoom)/.02));
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:center.x,y:center.y,deltaX:0,deltaY:delta,modifiers:2});await stable();
    }
    const actual=await view();assert.ok(Math.abs(actual.zoom/zoom-1)<.04,'Requested zoom reached');return actual;
  }
  const snapshot=()=>page.evaluate(()=>{
    const pane=document.querySelector('.react-flow__pane').getBoundingClientRect();
    const clip={left:Math.max(pane.left,0),right:Math.min(pane.right,innerWidth),top:Math.max(pane.top,0),bottom:Math.min(pane.bottom,innerHeight)};
    const intersects=e=>{const r=e.getBoundingClientRect();return r.right>clip.left&&r.left<clip.right&&r.bottom>clip.top&&r.top<clip.bottom;};
    const count=selector=>{const es=[...document.querySelectorAll(selector)];return {mounted:es.length,intersecting:es.filter(intersects).length};};
    const box=document.querySelector('.react-flow__viewport');
    return {nodes:count('.react-flow__node'),functions:count('.react-flow__node-bidirectional'),edges:count('.react-flow__edge'),handles:count('.react-flow__handle'),labels:count('.react-flow__edgelabel-renderer > *'),dom:document.querySelectorAll('*').length,dpr:devicePixelRatio,
      hostClass:box.closest('.x-csu-large,.project-functional-diagram')?.className||null,willChange:getComputedStyle(box).willChange,visibility:document.visibilityState,focused:document.hasFocus()};
  });
  const identity=()=>page.evaluate(()=>({nodes:[...document.querySelectorAll('.react-flow__node')].map(e=>[e.getAttribute('data-id'),e.style.transform]),edges:[...document.querySelectorAll('.react-flow__edge')].map(e=>[e.getAttribute('data-testid'),e.querySelector('.react-flow__edge-path')?.getAttribute('d')])}));
  if(args.cache==='1') await page.waitForFunction(()=>Number(document.querySelector('[data-edge-images-ready]')?.getAttribute('data-edge-images-ready'))>0||!!document.querySelector('[data-edge-image-fallback]'),null,{timeout:20000});
  if(args.cache==='1') { const fallback=await page.locator('.x-architecture-motion').getAttribute('data-edge-image-fallback');assert.equal(fallback,null,'Cache prepared: '+fallback); };
  const original=await identity();report.originalCounts={nodes:original.nodes.length,edges:original.edges.length};
  async function gesture(scaleName,kind,{isolate='none',trace=false,warmup=false}={}){
    const before=await setup(zooms[scaleName]);
    const state=await snapshot();
    const point=await page.evaluate(()=>{
      const r=document.querySelector('.react-flow__pane').getBoundingClientRect();
      for(let y=Math.max(r.top+30,100);y<Math.min(r.bottom-90,innerHeight-50);y+=35)for(let x=Math.max(r.left+180,300);x<Math.min(r.right-180,innerWidth-60);x+=35){if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return {x,y};}
      return {x:r.left+r.width*.5,y:r.top+r.height*.5};
    });
    await page.mouse.move(point.x,point.y);await page.waitForTimeout(100);
    if(trace){await cdp.send('Profiler.start');await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,cc,gpu,viz,benchmark,disabled-by-default-devtools.timeline.frame',transferMode:'ReturnAsStream'});}
    await reset();
    await page.evaluate(kind=>{
      const viewport=document.querySelector('.react-flow__viewport');
      const s=window.__overviewGesture={frames:[],events:[],transforms:[],first:null,last:null};
      const types=kind==='pan'?['pointerdown','pointermove','pointerup']:['wheel'];
      const input=e=>{if(kind==='pan'&&e.type==='pointermove'&&!(e.buttons&4))return;const time=performance.now();s.first??=time;s.last=time;s.events.push({type:e.type,time,trusted:e.isTrusted});};
      types.forEach(type=>window.addEventListener(type,input,{capture:true,passive:true}));
      let last=performance.now();const tick=time=>{s.frames.push({start:last,end:time,ms:time-last});s.transforms.push({time,style:viewport.style.transform,moving:!!viewport.closest('[data-viewport-moving]'),cached:document.querySelectorAll('svg[data-edge-image-active]').length,willChange:getComputedStyle(viewport).willChange});last=time;s.raf=requestAnimationFrame(tick);};
      s.raf=requestAnimationFrame(tick);s.stop=()=>{cancelAnimationFrame(s.raf);types.forEach(type=>window.removeEventListener(type,input,true));};
      performance.mark('overview-input-start');
    },kind);
    try{
      if(kind==='pan'){
        await page.mouse.down({button:'middle'});
        for(let i=1;i<=steps;i++){await page.mouse.move(point.x+i*3,point.y+i);await page.waitForTimeout(16);}
        await page.mouse.up({button:'middle'});
      }else{
        for(let i=0;i<steps;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:center.x,y:center.y,deltaX:0,deltaY:i%2?-3:3,modifiers:2});await page.waitForTimeout(16);}
      }
    }finally{await page.evaluate(()=>{window.__overviewGesture.stop();performance.mark('overview-input-end');});}
    const measured=await page.evaluate(()=>{
      const s=window.__overviewGesture;return {frames:s.frames.filter(f=>f.start>=s.first&&f.end<=s.last).map(f=>f.ms),inputMs:s.last-s.first,events:s.events,
        firstRafMs:s.frames.find(f=>f.end>=s.first)?.end-s.first,transforms:s.transforms.filter(t=>t.time>=s.first&&t.time<=s.last)};
    });
    const active=await collect();const after=await view();
    assert.ok(measured.events.length>3&&measured.events.every(e=>e.trusted),'Trusted gestures');
    assert.ok(measured.frames.length>3,'Enough active frames');
    assert.ok(new Set(measured.transforms.map(t=>t.style)).size>1,'Viewport moved during gesture');
    const sample={scaleName,kind,isolate,traced:trace,before,after,state,frames:quant(measured.frames),over25ms:measured.frames.filter(v=>v>25).length,firstRafMs:measured.firstRafMs,inputMs:measured.inputMs,
      inputCount:measured.events.length,commits:active.commits.length,longTasks:active.long,reads:active.reads.length,writes:active.writes.length,heap:active.heap,
      cacheFrames:measured.transforms.filter(t=>t.cached>0).length,activeFrames:measured.transforms.length,motionStyles:[...new Set(measured.transforms.map(t=>`${t.moving}:${t.willChange}`))]};
    if(trace){
      const filename=out+`.${level}-${scaleName}-${kind}-${isolate}`;
      const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await done;let data='';
      for(;;){const chunk=await cdp.send('IO.read',{handle:stream});data+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});
      fs.writeFileSync(filename+'.trace.json',data);const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(filename+'.cpuprofile',JSON.stringify(profile));
      const events=JSON.parse(data).traceEvents,start=events.find(e=>e.name==='overview-input-start')?.ts,end=events.findLast(e=>e.name==='overview-input-end')?.ts;
      const costs={};const names=['Layout','Paint','UpdateLayoutTree','Layerize','PrePaint','FunctionCall','MinorGC','MajorGC','RasterTask','DrawFrame','Commit','CompositeLayers'];
      for(const e of events)if(e.ph==='X'&&e.dur&&e.ts>=start&&e.ts<=end&&names.includes(e.name)){
        const cost=costs[e.name]||={calls:0,inclusiveMs:0,maxMs:0};cost.calls++;cost.inclusiveMs+=e.dur/1000;cost.maxMs=Math.max(cost.maxMs,e.dur/1000);
      }
      sample.trace={filename,start,end,costs,note:'Inclusive events can overlap and cross threads; do not add totals.'};report.traces.push(sample);
    }else if(!warmup)(isolate==='none'?report.measurements:report.isolates).push(sample);
    await stable();sample.settled=await view();
    if(!warmup){console.log(JSON.stringify({level,scaleName,kind,isolate,trace,p95:sample.frames.p95,commits:sample.commits,zoom:before.zoom,visibleNodes:state.nodes.intersecting,visibleEdges:state.edges.intersecting}));save();}
    return sample;
  }
  if(args.warmup!=='0') { await gesture('overview','pan',{warmup:true});await gesture('overview','zoom',{warmup:true}); }
  if(args.isolateOnly!=='1'){
    // Interleave scales by repetition to reduce monotonic warmup/thermal bias.
    for(let i=0;i<samples;i++)for(const scale of (i%2?['close','intermediate','overview']:['overview','intermediate','close'])){
      for(const kind of ['pan','zoom'])await gesture(scale,kind);
    }
    for(const scale of ['overview','intermediate','close']){await setup(zooms[scale]);await page.screenshot({path:out+'.'+scale+'.png'});}
  }
  if(args.profile==='1')for(const scale of ['overview','close'])for(const kind of ['pan','zoom'])await gesture(scale,kind,{trace:true});
  const styles={
    edges:'.react-flow__edge { visibility:hidden !important; }',
    markers:'.react-flow__edge-path { marker-start:none !important; marker-end:none !important; }',
    labels:'.react-flow__edgelabel-renderer,.react-flow__edge-textwrapper { display:none !important; }',
    nodes:'.react-flow__nodes { visibility:hidden !important; }',
    effects:'.react-flow__node,.react-flow__node *,.react-flow__edge,.react-flow__edge * { filter:none !important;box-shadow:none !important;animation:none !important; }',
    interactionPaths:'.react-flow__edge-interaction { display:none !important; }',
    edgeHitTesting:'.react-flow__edge,.react-flow__edge * { pointer-events:none !important; }',
    noPromotion:'.react-flow__viewport { will-change:auto !important; }',
  };
  for(const name of (args.isolates||'').split(',').filter(Boolean)){
    assert.ok(styles[name],name);const tag=await page.addStyleTag({content:styles[name]});
    for(let i=0;i<samples;i++)for(const kind of ['pan','zoom'])await gesture('overview',kind,{isolate:name});
    if(args.profileIsolates==='1'||(args.profileIsolates||'').split(',').includes(name))await gesture('overview','pan',{isolate:name,trace:true});
    await tag.evaluate(e=>e.remove());await stable();await fit();
    const restored=await identity();assert.equal(restored.nodes.length,original.nodes.length);assert.equal(restored.edges.length,original.edges.length);
  }
  await fit();const final=await identity();
  assert.deepEqual(final.nodes,original.nodes,'Viewport gestures must not change node layout');
  assert.deepEqual(final.edges.map(e=>e[0]),original.edges.map(e=>e[0]),'Every connection remains present');
  if(args.sweep==='1') await require('./diagram-overview-sweep.cjs')({page,cdp,setup,zooms,report});
  if(args.pinchContinuity==='1')await require('./diagram-pinch-continuity.cjs')({page,cdp,setup,zooms,report,expectSmooth:args.expectSmooth==='1'});
  if(args.pinchBurst==='1')await require('./diagram-pinch-burst.cjs')({page,cdp,setup,zooms,report});
  if(args.pinchTrace==='1')await require('./diagram-pinch-trace.cjs')({page,cdp,setup,zooms,report,out});
  if(args.trackpadPan==='1')await require('./diagram-trackpad-pan.cjs')({page,cdp,setup,zooms,report});
  if(args.pinchCompare==='1')await require('./diagram-pinch-comparison.cjs')({page,cdp,setup,zooms,report,repeats:Number(args.pinchRepeats||3),zoomLimits:[Number(args.pinchMinZoom||0),Number(args.pinchMaxZoom||Infinity)]});
  if(args.visual==='1') await require('./diagram-overview-visual.cjs')({page,out,setup,zooms,report});
  report.preserved={nodeLayout:true,edgeIds:true};report.passed=true;save();
};
