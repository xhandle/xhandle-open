const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require(process.env.XHANDLE_PLAYWRIGHT_MODULE||'playwright-core');
const {electronFixtureMain,cleanEnvironment}=require('./electron-regression-support.cjs');
const {auditTheme}=require('./theme-contrast-audit.cjs');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const stage=fs.realpathSync(arg('--stage')),fixtures=fs.realpathSync(arg('--fixtures'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-report-appearance-'));
const result={root,checks:[],errors:[],samples:[]};let app,page;
const save=()=>fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));
const check=name=>{result.checks.push(name);save();console.log('PASS '+name);};
async function settle(){await page.evaluate(async()=>{for(let i=0;i<5;i++){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const a=document.getAnimations().filter(a=>a.constructor.name==='CSSTransition'&&a.playState==='running');await Promise.all(a.map(a=>a.finished.catch(()=>{})));if(!a.length)break;}});}
async function mode(value){await page.evaluate(value=>window.reportAppearance.setMode(value),value);await settle();}
async function sourceOf(image){return image.evaluate(async el=>{await el.decode();return el.currentSrc||el.src;});}
(async()=>{try{
 for(const name of ['profile','session'])fs.mkdirSync(path.join(root,name));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'report-appearance-test',version:'1.0.0',main:'main.cjs'}));fs.writeFileSync(path.join(root,'main.cjs'),electronFixtureMain(stage,root));
 app=await _electron.launch({executablePath:arg('--electron'),args:[root],env:cleanEnvironment()});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>{result.errors.push(error.stack||error.message);save();});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1600,height:1050}));await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
 await page.addScriptTag({path:path.join(fixtures,'current-view.seed.js')});await page.evaluate(async()=>{await window.seedCollaboratorCurrentView();localStorage.setItem('xhandle.sidebarLocked','true');});
 await page.addScriptTag({path:path.join(fixtures,'report-appearance.seed.js')});
 for(const initial of ['dark','light']){
  await mode(initial);
  const sample=await page.evaluate(async()=>{
   const flow=document.createElement('div');flow.className='react-flow';Object.assign(flow.style,{position:'fixed',top:'120px',left:'40px',width:'500px',height:'300px',background:'var(--bg)'});
   flow.innerHTML='<div class="react-flow__viewport" style="transform:translate(80px,40px) scale(1)"><div class="react-flow__node" style="position:absolute;left:-120px;top:80px;width:100px;height:60px;background:#ff40a0">Custom</div><div class="react-flow__node" style="position:absolute;left:650px;top:-80px;width:100px;height:60px;background:var(--card);color:var(--text)">Theme</div></div>';
   document.body.append(flow);const before=flow.outerHTML,preference=localStorage.getItem('xhandle.darkMode');
   try{
    const images=await window.reportAppearance.captureReportDiagramImages(flow,1);if(!images)throw Error('No paired capture');
    const pixels={};for(const [mode,src]of Object.entries(images)){
     const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d');c.drawImage(image,0,0);
     const pixel=(x,y)=>[...c.getImageData(x,y,1,1).data];pixels[mode]={size:[image.width,image.height],background:pixel(2,2),custom:pixel(60,250),themed:pixel(830,90)};
    }
    window.reportTestImages=images;return {pixels,unchanged:before===flow.outerHTML,preferenceUnchanged:preference===localStorage.getItem('xhandle.darkMode'),mode:document.documentElement.dataset.theme,frames:document.querySelectorAll('iframe[title="Report diagram capture"]').length};
   }finally{flow.remove();}
  });
  result.samples.push({initial,...sample});save();assert(sample.unchanged&&sample.preferenceUnchanged);assert.equal(sample.mode,initial);assert.equal(sample.frames,0);
  assert.deepEqual(sample.pixels.light.background,[255,255,255,255]);assert.deepEqual(sample.pixels.dark.background,[13,20,32,255]);
  for(const m of ['light','dark'])assert.deepEqual(sample.pixels[m].custom,[255,64,160,255]);
  assert.deepEqual(sample.pixels.light.themed,[255,255,255,255]);assert.deepEqual(sample.pixels.dark.themed,[25,37,54,255]);
  check(`Capture begun in ${initial} produces both correct raster appearances, including offscreen/custom nodes, without changing the live scene`);
 }
 const saved=await page.evaluate(async()=>{
  const images=window.reportTestImages;const markdown='# Report appearance fixture\n\n## Functional Architecture\n\n[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]\n\n```xhandle-diagram\n'+JSON.stringify({title:'Structured snapshot',direction:'LR',notes:[],nodes:[{id:'a',label:'Controller'},{id:'b',label:'Actuator'}],edges:[{from:'a',to:'b',label:'Command'}]})+'\n```\n\n## Verification\n\n'+('Recorded verification evidence.\n\n'.repeat(30))+'### Acceptance **criteria**\n\n'+('Recorded acceptance evidence.\n\n'.repeat(20))+'## Verification\n\n'+('Additional verification evidence.\n\n'.repeat(25))+'Results\n-------\n\nFinal recorded outcome.\n\n```text\n# Not a report section\n```';
  const report=await window.reportAppearance.saveGeneratedReport('view-project',{report:markdown,title:'Report appearance fixture',functionalDiagramImage:images.light,functionalDiagramImages:images});
  await window.reportAppearance.saveGeneratedReport('view-project',{report:'# Alternate report\n\n## Other section\n\nOther saved content.',title:'Alternate report fixture'});
  for(const generatedAt of ['2026-11-20T10:00:00Z','2026-11-19T10:00:00Z'])await window.reportAppearance.saveGeneratedReport('view-project',{report:'# Same named report\n\nSaved evidence.',title:'Same report title',generatedAt});
  const metadata=await window.reportAppearance.listGeneratedReports('view-project');if(metadata.some(x=>x.functionalDiagramImages||x.functionalDiagramImage))throw Error('Image leaked into library metadata');return {id:report.libraryId,images};
 });
 await page.reload();await page.getByRole('button',{name:'AV Stack fixture',exact:true}).click();await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByRole('combobox',{name:'Saved report',exact:true}).selectOption({label:'Report appearance fixture'});
 const image=page.getByRole('img',{name:'Functional Architecture',exact:true});await image.waitFor();
 for(const m of ['dark','light','dark']){
  const toggle=page.getByRole('button',{name:`Switch to ${m} mode`,exact:true});if(await toggle.count())await toggle.click();await settle();
  assert.equal(await sourceOf(image),saved.images[m]);const svg=page.getByRole('img',{name:'Structured snapshot',exact:true});await svg.waitFor();
  const fill=await svg.locator('rect').last().evaluate(el=>getComputedStyle(el).fill);assert.equal(fill,m==='dark'?'rgb(25, 52, 81)':'rgb(239, 246, 255)');
  await page.screenshot({path:path.join(root,`project-report-${m}.png`)});
 }
 check('Saved Projects report rasters and structured SVG diagrams follow both theme directions without regeneration');
 const actions=page.getByRole('button',{name:'Report actions',exact:true});
 const sameNamed=await page.getByRole('combobox',{name:'Saved report',exact:true}).locator('option').filter({hasText:'Same report title'}).allTextContents();assert.equal(sameNamed.length,2);assert.equal(new Set(sameNamed).size,2);
 assert.equal(await page.getByRole('heading',{name:/^Saved reports/}).count(),0);assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Generate AI Report',exact:true}).count(),0);assert.equal(await page.getByText('Exports',{exact:true}).count(),0);
 const toolbar=await page.locator('[aria-label="Report toolbar"]').boundingBox(),paper=await page.locator('.report-document-layout').boundingBox();assert(paper.y-toolbar.y-toolbar.height<=8,'No control panels should separate the toolbar and report');assert(paper.height>toolbar.height*5,'The report receives the freed vertical space');
 for(const m of ['light','dark']){
  const toggle=page.getByRole('button',{name:`Switch to ${m} mode`,exact:true});if(await toggle.count())await toggle.click();await settle();await actions.click();
  const menu=page.getByRole('dialog',{name:'Report actions',exact:true});await menu.waitFor();for(const name of ['Export Report as PDF','Export Report as Word (.docx)','Export Report to Google Docs','Rename selected report','Delete selected report'])assert(await menu.getByRole('button',{name,exact:true}).isVisible());
  assert(await menu.getByRole('button',{name:'Generate AI Report',exact:true}).isDisabled());await menu.getByLabel('Report type',{exact:true}).selectOption('Executive Brief');assert.equal(await menu.getByLabel('Report type',{exact:true}).inputValue(),'Executive Brief');await menu.getByLabel('Report type',{exact:true}).selectOption('Safety');
  const box=await menu.boundingBox(),viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.w+1&&box.y+box.height<=viewport.h+1);const audit=await page.evaluate(auditTheme);assert.deepEqual(audit.failures,[]);assert.deepEqual(audit.brightSurfaces,[]);assert.deepEqual(audit.brightAccents,[]);
  await page.screenshot({path:path.join(root,`report-actions-${m}.png`)});await page.keyboard.press('Escape');assert(await menu.isHidden());
 }
 check('A compact report picker and upper-right actions menu replace the large library/generation/export panels in both themes');
 await page.addScriptTag({path:path.join(fixtures,'report-appearance.seed.js')});
 const beforeRename=await page.evaluate(id=>window.reportAppearance.readGeneratedReport('view-project',id),saved.id);
 await actions.click();await page.getByRole('button',{name:'Rename selected report',exact:true}).click();let rename=page.getByRole('dialog',{name:'Rename report',exact:true});const renameAudit=await page.evaluate(auditTheme);assert.deepEqual(renameAudit.failures,[]);assert.deepEqual(renameAudit.brightSurfaces,[]);await page.screenshot({path:path.join(root,'rename-report-dark.png')});await rename.getByRole('textbox',{name:'Report name',exact:true}).fill('Renamed report fixture');await rename.getByRole('button',{name:'Save name',exact:true}).click();await rename.waitFor({state:'hidden'});
 const picker=page.getByRole('combobox',{name:'Saved report',exact:true});await picker.locator('option').filter({hasText:'Renamed report fixture'}).waitFor({state:'attached'});
 const afterRename=await page.evaluate(id=>window.reportAppearance.readGeneratedReport('view-project',id),saved.id);const bodyOnly=({title,updatedAt,...record})=>record;assert.equal(afterRename.title,'Renamed report fixture');assert.deepEqual(bodyOnly(afterRename),bodyOnly(beforeRename));
 await page.reload();await page.getByRole('button',{name:'AV Stack fixture',exact:true}).click();await page.getByRole('button',{name:'Reports',exact:true}).click();await picker.selectOption({label:'Renamed report fixture'});await image.waitFor();assert.equal(await sourceOf(image),saved.images.dark);
 await actions.click();await page.getByRole('button',{name:'Rename selected report',exact:true}).click();rename=page.getByRole('dialog',{name:'Rename report',exact:true});await rename.getByRole('textbox',{name:'Report name',exact:true}).fill('Report appearance fixture');await rename.getByRole('button',{name:'Save name',exact:true}).click();await rename.waitFor({state:'hidden'});await picker.locator('option').filter({hasText:'Report appearance fixture'}).waitFor({state:'attached'});
 check('Renaming persists across reload while retaining the report ID, body, diagrams and generation timestamp');

 const outline=page.getByRole('navigation',{name:'Report contents',exact:true}),reader=page.getByRole('region',{name:'Report document',exact:true});
 assert.equal(await outline.getByRole('link').count(),6);assert.equal(await outline.getByRole('link',{name:'Not a report section',exact:true}).count(),0);assert.equal(await outline.getByRole('link',{name:'Acceptance criteria',exact:true}).count(),1);
 const duplicates=outline.getByRole('link',{name:'Verification',exact:true});assert.equal(await duplicates.count(),2);assert.notEqual(await duplicates.nth(0).getAttribute('href'),await duplicates.nth(1).getAttribute('href'));
 const beforeRoute=await page.evaluate(()=>({hash:location.hash,y:scrollY}));await duplicates.nth(0).click();await settle();assert(await reader.evaluate(el=>el.scrollTop)>0);assert.equal(await duplicates.nth(0).getAttribute('aria-current'),'location');
 assert.deepEqual(await page.evaluate(()=>({hash:location.hash,y:scrollY})),beforeRoute);assert.equal(await page.evaluate(()=>document.activeElement.id),(await duplicates.nth(0).getAttribute('href')).slice(1));
 await reader.evaluate(el=>{el.scrollTop=el.scrollHeight;});await settle();assert.equal(await outline.getByRole('link',{name:'Results',exact:true}).getAttribute('aria-current'),'location');
 await page.getByRole('button',{name:'Hide report contents',exact:true}).click();assert(await outline.isHidden());await page.getByRole('button',{name:'Show report contents',exact:true}).click();assert(await outline.isVisible());
 await page.getByRole('combobox',{name:'Saved report',exact:true}).selectOption({label:'Alternate report fixture'});await outline.getByRole('link',{name:'Other section',exact:true}).waitFor();assert.equal(await reader.evaluate(el=>el.scrollTop),0);assert.equal(await outline.getByRole('link',{name:'Verification',exact:true}).count(),0);
 await page.getByRole('combobox',{name:'Saved report',exact:true}).selectOption({label:'Report appearance fixture'});await outline.getByRole('link',{name:'Results',exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1024,height:850}));await settle();await page.getByRole('button',{name:'Show report contents',exact:true}).waitFor();
 const compactWidth=(await reader.boundingBox()).width;await page.getByRole('button',{name:'Show report contents',exact:true}).click();assert.equal((await reader.boundingBox()).width,compactWidth);await outline.getByRole('link',{name:'Results',exact:true}).click();assert(await outline.isHidden());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1600,height:1050}));await settle();await page.getByRole('button',{name:'Hide report contents',exact:true}).waitFor();await reader.evaluate(el=>{el.scrollTop=0;});await settle();
 await page.screenshot({path:path.join(root,'report-contents-dark.png')});await page.emulateMedia({media:'print'});assert.equal(await page.locator('.report-document-outline').evaluate(el=>getComputedStyle(el).display),'none');await page.emulateMedia({media:'screen'});
 check('Report contents follows rendered headings, isolates scrolling and focus, resets on report changes, collapses and supports compact windows and print');
 const deletedId=await picker.locator('option').filter({hasText:'Alternate report fixture'}).getAttribute('value');await picker.selectOption(deletedId);await page.getByRole('link',{name:'Other section',exact:true}).waitFor();await actions.click();page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Delete selected report',exact:true}).click();assert.equal(await picker.inputValue(),deletedId);
 if(await actions.getAttribute('aria-expanded')!=='true')await actions.click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete selected report',exact:true}).click();await page.waitForFunction(id=>![...document.querySelector('[aria-label="Saved report"]').options].some(option=>option.value===id),deletedId);
 await picker.selectOption({label:'Report appearance fixture'});await image.waitFor();check('Deleting a report requires confirmation, removes its picker entry and preserves the other saved report');


 await page.reload();await page.getByRole('button',{name:'AV Stack fixture',exact:true}).click();await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByRole('combobox',{name:'Saved report',exact:true}).selectOption({label:'Report appearance fixture'});await image.waitFor();assert.equal(await sourceOf(image),saved.images.dark);check('Saved paired snapshots survive report-library reload');
 await page.addScriptTag({path:path.join(fixtures,'report-appearance.seed.js')});
 const record=await page.evaluate(id=>window.reportAppearance.readGeneratedReport('view-project',id),saved.id);assert.deepEqual(record.functionalDiagramImages,saved.images);
 await page.evaluate(images=>{window.reportAppearance.unmount();window.reportAppearance.mountArchitecture({markdown:`# Captured architecture\n\n![Architecture snapshot](${images.light})`,diagramImages:images});},saved.images);
 const architecture=page.locator('#report-appearance-viewer');const mainImage=architecture.getByRole('img',{name:'Architecture snapshot',exact:true});await mainImage.waitFor();
 for(const m of ['light','dark']){await mode(m);assert.equal(await sourceOf(mainImage),saved.images[m]);}
 await mainImage.click();const preview=page.getByRole('img',{name:'Architecture snapshot',exact:true}).last();await mode('light');assert.equal(await sourceOf(preview),saved.images.light);await mode('dark');assert.equal(await sourceOf(preview),saved.images.dark);
 await page.screenshot({path:path.join(root,'architecture-enlarged-dark.png')});
 await page.emulateMedia({media:'print'});await settle();assert.equal(await sourceOf(preview),saved.images.light);await page.emulateMedia({media:'screen'});
 assert.deepEqual(result.errors,[]);result.ok=true;check('Code architecture report, enlarged preview and print choose the saved matching appearance');
}catch(error){result.failure=error.stack;console.error(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}
finally{save();await app?.close();console.log('RESULT '+path.join(root,'result.json')+' '+JSON.stringify({ok:result.ok,checks:result.checks.length,errors:result.errors.length}));}})();
