// Isolated current-code diagnostics; no real browser storage is touched.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const app=fs.readFileSync('src/App.js','utf8');
const recovery=fs.readFileSync('src/lib/decompositionRecovery.js','utf8').replace(/export /g,'');
const project=app.slice(app.indexOf('let projectMapReadFailed = false;'),app.indexOf('function getProjectOrganizationCalibration'));
const ctx={console:{error(){},warn(){}},result:null};vm.createContext(ctx);
vm.runInContext(`${recovery}
const primary={responseRows:['NEW'],_updatedAt:'2026-09-28T12:00:00Z'};
const old={responseRows:['OLD'],updatedAt:'2026-09-27T12:00:00Z'};
result=chooseDecompositionRecovery(primary,old);
`,ctx);
assert.strictEqual(ctx.result,null);
console.log('PASS: legacy primary content is preserved.');
vm.runInContext(`
const PROJECT_DATA_KEY='project';
const disk=JSON.stringify({p:{responseRows:['ORIGINAL'],decompositionVersion:1}});
let checkpoint;
const localStorage={getItem:()=>disk,setItem:()=>{throw new Error('quota');}};
const saveRecoveryRecord=(key,value)=>{checkpoint=value;return Promise.resolve();};
${project}
const saved=saveProjectPatch('p',{responseRows:['REJECTED IMPORT']});
const restored=chooseDecompositionRecovery(JSON.parse(disk).p,checkpoint);
result={saved,restored};
`,ctx);
assert.strictEqual(ctx.result.saved,false);
assert.strictEqual(ctx.result.restored,null);
console.log('PASS: rejected import cannot automatically recover.');

(async () => {
 const guard=fs.readFileSync('src/lib/projectRunGuard.js','utf8').replace(/export /g,'');
 const start=app.indexOf('  const importDecompositionCSV =');
 const source=app.slice(start,app.indexOf('\n  /**',start));
 for (const navigateAt of ['read','checkpoint','none']) {
  let releaseRead, releaseCheckpoint;
  const published=[], saved=[];
  const scope={activeProjectId:'A',activeProjectIdRef:{current:'A'},navigationEpochRef:{current:0},
   responseRows:[],window:{alert(){},confirm:()=>true},localStorage:{setItem(){}},
   parseFunctionalDecompositionCsv:()=>({rows:[{fromFunction:'new'}]}),describeFunctionalCsvProblems:()=>'',
   ensureFunctionalVibeReviewRowIds:rows=>({rows}),saveProjectPatch:(id)=>{saved.push(id);return true;},
   flushRecoveryRecord:()=>new Promise(resolve=>{releaseCheckpoint=resolve;}),
   setResponseRows:rows=>published.push(rows),setCommittedFunctionalDiagramRows(){},setDiagramCategories(){},
   setFunctionalFilterColumn(){},setFunctionalColumnFilters(){},setFunctionalColumnSearches(){},setCleanOnceKey(){},
   getProjectDiagramRows:rows=>rows,lastKnownFunctionalRowsRef:{current:new Map()},
   file:{text:()=>new Promise(resolve=>{releaseRead=resolve;})}, result:null};
  vm.createContext(scope);vm.runInContext(`${guard}\n${source}\nresult=importDecompositionCSV(file);`,scope);
  const navigate=()=>{scope.activeProjectIdRef.current='B';scope.navigationEpochRef.current++;};
  if(navigateAt==='read')navigate();
  releaseRead('csv');
  for(let n=0;n<10;n++)await Promise.resolve();
  if(navigateAt==='checkpoint')navigate();
  releaseCheckpoint?.();await scope.result;
  assert.strictEqual(published.length,navigateAt==='none'?1:0);
  assert.deepStrictEqual(saved,navigateAt==='read'?[]:['A']);
 }
 console.log('PASS: actual CSV import skips publication after navigation during read or recovery; normal import still publishes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
(async()=>{
 const start=app.indexOf('    const finishProjectLoad = async () =>');
 const source=app.slice(start,app.indexOf('    finishProjectLoad();',start));
 for(const primary of [{responseRows:['saved']},null]) {
  const loaded=[],status=[];
  const scope={data:primary,projectIdForLoad:'A',decompositionLoadCancelled:false,
   recoveryRecord:async()=>{throw new Error('unavailable');},chooseDecompositionRecovery:()=>null,
   setSafetyIssueRefreshStatus:value=>status.push(value),setLoadedProjectId(){},setLoadingProjectId(){},
   setProjectLoaded:value=>loaded.push(value),result:null};
  vm.createContext(scope);vm.runInContext(`${source}\nresult=finishProjectLoad();`,scope);await scope.result;
  assert.strictEqual(loaded.includes(true),Boolean(primary));assert(status.length);
 }
 console.log('PASS: actual hydration loads valid primary when recovery fails, but does not enable saving for missing primary.');
})().catch(error=>{console.error(error);process.exitCode=1;});
