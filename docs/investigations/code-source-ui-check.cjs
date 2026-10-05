// Isolated six-area smoke fixture; set XHANDLE_MIXED_FIXTURE=1 for current and historical evidence.
const assert = require('node:assert/strict');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
  const page=await browser.newPage({viewport:{width:1700,height:1000}});
  const mixed=process.env.XHANDLE_MIXED_FIXTURE === '1';
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.route('**/api/**',r=>r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Isolated fixture: backend requests disabled'})}));
  await page.goto('http://localhost:3000');
  await page.evaluate(async(mixed)=>{
   const id='copy-code-project',rid='copy-code-repo';
   localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id,name:'Copy code fixture',activeRepoId:rid,repos:[{id:rid,owner:'fixture',repo:'copy',repoId:'fixture/copy',repoName:'fixture/copy',branch:'main'}]}]));
   localStorage.setItem('xhandle.activeCodeArchitectureProjectId',id);
   for(const [kind,prefix] of [['software-requirements','SWR'],['system-requirements','SYS'],['subsystem-requirements','SUB'],['design-elements','DES']]){
    localStorage.setItem(`xhandle:cba-${kind}:${id}:${rid}`,JSON.stringify([{id:prefix+'-1',requirementText:'Keep a safe state',designDescription:'Protective control',source:'hazard-derived',sourceTraceId:'FD-1',parentSwRequirement:'SWR-1',parentSystemRequirement:'SYS-1',parentRequirement:'SUB-1'}]));
   }
   await new Promise((resolve,reject)=>{
    const req=indexedDB.open('xhandle',4);
    req.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,{keyPath:'key'});};
    req.onerror=()=>reject(req.error);req.onsuccess=()=>{
     const db=req.result;const tx=db.transaction('copilot_baseline','readwrite');
     tx.objectStore('copilot_baseline').put({key:`cba:${id}:${rid}`,value:[
      {...(mixed ? {evidenceVersion:1,sourceType:'github',snapshotId:'a'.repeat(40),lineage:{version:1,status:'current',scope:'cba:copy-code-project:copy-code-repo'}} : {}),traceId:'FD-1',rowRef:1,from:'Plan',fromFile:'control.js',fromDetails:'Plan motion',action:'Stop',controlActionDetails:'Stop request',to:'Control',toFile:'control.js',toDetails:'Apply brakes',architecture:{subsystem:'Motion',csci:'Controller',csc:'Control',csu:'Planner'},hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'},
      {traceId:'FD-2',rowRef:2,from:'Control',fromFile:'control.js',fromDetails:'Apply brakes',action:'Feedback',to:'Plan',toFile:'control.js',architecture:{subsystem:'Motion'},hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'},
      ...(mixed ? [{traceId:'FD-OLD',rowRef:3,from:'HistoricalOnly',action:'Old command',to:'OldTarget',architecture:{subsystem:'Old subsystem'},lineage:{version:1,status:'historical',scope:'cba:copy-code-project:copy-code-repo'}}] : []),
     ]});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
   });
  },mixed);
  await page.reload();
  await page.getByRole('button',{name:'Copy code fixture',exact:true}).first().click({timeout:60000});
  if(mixed) {
   await page.getByLabel('Code architecture actions',{exact:true}).click();
   await page.getByRole('button',{name:'Architecture',exact:true}).click();
   await page.locator('.react-flow').first().waitFor();
   assert.equal(await page.locator('.react-flow__node').filter({hasText:'HistoricalOnly'}).count(),0);
  }
  await page.getByLabel('Code architecture actions',{exact:true}).click();
  await page.getByRole('button',{name:'Table',exact:true}).click();
  const copy=page.getByRole('button',{name:'Copy code architecture functional decomposition table',exact:true});
  await copy.click();
  const read=()=>page.evaluate(()=>navigator.clipboard.readText());
  let copied=await read();assert.ok(copied.includes('Stop'));assert.ok(copied.includes('Feedback'));
  await page.getByTitle('Filter Control Action',{exact:true}).click();
  await page.getByRole('checkbox',{name:'Stop',exact:true}).check();
  await copy.click();copied=await read();assert.ok(copied.includes('Stop'));assert.ok(!copied.includes('Feedback'));
  const initial=await copy.boundingBox();
  await page.getByRole('region',{name:'Code architecture functional decomposition table',exact:true}).locator('table').evaluate(t=>{t.parentElement.scrollLeft=1000;t.parentElement.scrollTop=500;});
  assert.deepEqual(await copy.boundingBox(),initial);
  for(const [tab,label,id] of [
   ['Software Requirements','Copy software requirements table','SWR-1'],
   ['System Requirements','Copy system requirements table','SYS-1'],
   ['Subsystem Requirements','Copy subsystem requirements table','SUB-1'],
   ['System / Subsystem Design','Copy system / subsystem design table','DES-1'],
   ['Traceability Matrix','Copy traceability matrix table','SWR-1'],
  ]){
   await page.getByRole('button',{name:tab,exact:true}).click();
   await page.getByRole('button',{name:label,exact:true}).click();
   copied=await read();assert.ok(copied.startsWith('| '));assert.ok(copied.includes(id),`${tab}: ${copied}`);
  }
  await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
  await page.getByRole('button',{name:'Copy code architecture hazard analysis table',exact:true}).click();
  copied=await read();assert.ok(copied.includes('Guide Phrase'));assert.ok(copied.includes('Stop'));assert.ok(!copied.includes('Old command'));
  await page.screenshot({path:'/tmp/code-hazard-copy.png'});
  await page.getByRole('button',{name:'Safety Remediation',exact:true}).click();
  await page.getByRole('button',{name:'Copy safety remediation findings table',exact:true}).waitFor();
  await page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const req=indexedDB.open('xhandle-safety-remediation');
      req.onsuccess=()=>{const db=req.result;const tx=db.transaction('safetyFindings','readwrite');
        tx.objectStore('safetyFindings').put({id:'finding-1',projectId:'copy-code-project',repoId:'fixture/copy',title:'Unsafe stop',hazard:'Motion continues',proposedMitigation:'Apply brake',reviewStatus:'draft_ai_generated',coveredHazardRowRefs:['RAW-1'],coveredHazardRows:[{rowRef:'RAW-1',hazard:'Motion continues',mitigation:'Apply brake',sourceFiles:['control.js']}]});
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };req.onerror=()=>reject(req.error);
    });
    window.dispatchEvent(new CustomEvent('xhandle:safety-remediation:changed'));
  });
  await page.getByRole('button',{name:'Copy safety remediation findings table',exact:true}).click();
  copied=await read();assert.ok(copied.includes('Unsafe stop'));assert.ok(copied.includes('Apply brake'));
  await page.getByRole('button',{name:'Copy hazard summary coverage table',exact:true}).click();
  copied=await read();assert.ok(copied.includes('| RAW-1 | Motion continues | Apply brake | control.js |'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({mixed,functional:true,filtered:true,fixedButton:true,requirements:true,design:true,traceability:true,hazardDraft:true,remediation:true,coverage:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
