const fs=require('node:fs'),path=require('node:path');

async function launchQualityPreview({root,directory,desktop,electron,playwright,fixture,contexts=[],modelSettings,organizationProfile}) {
  const {_electron}=require(playwright);
  const stage=path.join(directory,'preview-app');
  fs.mkdirSync(path.join(stage,'stage'),{recursive:true});
  fs.cpSync(path.join(desktop,'electron'),path.join(stage,'electron'),{recursive:true});
  fs.copyFileSync(path.join(desktop,'package.json'),path.join(stage,'package.json'));
  fs.symlinkSync(path.join(desktop,'node_modules'),path.join(stage,'node_modules'),'dir');
  const backend=path.join(stage,'stage/backend');
  require(path.join(desktop,'scripts/stage-backend-runtime.cjs')).stageBackendRuntime(root,backend);
  fs.copyFileSync(path.join(desktop,'electron/backend.cjs'),path.join(backend,'desktop-backend.cjs'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(backend,'node_modules'),'dir');
  fs.cpSync(path.join(root,'build'),path.join(stage,'stage/renderer'),{recursive:true});
  fs.writeFileSync(path.join(stage,'build-metadata.json'),JSON.stringify({reviewWorkingTree:true,reviewDescription:'Live functional hazard-quality validation preview'}));
  const shell=path.join(directory,'preview-shell');fs.mkdirSync(shell);
  for(const name of ['profile','session','downloads'])fs.mkdirSync(path.join(shell,name));
  fs.writeFileSync(path.join(shell,'package.json'),JSON.stringify({name:'xhandle-quality-preview',version:'1.0.0',main:'main.cjs'}));
  fs.writeFileSync(path.join(shell,'main.cjs'),require('../electron-regression-support.cjs').electronFixtureMain(stage,shell));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:electron,args:[shell],env});
  const page=await app.firstWindow();await page.waitForURL('xhandle://app/**',{waitUntil:'domcontentloaded'});
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setTitle('xHandle — LIVE hazard quality validation');window.setBounds({width:1550,height:1000});window.show();window.focus();});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // This window observes real worker execution. It cannot accidentally issue
  // unmetered AI calls from an app button or a background feature.
  await page.route('**/api/chat',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Live validation is running in the metered harness worker. Watch the live panel.'})}));
  await page.route('**/api/openai',route=>route.fulfill({status:409,contentType:'application/json',body:'{"error":"Use the metered live validation worker."}'}));
  let state={message:'Starting live validation',phase:'Preparing',rows:[],score:null,spent:0,cap:25};
  const draw=async()=>{
    if(page.isClosed())return;
    await page.evaluate(state=>{
      let panel=document.getElementById('xhandle-live-quality');
      if(!panel){
        panel=document.createElement('section');panel.id='xhandle-live-quality';
        Object.assign(panel.style,{position:'fixed',right:'16px',bottom:'16px',width:'min(650px,65vw)',maxHeight:'70vh',overflow:'auto',zIndex:'2147483647',background:'#12202d',color:'#f1f5f9',border:'1px solid #7795a6',borderRadius:'12px',boxShadow:'0 8px 36px #0008',padding:'18px',font:'14px system-ui'});
        document.body.append(panel);
      }
      panel.replaceChildren();
      const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;panel.append(node);return node;};
      add('strong','LIVE · Functional hazard quality validation');
      const toggle=add('button',window.__QUALITY_PANEL_COLLAPSED__?'Expand monitor':'Collapse monitor');
      toggle.style.cssText='float:right;padding:4px 8px;border:1px solid #7795a6;border-radius:5px';
      const size=()=>{panel.style.maxHeight=window.__QUALITY_PANEL_COLLAPSED__?'125px':'70vh';panel.style.overflow=window.__QUALITY_PANEL_COLLAPSED__?'hidden':'auto';};
      toggle.onclick=()=>{window.__QUALITY_PANEL_COLLAPSED__=!window.__QUALITY_PANEL_COLLAPSED__;toggle.textContent=window.__QUALITY_PANEL_COLLAPSED__?'Expand monitor':'Collapse monitor';size();};size();
      add('p',state.phase+' · '+state.message);
      add('p',`Campaign: $${Number(state.spent).toFixed(3)} / $${state.cap} · Target ≥9/10${state.score==null?'':` · Score ${Number(state.score).toFixed(2)}/10`}`);
      add('small','Real production prompts and artifacts from the metered diagnostic worker. This isolated app is a live observer.');
      if(state.rows.length){
        add('p',state.rowKind==='steps'?'Validation stages':state.rowKind==='findings'?'Quality findings':`${state.completed || state.rows.length} assessments available · latest results`);
        const table=add('table','');table.style.width='100%';
        for(const row of state.rows.slice(-6)){
          const tr=document.createElement('tr');
          for(const value of [row.id || '',row.title || '',row.text || '']){const td=document.createElement('td');td.textContent=String(value);td.style.cssText='padding:7px 5px;border-top:1px solid #425766;vertical-align:top;max-width:420px';tr.append(td);}
          table.append(tr);
        }
      }
    },state);
  };
  await page.addInitScript(()=>{window.__QUALITY_OBSERVER__=true;});
  await page.evaluate(({modelSettings,organizationProfile})=>{
    if(modelSettings){localStorage.setItem('xhandle.aiProvider.active',modelSettings.provider);localStorage.setItem('xhandle.aiProviderModel.'+modelSettings.provider,modelSettings.model);localStorage.setItem('xhandle.aiProviderEffort.'+modelSettings.provider,modelSettings.effort || 'medium');}
    if(organizationProfile)localStorage.setItem('xhandle.organizationProfile',organizationProfile);
  },{modelSettings,organizationProfile});
  page.on('domcontentloaded',()=>draw().catch(()=>{}));
  await draw();
  const publishArchitecture=async rows=>{
    await page.evaluate(async({rows,repo,contexts})=>{
      const project={id:'quality-benchmark',name:'LIVE · Haulage quality benchmark',repos:[{...repo,id:'quality-repo',imported:true}],activeRepoId:'quality-repo'};
      localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([project]));
      localStorage.setItem('xhandle.activeCodeArchitectureProjectId',project.id);
      localStorage.setItem('xhandle.sidebarCodeArchitectureProjectsOpen','true');
      for(const repoId of ['quality-repo',repo.repoId || repo.repoName])if(repoId)localStorage.setItem('xhandle:code-architecture-hazard-contexts:v1:quality-benchmark:'+encodeURIComponent(repoId),JSON.stringify(contexts));
      if(rows.every(row=>row.functionalAbstraction))localStorage.setItem('cba:quality-benchmark:quality-repo:architecture-abstraction','functional');
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('xhandle',4);request.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction('copilot_baseline','readwrite');tx.objectStore('copilot_baseline').put({key:'cba:quality-benchmark:quality-repo',value:rows});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
      localStorage.setItem('cbaMeta:quality-benchmark:quality-repo',JSON.stringify({repoId:repo.repoId,repoName:repo.repoName,rowCount:rows.length,storage:'indexedDB'}));
    },{rows,repo:fixture.repos[0].repo,contexts});
    await page.reload({waitUntil:'domcontentloaded'});
    const project=page.getByRole('button',{name:'LIVE · Haulage quality benchmark',exact:true}).first();
    if(await project.count())await project.click();
    if(rows.every(row=>row.functionalAbstraction)) {
      await page.getByRole('region',{name:'Functional model diagram'}).or(page.locator('section[aria-label="Functional model diagram"]')).first().waitFor({state:'visible',timeout:30000});
      await page.locator('section[aria-label="Functional model diagram"] .react-flow__node').first().waitFor({state:'visible',timeout:30000});
    }
    await draw();
  };
  try {await publishArchitecture(fixture.repos[0].rows);} catch(error) {await app.close();throw error;}
  return {app,page,errors,
    async update(patch){state={...state,...patch};await draw();},
    publishArchitecture,
    async publishRun(run){
      // Feed the production reader's legacy migration path. The app migrates
      // this complete saved result into its isolated authoritative IndexedDB.
      await page.evaluate(run=>localStorage.setItem('xhandle:code-architecture-hazard-analysis:v1',JSON.stringify({hazardAnalysisRuns:[{...run,projectId:'quality-benchmark'}]})),run);
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'LIVE · Haulage quality benchmark',exact:true}).first().click();
      await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
      await page.getByRole('table',{name:'Code architecture hazard analysis',exact:true}).waitFor({state:'visible',timeout:30000});
      await draw();
    },
    async screenshot(file){await page.screenshot({path:file});},
    async close(){await app.close();},
  };
}
module.exports={launchQualityPreview};
