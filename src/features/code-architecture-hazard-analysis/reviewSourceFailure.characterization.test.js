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
test.each(['source','review-final','conflict','approval'])('recovers durable review operation after %s failure and reopening',async scenario=>{
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
 const publication=jest.spyOn(require('./hazardRunChunks'),'publishHazardRun');
 if(scenario==='source')publication.mockRejectedValueOnce(Error('Storage unavailable'));
 const alert=jest.spyOn(window,'alert').mockImplementation(message=>{notifications.push(message);notify();});
 const deps={CODE_ARCHITECTURE_FUNCTIONAL_ARTIFACT_TYPE:'functional',CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE:'hazard',handleOpenCodeArchitectureHazardSummaryRow:jest.fn(),codeArchitectureHazardRunRef:ref,activeCodeArchitectureProjectIdRef:{current:'review-project'},getCodeArchitectureHazardRunById,resolveCodeArchitectureHazardRun,saveCodeArchitectureHazardRun,createHazardReviewRowIndex,setCodeArchitectureHazardRun:run=>{ref.current=run;}};

 const {createReviewActionQueue,commitReviewSource,needsDurableReviewAction,saveDurableReviewAction}=require('../results-review/reviewSourceCommit');
 const provider=require('fs').readFileSync(require('path').resolve(__dirname,'../results-review/ResultsReviewProvider.js'),'utf8');
 const providerAst=require('@babel/parser').parse(provider,{sourceType:'module',plugins:['jsx']});
 const nodes=[providerAst];let updateBody,actionBody,persistBody;
 while(nodes.length){const n=nodes.pop();if(!n||typeof n!=='object')continue;
  if(n.type==='VariableDeclarator'&&n.id?.name==='updateReviewItem')updateBody=provider.slice(n.init.arguments[0].start,n.init.arguments[0].end);
  if(n.type==='VariableDeclarator'&&n.id?.name==='persist')persistBody=provider.slice(n.init.arguments[0].start,n.init.arguments[0].end);
  if(n.type==='VariableDeclarator'&&n.id?.name==='applyAction')actionBody=provider.slice(n.init.arguments[0].start,n.init.arguments[0].end);
  for(const v of Object.values(n))if(Array.isArray(v))nodes.push(...v);else if(v&&typeof v==='object')nodes.push(v);
 }
 const reviewItemsRef={current:[{id:'review',artifactType:'code_architecture_hazard_summary_table',sourceRunId:'reviewed',originalContent:{rowIndex:0,row:['HA-1','original']},currentContent:{rowIndex:0,row:['HA-1','original']}}]};
 // Use the actual artifact type on both ends of the event bridge.
 deps.CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE='code_architecture_hazard_summary_table';
 const sourceHandler=Function(...Object.keys(deps),`return (${body})`)(...Object.values(deps));
 const {saveReviewItems,loadReviewItems}=require('../results-review/reviewStore');
 await saveReviewItems(reviewItemsRef.current);
 let writes=0;
 const persistDeps={readOnly:false,reviewItemsRef,setReviewItems:()=>{},setPersistenceFailure:()=>{},persistenceWriterRef:{current:async items=>{
  if(++writes===2 && scenario!=='source')return {ok:false,message:'Review storage unavailable'};
  return saveReviewItems(items);
 }}};
 const durablePersist=Function(...Object.keys(persistDeps),`return (${persistBody})`)(...Object.values(persistDeps));
 const providerDeps={createHistoryEntry:()=>({}),readOnly:false,reviewItemsRef,needsDurableReviewAction,saveDurableReviewAction,reviewActionQueue:createReviewActionQueue(),commitReviewSource,getReviewItemById:()=>reviewItemsRef.current[0],persist:durablePersist,dispatchReviewEvent:(type,detail)=>window.dispatchEvent(new CustomEvent(type,{detail}))};
 const update=Function(...Object.keys(providerDeps),`return (${updateBody})`)(...Object.values(providerDeps));
 const applyAction=Function(...Object.keys(providerDeps),`return (${actionBody})`)(...Object.values(providerDeps));
 window.addEventListener('xhandle:results-review:apply-source',sourceHandler);
 window.addEventListener('xhandle:results-review:item-updated',sourceHandler);
 try {
  const updates={currentContent:{rowIndex:0,row:['HA-1','first edit']}};
  const attempt=scenario==='approval'?applyAction('review','approve_with_modifications',{...updates,status:'approved_with_modifications'}):update('review',updates,'update_current_content');
  await expect(attempt).rejects.toThrow('unavailable');
  ref.current=await getCodeArchitectureHazardRunById('reviewed');
  reviewItemsRef.current=await loadReviewItems();
  expect(reviewItemsRef.current[0].currentContent.row[1]).toBe('original');
  expect(reviewItemsRef.current[0].pendingSourceCommit).toBeTruthy();
  if(scenario==='conflict'){
   const external=await getCodeArchitectureHazardRunById('reviewed',{committedOnly:true});
   await saveCodeArchitectureHazardRun({...external,generatedSheets:{Summary:[external.generatedSheets.Summary[0],['HA-1','external edit']]}});
   ref.current=await getCodeArchitectureHazardRunById('reviewed');
   await expect(update('review',updates,'update_current_content')).rejects.toThrow('committed review row changed');
  }else{
   await expect(update('review',{},'resume_pending')).resolves.toMatchObject({pendingSourceCommit:null});
   if(scenario==='approval'){
    expect((await loadReviewItems())[0]).toMatchObject({version:2,status:'approved_with_modifications'});
    expect((await loadReviewItems())[0].history).toHaveLength(1);
   }
   expect((await loadReviewItems())[0].currentContent.row[1]).toBe('first edit');
   expect(publication).toHaveBeenCalledTimes(scenario==='source'?2:1);
  }
  const {openCodeArchitectureHazardDB}=require('./codeArchitectureHazardStore');
  const {hydrateHazardRun}=require('./hazardRunChunks');
  const db=await openCodeArchitectureHazardDB();
  try {expect((await hydrateHazardRun(db,await db.get('hazardAnalysisRuns','reviewed'))).generatedSheets.Summary[1][1]).toBe(scenario==='conflict'?'external edit':'first edit');}finally{db.close();}
 }finally{
  publication.mockRestore();alert.mockRestore();
  window.removeEventListener('xhandle:results-review:apply-source',sourceHandler);
  window.removeEventListener('xhandle:results-review:item-updated',sourceHandler);
 }
});
