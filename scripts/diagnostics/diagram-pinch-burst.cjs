const assert = require('node:assert/strict');
const quant = values => { const sorted = [...values].sort((a,b)=>a-b); return {n:sorted.length,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)}; };

// Keep producing trusted input while earlier dispatches are outstanding. An
// await after every CDP wheel artificially lowers the rate during a slow frame.
module.exports = async ({page,cdp,setup,zooms,report}) => {
  report.pinchBursts = [];
  for (const scale of ['overview','close']) {
    await setup(zooms[scale]); await page.waitForTimeout(300);
    const box = await page.locator('.react-flow__pane').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.waitForTimeout(200);
    if(await page.locator('.x-architecture-motion').count())await page.waitForFunction(()=>Number(document.querySelector('[data-edge-images-ready]')?.getAttribute('data-edge-images-ready'))>0,null,{timeout:20000});
    await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport');
      const state = window.__pinchBurst = {started:performance.now(),before:viewport.style.transform,cameraBefore:{...document.querySelector('.react-flow__renderer').__zoom},events:[],frames:[],first:null,last:null};
      const input = event => { const time=performance.now(); state.first??=time; state.last=time; state.events.push({time,trusted:event.isTrusted,delta:event.deltaY}); };
      window.addEventListener('wheel',input,{capture:true,passive:true});
      let previous=performance.now();
      const tick = time => {state.frames.push({start:previous,time,ms:time-previous,transform:viewport.style.transform});previous=time;state.raf=requestAnimationFrame(tick);};
      state.raf=requestAnimationFrame(tick);
      state.stop=()=>{window.removeEventListener('wheel',input,true);cancelAnimationFrame(state.raf);};
    });
    const pending=[],latencies=[],start=performance.now();
    for(let i=0;i<120;i++) {
      const sent=performance.now();
      pending.push(cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width/2,y:box.y+box.height/2,deltaX:0,deltaY:i%24<12?-2:2,modifiers:2}).then(()=>latencies.push(performance.now()-sent)));
      await new Promise(resolve=>setTimeout(resolve,8));
    }
    const produced=performance.now()-start;
    await Promise.all(pending);
    const completed=performance.now()-start;
    // CDP may acknowledge input before the compositor delivers the final wheel
    // to the page. Test cleanup relative to the last delivered event, not ACK.
    await page.waitForFunction(()=>window.__pinchBurst.last!==null&&performance.now()-window.__pinchBurst.last>=650,null,{timeout:20000});
    const measured=await page.evaluate(()=>{
      const state=window.__pinchBurst;state.stop();
      const frames=state.frames.filter(f=>f.start>=state.first&&f.time<=state.last);
      let previous=state.before;const changed=[];
      for(const frame of state.frames){if(frame.time>=state.first&&frame.time<=state.last&&frame.transform!==previous)changed.push(frame.time);previous=frame.transform;}
      return {deliveryEndMs:state.last-state.started,idleMs:performance.now()-state.last,movingElements:[...document.querySelectorAll('[data-viewport-moving]')].map(e=>e.className),received:state.events.length,trusted:state.events.every(e=>e.trusted),deltaSum:state.events.reduce((sum,e)=>sum+e.delta,0),inputMs:state.last-state.first,
        frames:frames.map(f=>f.ms),changedFrameIntervals:changed.slice(1).map((time,i)=>time-changed[i]),changedFrames:changed.length,
        cameraBefore:state.cameraBefore,cameraAfter:{...document.querySelector('.react-flow__renderer').__zoom},firstChangedFrameMs:changed[0]-state.first,before:state.before,after:document.querySelector('.react-flow__viewport').style.transform,moving:!!document.querySelector('[data-viewport-moving]')};
    });
    const sample={scale,sent:pending.length,producerMs:produced,completionMs:completed,backlogMs:completed-produced,dispatchLatency:quant(latencies),...measured,frames:quant(measured.frames),changedFrameIntervals:quant(measured.changedFrameIntervals)};
    report.pinchBursts.push(sample);console.log('High-rate pinch',JSON.stringify(sample));
    assert.ok(measured.received>2&&measured.trusted,'Burst must deliver real browser wheel events');
    assert.equal(measured.deltaSum,0,'Coalescing must preserve every wheel delta');
    assert.ok(measured.changedFrames>3,'The camera must update repeatedly during the burst');
    assert.ok(Math.abs(measured.cameraBefore.k-measured.cameraAfter.k)<1e-8&&Math.hypot(measured.cameraBefore.x-measured.cameraAfter.x,measured.cameraBefore.y-measured.cameraAfter.y)<.01,'A balanced burst returns to the original camera without losing input');
    assert.equal(measured.moving,false,'Pinch presentation must restore after the burst');
  }
};
