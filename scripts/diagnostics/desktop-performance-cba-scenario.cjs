// Actual-App CBA scenario. Used by desktop-interaction-performance.cjs.
const fs=require('node:fs'),assert=require('node:assert/strict');
module.exports=async({page,cdp,reset,collect,interaction,prepareInteractions,finishGraphOnly,result,args,out,quant,app})=>{
 if(args.loadingUi==='1')return require('./verify-cba-tab-loading.cjs')({page,cdp,result,args,out,app,collect});
 if(args.hazardScroll==='1')return require('./continuous-hazard-scrolling.cjs')({page,cdp,result,args,out,app,collect});
 const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const graph=()=>page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length>0&&!document.body.textContent.includes('Arranging diagram...'));
 const expectedFunctions=+(args.nodes||100);
 const expectedRelationships=result.cbaFixture.architectureRows;
 const graphSnapshot=()=>page.evaluate(()=>({
  functions:[...document.querySelectorAll('.react-flow__node-bidirectional')].map(e=>e.getAttribute('data-id')).sort(),
  nodes:[...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.getAttribute('data-id'),transform:e.style.transform})).sort((a,b)=>a.id.localeCompare(b.id)),
  edges:[...document.querySelectorAll('.react-flow__edge')].map(e=>({id:e.getAttribute('data-testid')?.replace(/^rf__edge-/,''),path:e.querySelector('.react-flow__edge-path')?.getAttribute('d')})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),
 }));
 const readStoredPositions=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('xhandle',4);open.onsuccess=()=>{const db=open.result,tx=db.transaction('diagram_positions'),get=tx.objectStore('diagram_positions').getAll();get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};open.onerror=()=>reject(open.error);}));
 const geometryTolerance=0.01; // layout units; <0.02 CSS pixels even at maximum zoom
 function pathCommands(path){
  const commands=[];
  for(const token of path.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)||[]){
   if(/^[a-zA-Z]$/.test(token))commands.push({command:token,args:[]});
   else commands.at(-1).args.push(Number(token));
  }
  const result=[];
  for(const command of commands){
   const previous=result.at(-1);
   // Scaled DOM handle bounds can introduce a subpixel, zero-length elbow.
   // Drop only that adjacent L leg; retain every meaningful control coordinate.
   if(command.command==='L'&&command.args.length===2&&previous?.args.length>=2
    &&command.args.every((value,index)=>Math.abs(value-previous.args.at(index-2))<=geometryTolerance))continue;
   result.push(command);
  }
  return result;
 }
 function compareGeometry(before,after){
  assert.deepEqual(after.functions,before.functions);
  assert.deepEqual(after.nodes,before.nodes,'Viewport input must preserve exact node transforms');
  assert.deepEqual(after.edges.map(e=>e.id),before.edges.map(e=>e.id));
  const differences=[];let maximumCoordinateDeviation=0;
  before.edges.forEach((edge,index)=>{
   const current=after.edges[index];if(edge.path===current.path)return;
   const oldCommands=pathCommands(edge.path),newCommands=pathCommands(current.path);
   assert.deepEqual(newCommands.map(c=>[c.command,c.args.length]),oldCommands.map(c=>[c.command,c.args.length]),'Path commands changed for '+edge.id);
   let maximum=0;
   oldCommands.forEach((command,i)=>command.args.forEach((value,j)=>{maximum=Math.max(maximum,Math.abs(value-newCommands[i].args[j]));}));
   differences.push({id:edge.id,maximumCoordinateDeviation:maximum,before:edge.path,after:current.path});
   maximumCoordinateDeviation=Math.max(maximumCoordinateDeviation,maximum);
  });
  fs.writeFileSync(out+'.geometry-comparison.json',JSON.stringify({tolerance:geometryTolerance,maximumCoordinateDeviation,differences},null,2));
  assert.ok(maximumCoordinateDeviation<=geometryTolerance,'Viewport path coordinates changed beyond subpixel handle-measurement precision');
  return {tolerance:geometryTolerance,maximumCoordinateDeviation,pathsWithNumericalJitter:differences.length};
 }
 async function completeCsuGraph(){
  await graph();
  await page.waitForFunction(({nodes,edges})=>document.querySelectorAll('.react-flow__node-bidirectional').length===nodes&&document.querySelectorAll('.react-flow__edge-path').length===edges,{nodes:expectedFunctions,edges:expectedRelationships});
  const scene=await graphSnapshot();
  assert.deepEqual(scene.functions,Array.from({length:expectedFunctions},(_,i)=>'perf-node-'+i).sort(),'CSU must retain every fixture function exactly once');
  assert.deepEqual(scene.edges.map(e=>e.id).sort(),Array.from({length:expectedRelationships},(_,i)=>'perf-edge-'+i).sort(),'CSU must retain every fixture relationship exactly once');
  assert.ok(scene.edges.every(e=>e.path&&!/NaN|Infinity/.test(e.path)),'Every relationship must have finite rendered geometry');
  return scene;
 }
 const tables={
  'Software Requirements':()=>page.locator('tbody').filter({hasText:'SWR-0'}).waitFor(),
  'System Requirements':()=>page.locator('tbody').filter({hasText:'SYS-0'}).waitFor(),
  'Subsystem Requirements':()=>page.locator('tbody').filter({hasText:'SUB-0'}).waitFor(),
  'System / Subsystem Design':()=>page.locator('tbody').filter({hasText:'DES-0'}).waitFor(),
  'Traceability Matrix':()=>page.locator('tbody').filter({hasText:'TRACE-'}).waitFor(),
  'Hazard & Remediation':async()=>{await page.getByRole('button',{name:'Next rows',exact:true}).waitFor();await page.locator('tbody td').first().waitFor();},
 };
 result.cbaSwitches=[];result.cbaScroll={};result.cbaAbstractions=[];const menu=()=>page.getByLabel('Code architecture actions',{exact:true}).click();
 async function measure(name,action,ready,profile=false){
  console.log('CBA',name);await reset();if(profile)await cdp.send('Profiler.start');await action();try{await ready();}catch(error){fs.writeFileSync(out+'.body.txt',await page.locator('body').innerText());throw error;}await frame();const sample={view:name,...await collect()};
  if(profile){const {profile:p}=await cdp.send('Profiler.stop');fs.writeFileSync(out+'.'+name.replace(/[^a-z0-9]/gi,'_')+'.cpuprofile',JSON.stringify(p));}
  result.cbaSwitches.push(sample);fs.writeFileSync(out+'.partial.json',JSON.stringify(result,null,2));return sample;
 }
 async function scroll(name){await reset();const container=await page.locator('tbody').first().evaluateHandle(body=>{let e=body.parentElement;while(e){if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+200)return e;e=e.parentElement;}return null;});
  const box=await container.asElement()?.boundingBox();if(!box){result.cbaScroll[name]={unmeasured:'No overflowing table container'};return;}
  await page.mouse.move(box.x+Math.min(300,box.width/2),box.y+Math.min(160,box.height/2));
  await page.evaluate(()=>{window.__frames=[];window.__last=performance.now();window.__active=true;const tick=t=>{if(!window.__active)return;window.__frames.push(t-window.__last);window.__last=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  const before=await container.evaluate(e=>e.scrollTop);for(let i=0;i<30;i++){await page.mouse.wheel(0,180);await page.waitForTimeout(16);}await page.waitForTimeout(180);
  const after=await container.evaluate(e=>e.scrollTop);const frames=await page.evaluate(()=>{window.__active=false;return window.__frames.slice(3);});result.cbaScroll[name]={...await collect(),before,after,frames:quant(frames),over25ms:frames.filter(f=>f>25).length};assert.ok(after>before,'Wheel input must scroll '+name);await container.evaluate(e=>e.scrollTop=0);await frame();
 }
 await measure('Cold Architecture Diagram',()=>page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().click(),completeCsuGraph,true);await page.waitForTimeout(1200);
 const originalScene=await completeCsuGraph();result.cbaGraphCounts=await collect();result.cbaGraphIdentity={functionIds:originalScene.functions,nodeIds:originalScene.nodes.map(n=>n.id),edgeIds:originalScene.edges.map(e=>e.id)};
 const storedPositionsBefore=await readStoredPositions();
 await prepareInteractions();
 for(let i=0;i<(args.interactions==='skip'?0:Number(args.samples??3));i++){await interaction('cbaPan'+i,'pan');await interaction('cbaZoom'+i,'zoom');}
 if(!result.isolation){result.cbaGestureGeometry=compareGeometry(originalScene,await completeCsuGraph());assert.deepEqual(await readStoredPositions(),storedPositionsBefore,'Viewport gestures must preserve exact persisted positions');result.cbaGestureGeometry.persistedPositionsIdentical=true;result.cbaGestureGeometryPreserved=true;}
 fs.writeFileSync(out+'.partial.json',JSON.stringify(result,null,2));
 if(args.renderingChecks)await require('./cba-rendering-regression.cjs')({page,cdp,app,result,args,out,ready:completeCsuGraph});
 if(args.graphOnly==='1'){await finishGraphOnly();return;}
 for(const level of ['CSC','CSCI','Subsystem','Functional','CSU']){
  const sample=await measure('Abstraction '+level,()=>page.getByRole('button',{name:level,exact:true}).click(),level==='CSU'?completeCsuGraph:graph,true);result.cbaAbstractions.push(sample);
  if(level==='Functional'){
   await menu();await measure('Functional Model Table',()=>page.getByRole('button',{name:'Table',exact:true}).click(),()=>page.getByRole('button',{name:'Copy functional model',exact:true}).waitFor(),true);await scroll('Functional Model Table');
   await menu();await page.getByRole('button',{name:'Architecture',exact:true}).click();await graph();
  }
 }
 await menu();await measure('Architecture Table',()=>page.getByRole('button',{name:'Table',exact:true}).click(),()=>page.getByRole('button',{name:'Copy code architecture functional decomposition table',exact:true}).waitFor(),true);
 await page.locator('tbody td').first().waitFor();await scroll('Architecture Table');
 for(const [name,ready] of Object.entries(tables)){await measure(name,()=>page.getByRole('button',{name,exact:true}).click(),ready,true);await scroll(name);
  if(name==='Hazard & Remediation'){
   await measure('Hazard next page',()=>page.getByRole('button',{name:'Next rows',exact:true}).click(),()=>page.getByText(new RegExp('101–200 of '+result.cbaFixture.rows+' matching rows')).waitFor(),true);
   await measure('Hazard search last row',()=>page.getByRole('textbox',{name:'Search all saved hazard rows'}).fill('HA-'+(result.cbaFixture.rows-1)),()=>page.getByText('1–1 of 1 matching rows',{exact:true}).waitFor(),true);
   await page.getByRole('textbox',{name:'Search all saved hazard rows'}).fill('');await page.getByText(new RegExp('1–100 of '+result.cbaFixture.rows+' matching rows')).waitFor();
  }
 }
 await measure('Safety Remediation',()=>page.getByRole('button',{name:'Safety Remediation',exact:true}).click(),()=>page.getByRole('heading',{name:'Safety Remediation',exact:true}).waitFor(),true);
 // Repeat every requested CBA surface; readiness requires populated target content.
 for(let i=0;i<+(args.cycles||3);i++){
  for(const [name,ready] of Object.entries(tables)){await measure(name,async()=>{await page.getByRole('button',{name,exact:true}).click();if(name==='Hazard & Remediation')await page.getByRole('button',{name:'Code Architecture Hazard Analysis',exact:true}).click();},ready);}
  await measure('Architecture Table',()=>page.getByRole('button',{name:'Architecture Diagram',exact:true}).click(),()=>page.getByRole('button',{name:'Copy code architecture functional decomposition table',exact:true}).waitFor());
 }
 // Restore the actual graph, select a node, exercise source-detail and layout reentry.
 await page.getByRole('button',{name:'Architecture Diagram',exact:true}).click();
 await page.getByRole('button',{name:'Copy code architecture functional decomposition table',exact:true}).waitFor();
 await menu();await page.getByRole('button',{name:'Architecture',exact:true}).click();await graph();await page.waitForTimeout(800);
 const positions=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('xhandle',4);r.onsuccess=()=>{const db=r.result,tx=db.transaction('diagram_positions'),g=tx.objectStore('diagram_positions').getAll();g.onsuccess=()=>resolve(g.result);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);}));
 await page.locator('.react-flow__controls-fitview').click();await page.waitForTimeout(600);
 const saved=await positions();const savedRecord=saved.find(record=>Array.isArray(record.value)&&record.value.filter(([id])=>/^perf-node-/.test(id)).length===expectedFunctions);assert.ok(savedRecord,'Expected complete saved CSU positions');
 const beforeReentry=await completeCsuGraph();
 const selectedIndex=Math.min(10,expectedFunctions-1),selectedId='perf-node-'+selectedIndex;
 const node=page.getByTestId('rf__node-'+selectedId);await node.click({force:true});assert.ok((await node.getAttribute('class')).split(/\s+/).includes('selected'),'The requested CBA node must be selected');
 await page.getByRole('button',{name:'Software Requirements',exact:true}).click();await tables['Software Requirements']();await page.getByRole('button',{name:'Architecture Diagram',exact:true}).click();await graph();await page.waitForTimeout(800);
 const restored=await positions();
 assert.deepEqual(restored.find(record=>record.key===savedRecord.key),savedRecord,'Saved positions must survive CBA tab reentry');
 assert.deepEqual(await completeCsuGraph(),beforeReentry,'Rendered IDs, positions and paths must survive CBA tab reentry');
 // At fitted overview scale, a forced double-click can hit an overlapping
 // edge. Use the actual graph search to reveal the exact node first.
 await page.getByRole('button',{name:'Quick search',exact:true}).click();await page.getByRole('combobox',{name:'Search current view'}).fill('Function '+selectedIndex);
 await page.getByRole('option').filter({has:page.getByText('Diagram node · Function '+selectedIndex,{exact:true})}).click();await page.waitForTimeout(700);
 await node.dblclick();await page.getByRole('button',{name:'Close',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:/^Edit (Node|Edge)$/}).innerText(),'Edit Node','Node double click must open node details');
 const nodeModal=page.getByRole('heading',{name:'Edit Node',exact:true}).locator('..').locator('..');assert.equal(await nodeModal.getByLabel('Label',{exact:true}).inputValue(),'Function '+selectedIndex);
 await nodeModal.locator('summary').filter({hasText:'Architecture Trace'}).click();await nodeModal.locator('summary').filter({hasText:/^Details$/}).first().click();
 const detailBody=await nodeModal.innerText();const detailIncludesSource=detailBody.includes('src/unit_'+selectedIndex+'.cpp');if(!detailIncludesSource)fs.writeFileSync(out+'.details-body.txt',detailBody);assert.ok(detailIncludesSource,'Selected CBA details must contain the expected source file');await nodeModal.getByRole('button',{name:'Close',exact:true}).click();
 await measure('Other CBA project',async()=>{await page.mouse.move(20,200);await page.getByRole('button',{name:'Other CBA fixture',exact:true}).first().click();},graph,true);
 await measure('CBA project return',async()=>{await page.mouse.move(20,200);await page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().click();},completeCsuGraph,true);
 result.cbaSemantics={selection:true,selectedNodeId:selectedId,nodeDetailsIncludeSource:detailIncludesSource,projectSwitch:true,positionRecordsBefore:saved.length,positionRecordsAfter:restored.length,positionKey:savedRecord.key,positionsIdentical:true,renderedGeometryIdentical:true};
 if(args.verify==='1'){
  result.cbaSemantics.repositorySwitch='persisted preference + actual App reload';
  const switchRepo=async id=>{await page.evaluate(id=>{const projects=JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects'));projects.find(p=>p.id==='perf-cba').activeRepoId=id;localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify(projects));},id);await page.reload();await page.getByRole('button',{name:'CBA performance fixture',exact:true}).first().click();await graph();};
  await switchRepo('fixture/other');await menu();await page.getByRole('button',{name:'Table',exact:true}).click();await page.getByText('10 of 10 rows match filters',{exact:true}).waitFor();
  await switchRepo('fixture/repo');await completeCsuGraph();
  await page.getByRole('button',{name:'Software Requirements',exact:true}).click();await tables['Software Requirements']();
  const index=+(args.artifacts||1000)-1;
  const find=async text=>{await page.getByRole('button',{name:'Quick search',exact:true}).click();await page.getByRole('combobox',{name:'Search current view'}).fill(text);await page.getByRole('listbox',{name:'Search results'}).getByRole('option').first().click();};
  await find('SWR-'+index);const row=page.locator('tr[data-virtual-key]').filter({hasText:'SWR-'+index});const button=row.locator('button[title^="SWR requirement"]');await button.click();await row.locator('textarea').first().fill('PERF CBA preserved edit '+index);await page.getByRole('heading',{name:'Software Requirements',exact:true}).click();await page.waitForTimeout(1200);
  await page.getByRole('button',{name:'System Requirements',exact:true}).click();await tables['System Requirements']();await page.getByRole('button',{name:'Software Requirements',exact:true}).click();await tables['Software Requirements']();await find('PERF CBA preserved edit');await page.getByRole('button',{name:'PERF CBA preserved edit '+index,exact:true}).waitFor();result.cbaSemantics.offscreenArtifactSearchAndSavedEdit=true;
  await page.getByRole('button',{name:'Architecture Diagram',exact:true}).click();await graph();await menu();await page.getByRole('button',{name:'Table',exact:true}).click();await page.getByRole('button',{name:'Open Function (From) in the CSU diagram',exact:true}).first().click();await graph();await page.waitForFunction(()=>document.querySelector('.react-flow__node.selected'));result.cbaSemantics.linkedNodeNavigation=true;
 }
 result.cbaSummary=Object.fromEntries([...new Set(result.cbaSwitches.map(s=>s.view))].map(v=>[v,quant(result.cbaSwitches.filter(s=>s.view===v).map(s=>s.elapsed))]));
 result.idleMemory=[];for(let i=0;i<3;i++){await page.waitForTimeout(1000);result.idleMemory.push(await page.evaluate(()=>performance.memory?.usedJSHeapSize));}await cdp.send('HeapProfiler.collectGarbage');result.heapAfterDiagnosticGC=await page.evaluate(()=>performance.memory?.usedJSHeapSize);result.processMetrics=app?await app.evaluate(({app})=>app.getAppMetrics()):null;
};
