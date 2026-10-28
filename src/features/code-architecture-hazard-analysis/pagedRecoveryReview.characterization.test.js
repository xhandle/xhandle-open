import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {webcrypto} from 'crypto';
import {serialize,deserialize} from 'v8';
import {saveCodeArchitectureHazardRun,getCodeArchitectureHazardRunById,getLatestCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {runCodeArchitectureHazardAnalysis} from './codeArchitectureHazardRunner';
import {generateFastHazards} from './resultsFirstHazardPipeline';
jest.mock('./resultsFirstHazardPipeline',()=>({...jest.requireActual('./resultsFirstHazardPipeline'),generateFastHazards:jest.fn()}));
jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn(()=>{throw Error('Unexpected AI call');})}));
jest.mock('./codeHazardGenerationCheckpoint',()=>({createCodeHazardCheckpoint:jest.fn()}));
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));Object.defineProperty(global,'crypto',{value:webcrypto,configurable:true});localStorage.clear();});
test.each([false,true])('interrupted continuation saves validated partial results (explicit Stop: %s)',async stop=>{
 const controller=new AbortController();
 const original={id:`previous-${stop}`,hazardMethod:'STPA-Textbook',projectId:'project-A',repoId:'repo-A',runState:'complete',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['HA-1','published']]},architectureRowsSnapshot:['evidence '.repeat(20000)]};
 await saveCodeArchitectureHazardRun(original);
 const previousRun=await getLatestCodeArchitectureHazardRun({projectId:'project-A'},{workingSet:true,paged:true});
 expect(previousRun.__xhandlePagedHazard).toBeDefined();
 generateFastHazards.mockImplementationOnce(async()=>{if(stop)controller.abort();throw Object.assign(Error('Interrupted with validated results'),{partialResults:[require('./fastHazardTestFixtures').answer('STPA','HA-1')],failedAssessments:['HA-1']});});
 let failure;
 try {await runCodeArchitectureHazardAnalysis({signal:controller.signal,previousRun,projectId:'project-A',repoMeta:{repoId:'repo-A'},cbaRows:[{from:'Planner',action:'Apply torque',to:'Actuator',traceId:'functional-1',rowRef:1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}]});}catch(error){failure=error;}
 if(!failure?.recoveryRun)throw failure || Error('No failure');
 expect(failure?.recoveryRun?.finalSavePending).not.toBe(true);
 expect(failure?.recoveryRun?.saveFailureMessage || '').toBe('');
 expect(failure.recoveryRun.pendingAttempt.validatedAssessments).toBe(1);
 // Inspect durable storage directly, independently of the in-memory recovery.
 const {openCodeArchitectureHazardDB}=require('./codeArchitectureHazardStore');
 const {hydrateHazardRun}=require('./hazardRunChunks');
 const db=await openCodeArchitectureHazardDB();
 try {const saved=await hydrateHazardRun(db,await db.get('hazardAnalysisRuns',original.id));
  expect(saved.pendingAttempt.validatedAssessments).toBe(1);
  expect(saved.pendingAttempt.failureMessage).toContain('Interrupted with validated results');
 }finally{db.close();}
});

test.each(['repeat','reorder','delete','external','project-change'])('Review Center subsequent edit: %s',async scenario=>{
 const fs=require('fs'),path=require('path');
 const source=fs.readFileSync(path.resolve(__dirname,'../../App.js'),'utf8');
 const ast=require('@babel/parser').parse(source,{sourceType:'module',plugins:['jsx']});
 const pending=[ast];let body;
 while(pending.length){const node=pending.pop();if(!node||typeof node!=='object')continue;
  if(node.type==='VariableDeclarator'&&node.id?.name==='updateHandler'&&source.slice(node.init.start,node.init.end).includes('shouldApplyReviewedRow'))body=source.slice(node.init.start,node.init.end);
  for(const value of Object.values(node))if(Array.isArray(value))pending.push(...value);else if(value&&typeof value==='object')pending.push(value);
 }
 const original={id:'reviewed',projectId:'review-project',repoId:'r',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['HA-1','original']]}};
 await saveCodeArchitectureHazardRun(original);
 const ref={current:await getCodeArchitectureHazardRunById(original.id)};
 const {resolveCodeArchitectureHazardRun}=require('./codeArchitectureHazardStore');
 const {createHazardReviewRowIndex}=require('./hazardReviewRowIndex');
 let notify;const notifications=[];
 const alert=jest.spyOn(window,'alert').mockImplementation(message=>{notifications.push(message);notify();});
 const deps={CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE:'functional',CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE:'hazard',handleOpenCodeArchitectureHazardSummaryRow:jest.fn(),codeArchitectureHazardRunRef:ref,activeCodeArchitectureProjectIdRef:{current:'review-project'},getCodeArchitectureHazardRunById,resolveCodeArchitectureHazardRun,saveCodeArchitectureHazardRun,createHazardReviewRowIndex,setCodeArchitectureHazardRun:run=>{ref.current=run;notify();}};
 const handler=Function(...Object.keys(deps),`return (${body})`)(...Object.values(deps));
 let priorRow=['HA-1','original'];
 const edit=async value=>new Promise(resolve=>{notify=resolve;handler({detail:{action:'update_current_content',previousContent:{row:priorRow},reviewItem:{artifactType:'hazard',sourceRunId:'reviewed',originalContent:{rowIndex:0,row:['HA-1','original']},currentContent:{rowIndex:0,row:['HA-1',value]}}}});});
 try{
  await edit('first edit');priorRow=['HA-1','first edit'];
  if(scenario==='project-change')deps.activeCodeArchitectureProjectIdRef.current='other-project';
  if(!['repeat','project-change'].includes(scenario)){
   const current=await getCodeArchitectureHazardRunById('reviewed');
   const rows=scenario==='reorder'?[['HA-2','other'],priorRow]:scenario==='delete'?[]:[['HA-1','independent edit']];
   await saveCodeArchitectureHazardRun({...current,generatedSheets:{Summary:[current.generatedSheets.Summary[0],...rows]}});
   ref.current=await getCodeArchitectureHazardRunById('reviewed');
  }
  await edit('second edit');
  const stored=(await getCodeArchitectureHazardRunById('reviewed')).generatedSheets.Summary;
  if(['repeat','reorder'].includes(scenario)){
   expect(notifications).toEqual([]);expect(stored.find(row=>row[0]==='HA-1')).toEqual(['HA-1','second edit']);
   if(scenario==='reorder')expect(stored[1]).toEqual(['HA-2','other']);
  }else if(scenario==='project-change'){
   expect(notifications).toEqual(['The active hazard project changed. Reopen the review.']);
   expect(stored[1]).toEqual(['HA-1','first edit']);
  }else{
   expect(notifications).toEqual(['The reviewed row no longer exists. Reload the review.']);
   expect(stored.find(row=>row[0]==='HA-1')).toEqual(scenario==='delete'?undefined:['HA-1','independent edit']);
  }
 }finally{alert.mockRestore();}
});

test.each(['edit','approval','failed-save'])('serializes overlapping provider actions: %s',async scenario=>{
 const fs=require('fs'),path=require('path');
 const source=fs.readFileSync(path.resolve(__dirname,'../../App.js'),'utf8');
 const ast=require('@babel/parser').parse(source,{sourceType:'module',plugins:['jsx']});
 const pending=[ast];let body;
 while(pending.length){const node=pending.pop();if(!node||typeof node!=='object')continue;
  if(node.type==='VariableDeclarator'&&node.id?.name==='updateHandler'&&source.slice(node.init.start,node.init.end).includes('shouldApplyReviewedRow'))body=source.slice(node.init.start,node.init.end);
  for(const value of Object.values(node))if(Array.isArray(value))pending.push(...value);else if(value&&typeof value==='object')pending.push(value);
 }
 const original={id:'reviewed',projectId:'review-project',repoId:'r',generatedSheets:{Summary:[['Raw Analysis Row ID','Hazard'],['HA-1','original']]}};
 await saveCodeArchitectureHazardRun(original);
 const ref={current:await getCodeArchitectureHazardRunById(original.id)};
 const {resolveCodeArchitectureHazardRun}=require('./codeArchitectureHazardStore');
 const {createHazardReviewRowIndex}=require('./hazardReviewRowIndex');
 let notify=()=>{};const notifications=[];
 let releaseSave, saveStarted;
 const gate=new Promise(resolve=>{releaseSave=resolve;});
 const started=new Promise(resolve=>{saveStarted=resolve;});
 let failOnce=scenario==='failed-save';
 const delayedSave=async run=>{saveStarted();await gate;if(failOnce){failOnce=false;throw Error('Storage unavailable');}return saveCodeArchitectureHazardRun(run);};
 const alert=jest.spyOn(window,'alert').mockImplementation(message=>{notifications.push(message);notify();});
 const deps={CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE:'functional',CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE:'hazard',handleOpenCodeArchitectureHazardSummaryRow:jest.fn(),codeArchitectureHazardRunRef:ref,activeCodeArchitectureProjectIdRef:{current:'review-project'},getCodeArchitectureHazardRunById,resolveCodeArchitectureHazardRun,saveCodeArchitectureHazardRun:delayedSave,createHazardReviewRowIndex,setCodeArchitectureHazardRun:run=>{ref.current=run;}};

 const {createReviewActionQueue,commitReviewSource,needsDurableReviewAction,saveDurableReviewAction}=require('../results-review/reviewSourceCommit');
 const provider=require('fs').readFileSync(require('path').resolve(__dirname,'../results-review/ResultsReviewProvider.js'),'utf8');
 const providerAst=require('@babel/parser').parse(provider,{sourceType:'module',plugins:['jsx']});
 const nodes=[providerAst];let updateBody,actionBody;
 while(nodes.length){const n=nodes.pop();if(!n||typeof n!=='object')continue;
  if(n.type==='VariableDeclarator'&&n.id?.name==='updateReviewItem')updateBody=provider.slice(n.init.arguments[0].start,n.init.arguments[0].end);
  if(n.type==='VariableDeclarator'&&n.id?.name==='applyAction')actionBody=provider.slice(n.init.arguments[0].start,n.init.arguments[0].end);
  for(const v of Object.values(n))if(Array.isArray(v))nodes.push(...v);else if(v&&typeof v==='object')nodes.push(v);
 }
 const reviewItemsRef={current:[{id:'review',artifactType:'code_architecture_hazard_summary_table',sourceRunId:'reviewed',originalContent:{rowIndex:0,row:['HA-1','original']},currentContent:{rowIndex:0,row:['HA-1','original']}}]};
 // Use the actual artifact type on both ends of the event bridge.
 deps.CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE='code_architecture_hazard_summary_table';
 const sourceHandler=Function(...Object.keys(deps),`return (${body})`)(...Object.values(deps));
 const providerDeps={createHistoryEntry:()=>({}),readOnly:false,reviewItemsRef,needsDurableReviewAction,saveDurableReviewAction,reviewActionQueue:createReviewActionQueue(),commitReviewSource,getReviewItemById:()=>reviewItemsRef.current[0],persist:async fn=>{reviewItemsRef.current=fn(reviewItemsRef.current);},dispatchReviewEvent:(type,detail)=>window.dispatchEvent(new CustomEvent(type,{detail}))};
 const update=Function(...Object.keys(providerDeps),`return (${updateBody})`)(...Object.values(providerDeps));
 const applyAction=Function(...Object.keys(providerDeps),`return (${actionBody})`)(...Object.values(providerDeps));
 window.addEventListener('xhandle:results-review:apply-source',sourceHandler);
 window.addEventListener('xhandle:results-review:item-updated',sourceHandler);
 try {
  const first=update('review',{currentContent:{rowIndex:0,row:['HA-1','first edit']}},'update_current_content');
  await started;
  const updates={currentContent:{rowIndex:0,row:['HA-1','second edit']}};
  const second=scenario==='approval'?applyAction('review','approve_with_modifications',updates):update('review',updates,'update_current_content');
  await Promise.resolve();
  expect(reviewItemsRef.current[0].currentContent.row[1]).toBe('original');
  const settled=Promise.allSettled([first,second]);
  releaseSave();const outcomes=await settled;
  expect(outcomes[0].status).toBe(scenario==='failed-save'?'rejected':'fulfilled');
  expect(outcomes[1].status).toBe('fulfilled');
  expect(notifications).toEqual([]);
  expect((await getCodeArchitectureHazardRunById('reviewed')).generatedSheets.Summary[1]).toEqual(['HA-1','second edit']);
  expect(reviewItemsRef.current[0].currentContent.row[1]).toBe('second edit');
  expect(reviewItemsRef.current[0].originalContent.row[1]).toBe('original');
 }finally{
  releaseSave();alert.mockRestore();
  window.removeEventListener('xhandle:results-review:apply-source',sourceHandler);
  window.removeEventListener('xhandle:results-review:item-updated',sourceHandler);
 }
});
