// Synthetic data in a fresh browser context; no customer data or paid calls.
const fs=require('fs'), path=require('path'), parser=require('@babel/parser');
const root=path.resolve(__dirname,'../..');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH || '/tmp/xhandle-hazard-review/node_modules/playwright-core');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
const p=await browser.newPage();await p.route('**/api/**',r=>r.fulfill({status:401,body:'review fixture'}));await p.goto('http://localhost:3000');
const source=fs.readFileSync(path.join(root,'src/features/code-architecture-hazard-analysis/codeArchitectureHazardRunner.js'),'utf8');
const ast=parser.parse(source,{sourceType:'module'});
const imports=ast.program.body.filter(n=>n.type==='ImportDeclaration').map(n=>({path:n.source.value,names:n.specifiers.map(s=>s.local.name)}));
const body=ast.program.body.filter(n=>n.type!=='ImportDeclaration').map(n=>source.slice(n.type==='ExportNamedDeclaration'?n.declaration.start:n.start,n.end)).join('\n');
console.log(JSON.stringify(await p.evaluate(async({imports,body})=>{
const chunk=Object.keys(window).find(k=>k.startsWith('webpackChunk'));window[chunk].push([[Date.now()],{},r=>window.reviewRequire=r]);const req=window.reviewRequire;
const store=req('./src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js');
await Promise.all(Array.from({length:8},(_,i)=>store.saveCodeArchitectureHazardRun({id:'parallel-'+i,projectId:'p'+i,repoId:'shared'})));
const concurrent=(await store.getCodeArchitectureHazardRuns({})).map(r=>r.id);
const original=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(...args){if(this.name==='hazardAnalysisRuns')throw new DOMException('fixture quota','QuotaExceededError');return original.apply(this,args)};
let fallbackSaved=false;try{await store.saveCodeArchitectureHazardRun({id:'fallback-run',projectId:'fallback',repoId:'shared'});fallbackSaved=true;}finally{IDBObjectStore.prototype.put=original;}
const fallbackRead=await store.getLatestCodeArchitectureHazardRun({projectId:'fallback'});
const fallbackPresent=localStorage.getItem('xhandle:code-architecture-hazard-analysis:v1')?.includes('fallback-run');
const utils=req('./src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js');
const runner=req('./src/features/code-architecture-hazard-analysis/codeArchitectureHazardRunner.js');
const rows=[{from:'Estimate Pose',action:'Publish pose',to:'Plan Motion',hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'analyst-override',functionalAbstraction:{version:0}}];
const input=utils.buildCodeArchitectureHazardInput({cbaRows:rows});let staleError='';try{await runner.runCodeArchitectureHazardAnalysis({cbaRows:rows});}catch(e){staleError=e.message;}
const React=req('./node_modules/react/index.js');
const Panel=req('./src/features/code-architecture-hazard-analysis/CodeArchitectureHazardPanel.js').default;
const host=document.createElement('div');document.body.replaceChildren(host);
req('./node_modules/react-dom/client.js').createRoot(host).render(React.createElement(Panel,{cbaRows:rows,method:'STPA-Textbook',operationalContexts:[]}));
await new Promise(r=>setTimeout(r,100));
const runButton=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Run hazard analysis'));
const raw=[{from:'Estimate Pose',action:'Publish pose',to:'Plan Motion',fromDetails:'Nominal pose',hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'analyst-override'}];
const snapshot=utils.buildCodeArchitectureHazardInput({cbaRows:raw});
const changed=raw.map(r=>({...r,fromDetails:'May publish stale pose after loss of sensor input'}));
const modules={};let partial=null,partialError='',saved=0;
for(const entry of imports) {
 const path=new URL(entry.path+'.js','https://fixture/src/features/code-architecture-hazard-analysis/').pathname;
 modules[entry.path]=req('.'+path);
}
modules['../../components/aiAnalysisLite']={runLiteAIAnalysis:async options=>{
 await options.setFolders(()=>({CodeBasedArchitecture:{Summary:[['Function (From)','Control Action','Function (To)','Hazard'],['Estimate Pose','Publish pose','Plan Motion','Partial finding']]}}));
 throw new Error('Synthetic late generation failure');
}};
modules['./codeArchitectureHazardStore']={saveCodeArchitectureHazardRun:async()=>{saved++;}};
modules['./codeArchitectureHazardSourceAudit']={enrichHazardTableRowsWithSourceContent:async rows=>rows};
const declarations=imports.map(entry=>'const {'+entry.names.join(',')+'}=modules['+JSON.stringify(entry.path)+'];').join('\n');
const mockRunner=new Function('modules',declarations+'\n'+body+'\nreturn runCodeArchitectureHazardAnalysis;')(modules);
try {await mockRunner({cbaRows:raw,onPartialRunUpdate:run=>{partial=run;}});}catch(e){partialError=e.message;}
const contextRun={...snapshot,operationalContexts:[{id:'ctx',scenario:'Normal operation',mode:'Normal',conditions:'Dry',assumptions:''}],selectedOperationalContextId:'all'};
const currentContexts=[{id:'ctx',scenario:'Emergency operation',mode:'Emergency',conditions:'Wet',assumptions:''}];
return {partialFailure:{partialError,saved,hasPartial:!!partial,partialMarkedIncomplete:!!partial?.incomplete,partialStale:utils.isCodeArchitectureHazardAnalysisStale({run:partial,cbaRows:raw})},contextChangePanelStale:utils.isCodeArchitectureHazardAnalysisStale({run:contextRun,cbaRows:raw,operationalContexts:currentContexts}),contextChangeRemediationStale:utils.isCodeArchitectureHazardAnalysisStale({run:contextRun,cbaRows:raw}),concurrentExpected:8,concurrentSaved:concurrent,fallbackSaved,fallbackPresent,fallbackRead,staleFunctionalDraftRows:input.tableRows.length,staleFunctionalRunButtonDisabled:runButton.disabled,staleFunctionalRunnerError:staleError,descriptionChangeDetected:utils.isCodeArchitectureHazardAnalysisStale({run:{architectureSnapshotHash:snapshot.architectureSnapshotHash,analysisAbstraction:'detailed'},cbaRows:changed})};

},{imports,body}),null,2));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
