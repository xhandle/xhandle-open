// Historical pre-fix reproducer. Assertions intentionally describe the old defects.
// For current regression checks, run the corresponding verify-code-architecture-link-navigation script.
const assert = require('node:assert/strict');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
  const page=await browser.newPage({viewport:{width:1700,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.route('**/api/chat',r=>r.fulfill({status:401,body:'No AI calls in diagnostic'}));
  await page.goto('http://localhost:3000');
  await page.evaluate(async()=>{
   const id='copy-code-project',rid='copy-code-repo';
   localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id,name:'Copy code fixture',activeRepoId:rid,repos:[{id:rid,owner:'fixture',repo:'copy',repoId:'fixture/copy',repoName:'fixture/copy',branch:'main'}]}]));
   localStorage.setItem('xhandle.activeCodeArchitectureProjectId',id);
   for(const [kind,prefix] of [['software-requirements','SWR'],['system-requirements','SYS'],['subsystem-requirements','SUB'],['design-elements','DES']]){
    localStorage.setItem(`xhandle:cba-${kind}:${id}:${rid}`,JSON.stringify([{id:prefix+'-1',requirementText:'Keep a safe state',designDescription:'Protective control',source:'hazard-derived',sourceTraceId:'FD-1',linkedHazards:'HZ-1',parentSwRequirement:'SWR-1',parentSystemRequirement:'SYS-1',parentRequirement:'SUB-1'}]));
   }
   await new Promise((resolve,reject)=>{
    const req=indexedDB.open('xhandle',4);
    req.onupgradeneeded=()=>{for(const name of ['code_index','copilot_baseline','diagram_positions'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,{keyPath:'key'});};
    req.onerror=()=>reject(req.error);req.onsuccess=()=>{
     const db=req.result;const tx=db.transaction('copilot_baseline','readwrite');
     tx.objectStore('copilot_baseline').put({key:`cba:${id}:${rid}`,value:[
      {traceId:'FD-1',rowRef:1,from:'Plan',fromFile:'control.js',fromDetails:'Plan motion',action:'Stop',controlActionDetails:'Stop request',to:'Control',toFile:'control.js',toDetails:'Apply brakes',architecture:{subsystem:'Motion',csci:'Controller',csc:'Control',csu:'Planner'},hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'},
      {traceId:'FD-2',rowRef:2,from:'Control',fromFile:'control.js',fromDetails:'Apply brakes',action:'Feedback',to:'Plan',toFile:'control.js',architecture:{subsystem:'Motion'},hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'},
     ]});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
   });
  });
  await page.reload();
  await page.getByRole('button',{name:'Copy code fixture',exact:true}).first().click({timeout:60000});


  const observations=[];
  const sample=async(label)=>observations.push({label,...await page.evaluate(()=>({
    selected:[...document.querySelectorAll('.react-flow__node.selected')].map(n=>n.getAttribute('data-id')),
    viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style'),
    target:document.querySelector('[data-id="n:Plan"]')?.getAttribute('style'),
  }))});
  for(let attempt=1;attempt<=2;attempt++) {
    await page.getByLabel('Code architecture actions',{exact:true}).click();
    await page.getByRole('button',{name:'Table',exact:true}).click();
    await page.getByRole('button',{name:'Open Function (From) in the CSU diagram',exact:true}).first().click();
    for(const delay of [150,450,1400,3000]) {await page.waitForTimeout(delay);await sample(`attempt ${attempt} after +${delay}ms`);}
  }
  await page.getByRole('button',{name:'Hazard & Remediation',exact:true}).click();
  await page.getByRole('button',{name:'Safety Remediation',exact:true}).click();
  await page.getByRole('button',{name:'Software Requirements',exact:true}).click();
  await page.getByRole('button',{name:'HZ-1',exact:true}).click();
  await page.waitForTimeout(200);
  const wrongSubtab=await page.getByRole('button',{name:'Copy safety remediation findings table',exact:true}).isVisible();
  assert.equal(wrongSubtab,true,'Current bug: hazard link incorrectly leaves remediation open');
  console.log(JSON.stringify({observations,hazardLinkOpensWrongSubtab:wrongSubtab,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
