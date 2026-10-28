import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {sha256} from 'hash.js';
import {serialize,deserialize} from 'v8';
import {saveCodeArchitectureHazardRun,getLatestCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,openCodeArchitectureHazardDB,resolveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {PAGED_HAZARD} from './hazardRowIndex';
import {queryHazardRows} from './pagedHazardRows';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
const fixture=()=>({id:'paged',projectId:'page',repoId:'r',runState:'complete',architectureRowsSnapshot:['evidence '.repeat(20000)],generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard','Operational Context ID','Safety Significant'],...Array.from({length:1000},(_,i)=>['HA-'+i,`row ${i} `+'value '.repeat(100),i%2?'a':'b','No'])]},pendingAttempt:{runState:'incomplete',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['partial','saved partial']]}}});
const read=()=>getLatestCodeArchitectureHazardRun({projectId:'page'},{workingSet:true,paged:true});
// Regression coverage for resolved edits and actual App review handlers.
test('resolved edits reject stale writes without hiding the saved record',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const descriptor=await read();
 const first=await resolveCodeArchitectureHazardRun(descriptor),second=await resolveCodeArchitectureHazardRun(descriptor);
 await saveCodeArchitectureHazardRun({...first,reviewStatus:'reviewed'});
 await expect(saveCodeArchitectureHazardRun({...second,repoName:'renamed'})).rejects.toThrow('Saved analysis changed');
 const stored=await getCodeArchitectureHazardRunById(descriptor.id);
 expect(stored.repoName).toBeUndefined();expect(stored.reviewStatus).toBe('reviewed');
});

// Invoke the real App callbacks with a paged run in their closure. This avoids
// mounting unrelated App services while exercising their actual code paths.
const appText=require('fs').readFileSync(require('path').resolve(__dirname,'../../App.js'),'utf8');
const ast=require('@babel/parser').parse(appText,{sourceType:'module',plugins:['jsx']});
const callbacks={};
const pending=[ast];
while(pending.length){
 const node=pending.pop();if(!node||typeof node!=='object')continue;
 if(node.type==='VariableDeclarator' && ['applyHazardVibeReviewDecision','undoHazardVibeReviewDecision','getHazardVibeReviewState'].includes(node.id?.name))callbacks[node.id.name]=appText.slice(node.init.arguments[0].start,node.init.arguments[0].end);
 if(node.type==='VariableDeclarator' && node.id?.name==='handleImportCodeArchitectureSummary')callbacks.csv=appText.slice(node.init.start,node.init.end);
 if(node.type==='JSXAttribute' && node.name?.name==='onNarrativeReviewUpdate' && node.value?.expression?.type==='ArrowFunctionExpression')callbacks.narrative=appText.slice(node.value.expression.start,node.value.expression.end);
 if(node.type==='FunctionDeclaration' && ['removeProposedSafetyAssessmentColumns','findSummaryColumn','normalizeAllocationText'].includes(node.id?.name))callbacks[node.id.name]=appText.slice(node.start,node.end);
 for(const value of Object.values(node))if(Array.isArray(value))pending.push(...value);else if(value&&typeof value==='object')pending.push(value);
}
const {ensureHazardAnalysisRowIds}=require('../project-hazard-analysis/classificationResolutionStatus');
const {indexVibeReviewHeaders}=require('../project-hazard-analysis/vibeReviewScope');
function appCallback(name,run,overrides={}){
 const dependencies={resolveCodeArchitectureHazardRun,saveCodeArchitectureHazardRun,commitCodeArchitectureHazardRun:jest.fn(),
 ...require('../project-hazard-analysis/classificationResolutionStatus'),
 ...require('../project-hazard-analysis/vibeReviewScope'),
 ...require('../project-hazard-analysis/governedDecisionCommit'),
 findSummaryColumn:Function(`${callbacks.normalizeAllocationText}; return (${callbacks.findSummaryColumn})`)(),
 activeCodeArchitectureProjectIdRef:{current:run.projectId},codeArchitectureHazardRunRef:{current:run},getCodeArchitectureHazardRunById,ensureHazardAnalysisRowIds,indexVibeReviewHeaders,
  removeProposedSafetyAssessmentColumns:Function(`return (${callbacks.removeProposedSafetyAssessmentColumns})`)(),...overrides};
 return Function(...Object.keys(dependencies),`return (${callbacks[name]})`)(...Object.values(dependencies));
}
test('real governed-review apply can update a valid saved paged run',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const run=await read();
 await expect(appCallback('applyHazardVibeReviewDecision',run)({projectId:run.projectId,workspaceType:'code-based-architecture',sourceRunId:run.id,sourceRowId:'HA-0',update:{'Safety Significant':'Yes'}})).resolves.toMatchObject({sourceRowId:'HA-0'});
 const sheet=(await getCodeArchitectureHazardRunById(run.id)).generatedSheets.Summary;
 expect(sheet.length).toBe(1001);expect(sheet[1][sheet[0].indexOf('Safety Significant')]).toBe('Yes');
});
test('real governed-review undo restores a paged run',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const run=await read();
 await expect(appCallback('undoHazardVibeReviewDecision',run)({projectId:run.projectId,workspaceType:'code-based-architecture',sourceRunId:run.id,sourceRowId:'HA-0',previousGovernedFields:{'Safety Significant':'No'}})).resolves.toMatchObject({sourceRowId:'HA-0'});
});

test('review actions reject a workspace switch while resolution is pending',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const run=await read();
 const projectRef={current:run.projectId},commit=jest.fn();
 const resolve=async value=>{const full=await resolveCodeArchitectureHazardRun(value);projectRef.current='another';return full;};
 await expect(appCallback('applyHazardVibeReviewDecision',run,{activeCodeArchitectureProjectIdRef:projectRef,resolveCodeArchitectureHazardRun:resolve,commitCodeArchitectureHazardRun:commit})({projectId:run.projectId,workspaceType:'code-based-architecture',sourceRunId:run.id,sourceRowId:'HA-0',update:{'Safety Significant':'Yes'}})).rejects.toThrow('active hazard analysis changed');
 expect(commit).not.toHaveBeenCalled();
});

for(const action of ['csv','narrative'])test(`${action} handler rejects concurrent changes and does not commit a stale snapshot`,async()=>{
 await saveCodeArchitectureHazardRun(fixture());const run=await read(),commit=jest.fn();
 const dependencies={
  resolveCodeArchitectureHazardRun,codeArchitectureHazardRunRef:{current:run},activeCodeArchitectureProjectIdRef:{current:run.projectId},activeCodeArchitectureProjectId:run.projectId,
  codeArchitectureCsvWorkspaceRef:{current:{key:'same',running:false}},codeArchitectureCsvWorkspaceKey:'same',codeArchitectureHazardContexts:[],
  commitCodeArchitectureHazardRun:commit,
  ...require('./codeHazardImportContext'),...require('./codeArchitectureHazardUtils'),
  saveCodeArchitectureHazardRun:async edited=>{
   const concurrent=await getCodeArchitectureHazardRunById(run.id);
   await saveCodeArchitectureHazardRun({...concurrent,reviewStatus:'newer'});
   return saveCodeArchitectureHazardRun(edited);
  },
 };
 const callback=Function(...Object.keys(dependencies),`return (${callbacks[action]})`)(...Object.values(dependencies));
 const operation=action==='csv'?callback([['Raw Analysis Row ID','Hazard'],['HA-0','edited']],run,true):callback(run,{text:'review'});
 await expect(operation).rejects.toMatchObject({code:'HAZARD_REVISION_CONFLICT'});
 expect(commit).not.toHaveBeenCalled();
 expect((await getCodeArchitectureHazardRunById(run.id)).reviewStatus).toBe('newer');
});

test('review state provider awaits the paged summary and checks the active snapshot',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const run=await read();
 const summary=[['Raw Analysis Row ID','Hazard'],['HA-0','review me']];
 const deps={section:'code-architecture',activeCodeArchitectureProjectId:run.projectId,activeCodeArchitectureProject:{name:'Project'},codeArchitectureHazardRun:run,codeArchitectureHazardMethod:'STPA',activeCodeArchitectureRepoMeta:{},getProjectOrganizationCalibration:()=>({context:{}}),readHazardReviewSummary:jest.fn(async()=>summary)};
 expect((await appCallback('getHazardVibeReviewState',run,deps)()).summary).toEqual(summary);
});

test('a stale edit does not broadcast its proposed data as the current run',async()=>{
 await saveCodeArchitectureHazardRun(fixture());const run=await read();
 const first=await resolveCodeArchitectureHazardRun(run),stale=await resolveCodeArchitectureHazardRun(run);
 await saveCodeArchitectureHazardRun({...first,reviewStatus:'accepted'});
 const listener=jest.fn();window.addEventListener('xhandle:hazard-save-state',listener);
 try {await expect(saveCodeArchitectureHazardRun({...stale,reviewStatus:'stale'})).rejects.toMatchObject({code:'HAZARD_REVISION_CONFLICT'});expect(listener).not.toHaveBeenCalled();}
 finally{window.removeEventListener('xhandle:hazard-save-state',listener);}
});

test('raw review pages preserve stored columns and cells for decision fingerprints',async()=>{
 const original=fixture();await saveCodeArchitectureHazardRun(original);const run=await read();
 const page=await queryHazardRows(run,{raw:true});
 expect(page.headers).toEqual(original.generatedSheets.Summary[0]);
 expect(page.rows).toEqual(original.generatedSheets.Summary.slice(1,1+page.rows.length));
});
