// Isolated synthetic projects only. Does not attach to the user's browser.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/review-large-view-performance.cjs
const fs = require('fs');
const { chromium, webkit } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const count = Number(process.env.PERF_INTERFACES || 20);
const rows = Array.from({length:count}, (_, i) => ({
  id: 'row-'+i, system: 'System '+Math.floor(i/30), subsystem: 'Subsystem '+Math.floor(i/5),
  fromFunction:'Function '+i, toFunction:'Function '+((i+1)%count), controlAction:'Command '+i,
  fromDetails:'Responsible for receiving state, validating commands, and controlling vehicle behavior.',
  toDetails:'Receive valid commands and report state.', controlDetails:'Command validity, timing and acknowledgment.',
}));
(async()=>{
 const browser = process.env.PERF_BROWSER==='webkit' ? await webkit.launch({headless:true}) : await chromium.launch({headless:true, executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
 const page = await browser.newPage({viewport:{width:1500,height:1000}});
 await page.addInitScript(({rows})=>{
   const id='perf-synthetic';
   if (!sessionStorage.getItem('perf-seeded')) {
   localStorage.setItem('xhandle.projects', JSON.stringify([{id,name:'Performance fixture',createdAt:new Date().toISOString()}]));
   localStorage.setItem('xhandle.sidebarProjectsOpen','true');
   localStorage.setItem('xhandle.sidebarLocked','true');
   localStorage.setItem('xhandle.projectData',JSON.stringify({[id]:{responseRows:rows,riskMethod:'STPA',riskRegister:[],requirements:[]}}));
   sessionStorage.setItem('perf-seeded','true');
   }
   window.perfStorageWrites=[];
   const originalSetItem=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){const start=performance.now();try{return originalSetItem.call(this,key,value);}finally{window.perfStorageWrites.push({key,ms:performance.now()-start});}};
   window.perfLongTasks=[];
   try {new PerformanceObserver(list=>window.perfLongTasks.push(...list.getEntries().map(e=>({duration:e.duration,startTime:e.startTime})))).observe({entryTypes:['longtask']});}catch{}
 },{rows});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message); if(process.env.PERF_DEBUG)console.error(e.message);});
 await page.goto(process.env.XHANDLE_URL||'http://localhost:3000',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Performance fixture',exact:true}).click({timeout:60000});
 await page.locator('.react-flow__node').first().waitFor({timeout:60000});
 await page.waitForFunction(()=>document.querySelector('.react-flow')?.style.visibility==='visible',{},{timeout:60000});
 // Allow pending initial layout/persistence to settle before interaction timings.
 await page.waitForTimeout(1500);
 const cdp = process.env.PERF_BROWSER==='webkit' ? {send:async()=>({profile:{nodes:[]}})} : await page.context().newCDPSession(page);
 await cdp.send('Profiler.enable');
 const stats = {};
 async function measure(name, selector, index=0) {
  await cdp.send('Profiler.start');
  const result = await page.evaluate(async({selector,index})=>{
    const target=document.querySelectorAll(selector)[index];
    if(!target)throw Error('Missing '+selector);
    const start=performance.now();window.perfLongTasks=[];window.perfStorageWrites=[];
    if(selector.startsWith('.react-flow__node')){
      const rect=target.getBoundingClientRect();
      const options={bubbles:true,cancelable:true,view:window,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2};
      target.dispatchEvent(new MouseEvent('mousedown',{...options,buttons:1,button:0}));
      window.dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0,button:0}));
    }
    target.click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const ms=Math.round(performance.now()-start);
    await new Promise(resolve=>setTimeout(resolve,0));
    return {ms,longTasks:window.perfLongTasks.filter(e=>e.startTime+e.duration>=start).map(e=>Math.round(e.duration)),storageWrites:window.perfStorageWrites,selectedNodes:document.querySelectorAll('.react-flow__node.selected').length};
  },{selector,index});
  const {profile}=await cdp.send('Profiler.stop');
  if(process.env.PERF_PROFILE_DIR)fs.writeFileSync(process.env.PERF_PROFILE_DIR+'/'+name+'-'+count+'.cpuprofile',JSON.stringify(profile));
  const weights=new Map();
  profile.samples?.forEach((id,i)=>weights.set(id,(weights.get(id)||0)+(profile.timeDeltas[i]||0)));
  result.hotFrames=profile.nodes.map(n=>({name:n.callFrame.functionName||'(anonymous)',ms:Math.round((weights.get(n.id)||0)/1000),line:n.callFrame.lineNumber+1,url:n.callFrame.url})).filter(n=>n.ms>0).sort((a,b)=>b.ms-a.ms).slice(0,12);
  stats[name]=result;
 }
 // Use the actual graph element's click handler, without relying on zoomed coordinates.
 const diagramCounts=await page.evaluate(()=>({nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,dom:document.querySelectorAll('*').length}));
 for(let i=0;i<3;i++)await measure('diagram-select-'+i,'.react-flow__node:not(.react-flow__node-groupBox)',i);
 const hazardTab=page.getByRole('tab',{name:'Hazard Analysis',exact:true});
 await hazardTab.evaluate(el=>el.dataset.perfTab='hazards');
 await measure('hazard-tab','[data-perf-tab="hazards"]');
 await page.locator('[role="textbox"][aria-label^="Function (From), row"]').first().waitFor({timeout:60000});
 if(process.env.PERF_COMPLETED==='1'){
   await page.evaluate(({rows})=>{
     const editors=Array.from(document.querySelectorAll('[role="textbox"][aria-label$=", row 1"]'));
     const headers=editors.map(el=>el.getAttribute('aria-label').replace(/, row 1$/, ''));
     const summary=Array.from(document.querySelectorAll('tbody tr')).map(tr=>Array.from(tr.querySelectorAll('[role="textbox"]')).map(el=>el.value ?? el.textContent)).filter(row=>row.length===headers.length);
     const allRows=rows.flatMap((item,index)=>summary.slice(0,7).map((template,guide)=>template.map((value,i)=>({'Function (From)':item.fromFunction,'Function (To)':item.toFunction,'Control Action':item.controlAction,'Subsystem Allocation':item.subsystem,'Raw Analysis Row ID':`PERF-${index}-${guide}`}[headers[i]] ?? value))));
     const populated=allRows.map(row=>row.map((value,i)=>({Hazard:'Vehicle motion conflicts with requested maneuver.',Loss:'Physical injury', 'Causal Scenario':'An outdated command is accepted after the operating state changes.', 'Mitigation Strategy':'Check command sequence and validity before execution.', 'System Requirement':'Reject a command with an expired validity time.', 'Guide Phrase Applicable':'Yes'}[headers[i]] || value)));
     const map=JSON.parse(localStorage.getItem('xhandle.projectData'));
     map['perf-synthetic'].analysisResult={Summary:[headers,...populated]};
     localStorage.setItem('xhandle.projectData',JSON.stringify(map));
   },{rows});
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Performance fixture',exact:true}).click();
   await page.locator('.react-flow__node').first().waitFor({timeout:60000});
   await page.waitForTimeout(3000);
   await page.getByRole('tab',{name:'Hazard Analysis',exact:true}).evaluate(el=>el.dataset.perfTab='hazards');
   await measure('completed-hazard-tab','[data-perf-tab="hazards"]');
   await page.locator('[contenteditable][aria-label^="Function (From), row"]').first().waitFor({timeout:60000});
 }
 const editor='[role="textbox"]';
 const tableCounts=await page.evaluate(()=>({rows:document.querySelectorAll('tbody tr').length,cells:document.querySelectorAll('td').length,textareas:document.querySelectorAll('textarea').length,dom:document.querySelectorAll('*').length}));
 await measure('hazard-cell',editor+'[aria-label^="Function (From), row"]');
 await measure('hazard-cell-next',editor+'[aria-label^="Function (From), row"]',1);
 await measure('hazard-cell-third',editor+'[aria-label^="Function (From), row"]',2);
 await measure('hazard-filter','button[title="Filter Function (From)"]');
 // Close a filter via its existing header button.
 await page.locator('button[title="Filter Function (From)"]').click();
 await measure('quick-search-open','button[aria-label="Quick search"]');
 await page.getByRole('button',{name:'Close · Esc',exact:true}).click();
 const behavior = {};
 if(process.env.PERF_VERIFY==='1'){
   // Search must reveal a row whose cells have never been mounted.
   const lastRowId=`hazard-source-row-${count*7}`;
   behavior.lastRowInitiallyDeferred=await page.locator('#'+lastRowId).getAttribute('data-deferred-row') === 'true';
   await page.getByRole('button',{name:'Quick search',exact:true}).click();
   await page.getByRole('combobox',{name:'Search current view'}).fill('Command '+(count-1));
   await page.getByRole('listbox',{name:'Search results'}).getByRole('option').last().click();
   await page.locator('#'+lastRowId+' [contenteditable]').first().waitFor();
   behavior.searchRevealedLastRow=true;
   const label='Guide Phrase Applicability Rationale, row '+(count*7);
   const cell=page.getByRole('textbox',{name:label,exact:true});
   const edited='Performance regression edit. '.repeat(45);
   await cell.fill(edited);
   await page.getByRole('tab',{name:'Hazard Analysis',exact:true}).click();
   await page.waitForTimeout(800);
   behavior.editSavedInView=(await page.getByRole('textbox',{name:label,exact:true}).innerText())===edited;
   behavior.cellHasNoInternalScroll=await cell.evaluate(el=>el.scrollHeight<=el.clientHeight+1);
   const savedPositions=await page.evaluate(()=>localStorage.getItem('diagram:positions:perf-synthetic'));
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Performance fixture',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.react-flow')?.style.visibility==='visible',{},{timeout:60000});
   await page.waitForTimeout(300);
   behavior.savedLayoutPreserved=await page.evaluate(expected=>localStorage.getItem('diagram:positions:perf-synthetic')===expected,savedPositions);
   await page.getByRole('tab',{name:'Hazard Analysis',exact:true}).click();
   await page.getByRole('button',{name:'Quick search',exact:true}).click();
   await page.getByRole('combobox',{name:'Search current view'}).fill('Performance regression edit');
   await page.getByRole('listbox',{name:'Search results'}).getByRole('option').first().click();
   behavior.editSurvivedReload=(await page.getByRole('textbox',{name:label,exact:true}).innerText())===edited;
   const excludedSearchToken=await page.locator('#hazard-source-row-1').evaluate(row=>Array.from(row.querySelectorAll('td')).map(cell=>cell.textContent.trim()).find(text=>/^(RAW-|PERF-)/.test(text)));
   if(!excludedSearchToken)throw Error('Missing excluded row ID');
   await page.locator('button[title="Filter Function (From)"]').click();
   await page.locator('label').filter({hasText:new RegExp('^\\s*Function '+(count-1)+'\\s*$')}).locator('input').check();
   await page.locator('button[title="Filter Function (From)"]').click();
   await page.getByRole('button',{name:'Quick search',exact:true}).click();
   await page.getByRole('combobox',{name:'Search current view'}).fill(excludedSearchToken);
   behavior.searchRespectsFilters=await page.getByRole('listbox',{name:'Search results'}).getByRole('option').count()===0;
   await page.getByRole('button',{name:'Close · Esc',exact:true}).click();
   await page.getByRole('button',{name:'Clear filters',exact:true}).click();
   await page.getByRole('button',{name:'Collapse all groups',exact:true}).click();
   await page.getByRole('button',{name:'Quick search',exact:true}).click();
   await page.getByRole('combobox',{name:'Search current view'}).fill('Command');
   behavior.searchRespectsCollapsedGroups=await page.getByRole('listbox',{name:'Search results'}).getByRole('option').count()===0;
   await page.getByRole('button',{name:'Close · Esc',exact:true}).click();
   await page.getByRole('button',{name:'Expand all groups',exact:true}).click();
   if(Object.values(behavior).some(value=>value!==true))throw Error('Behavior regression: '+JSON.stringify(behavior));
 }
 console.log(JSON.stringify({interfaces:count,mode:process.env.PERF_COMPLETED==='1'?'completed':'draft',diagramCounts,tableCounts,stats,behavior,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
