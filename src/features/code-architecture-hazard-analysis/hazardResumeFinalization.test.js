import {runFastCodeArchitectureHazardAnalysis,fastHazardSheets} from './fastHazardRunner';
import {buildCodeArchitectureHazardInput,summarySheetToHazardSummaryRows} from './codeArchitectureHazardUtils';
import {saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {generateFastHazards} from './fastHazardPipeline';
import {answer} from './fastHazardTestFixtures';
jest.mock('./fastHazardPipeline',()=>({...jest.requireActual('./fastHazardPipeline'),generateFastHazards:jest.fn()}));
jest.mock('./codeArchitectureHazardStore',()=>({saveCodeArchitectureHazardRun:jest.fn(async()=>{})}));
const base={projectId:'p',repoMeta:{repoId:'r'},cbaRows:Array.from({length:160},(_,i)=>({from:'Planner',action:'Apply torque',to:'Actuator',traceId:`f-${i}`,fromNodeId:`from-${i}`,toNodeId:`to-${i}`,edgeId:`edge-${i}`,rowRef:i+1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}))};
beforeEach(()=>{jest.clearAllMocks();generateFastHazards.mockImplementation(async({sources})=>sources.map(s=>answer('STPA',s.id)));});
test('batched finalization retains identical sheets, summary identities and packed review order',async()=>{
 const progress=jest.fn();const run=await runFastCodeArchitectureHazardAnalysis({...base,setProgress:progress});
 const input=buildCodeArchitectureHazardInput({...base,method:'STPA-Textbook'});
 const assessments=input.tableRows.map((_,i)=>answer('STPA',`HA-${i+1}`));
 expect(run.generatedSheets).toEqual(fastHazardSheets('STPA',input,assessments));
 expect(run.summaryRows).toEqual(summarySheetToHazardSummaryRows(run.generatedSheets.Summary));
 expect(run.narrativeReviewInput.assessments.map(e=>e.source.id)).toEqual(assessments.map(a=>a.id));
 expect(progress.mock.calls.filter(([p])=>p.message.startsWith('Preparing traceable hazard results:')).length).toBeGreaterThan(1);
});
test('stop delivered by a task during finalization prevents completed publication and save',async()=>{
 const controller=new AbortController(),onPartialRunUpdate=jest.fn();let scheduled=false;
 await expect(runFastCodeArchitectureHazardAnalysis({...base,signal:controller.signal,onPartialRunUpdate,setProgress:p=>{
  if(!scheduled && p.message.startsWith('Preparing traceable hazard results:')){scheduled=true;setTimeout(()=>controller.abort(),0);}
 }})).rejects.toMatchObject({name:'AbortError'});
 expect(onPartialRunUpdate).not.toHaveBeenCalled();
 expect(saveCodeArchitectureHazardRun.mock.calls.every(([run])=>run.runState==='incomplete')).toBe(true);
});

test('cancellation during generation retains incomplete validated partial results',async()=>{
 const controller=new AbortController(),onPartialRunUpdate=jest.fn();
 generateFastHazards.mockImplementation(async({sources})=>{
  controller.abort();
  throw Object.assign(new Error('Stopped'),{name:'AbortError',partialResults:sources.slice(0,3).map(s=>answer('STPA',s.id)),failedAssessments:[]});
 });
 await expect(runFastCodeArchitectureHazardAnalysis({...base,signal:controller.signal,onPartialRunUpdate})).rejects.toMatchObject({name:'AbortError',recoveryRun:{runState:'incomplete',validatedAssessments:3}});
 expect(saveCodeArchitectureHazardRun.mock.calls.at(-1)[0]).toMatchObject({runState:'incomplete',validatedAssessments:3});
 expect(onPartialRunUpdate.mock.calls.at(-1)[0].summaryRows).toHaveLength(3);
});

test.each([false,true])('Stop during partial recovery preserves original error and results (save failure: %s)',async saveFails=>{
 const controller=new AbortController(),onPartialRunUpdate=jest.fn();let original;
 saveCodeArchitectureHazardRun.mockImplementation(async()=>{if(saveFails)throw new Error('Storage unavailable');});
 generateFastHazards.mockImplementation(async({sources})=>{
  original=Object.assign(new Error('Provider disconnected; checkpoint unavailable'),{partialResults:sources.slice(0,150).map(s=>answer('STPA',s.id)),failedAssessments:[]});
  throw original;
 });
 let caught;
 try{await runFastCodeArchitectureHazardAnalysis({...base,signal:controller.signal,onPartialRunUpdate,setProgress:p=>{
  if(p.message.startsWith('Preparing traceable hazard results:'))setTimeout(()=>controller.abort(),0);
 }});}catch(error){caught=error;}
 expect(controller.signal.aborted).toBe(true);
 expect(caught).toBe(original);
 expect(caught.partialResults).toHaveLength(150);
 expect(caught.recoveryRun).toMatchObject({runState:'incomplete',validatedAssessments:150});
 expect(caught.recoveryRun.summaryRows).toHaveLength(150);
 expect(onPartialRunUpdate).toHaveBeenCalledWith(caught.recoveryRun);
 expect(saveCodeArchitectureHazardRun.mock.calls.at(-1)[0]).toBe(caught.recoveryRun);
 if(saveFails)expect(caught.recoveryRun.finalSavePending).toBe(true);
 saveCodeArchitectureHazardRun.mockResolvedValue(undefined);
});

test('Stop during partial recovery preserves the prior completed run and scopes recovery to its original project',async()=>{
 const previousRun={id:'previous',projectId:'p',repoId:'r',hazardMethod:'STPA-Textbook',runState:'complete',generatedSheets:{Summary:[['existing'],['retained']]}};
 const controller=new AbortController();let activeProject='p';const visible=jest.fn();
 generateFastHazards.mockImplementation(async({sources})=>{throw Object.assign(new Error('Disconnected'),{partialResults:sources.slice(0,150).map(s=>answer('STPA',s.id))});});
 let caught;
 try{await runFastCodeArchitectureHazardAnalysis({...base,previousRun,signal:controller.signal,onPartialRunUpdate:run=>{if(activeProject===run.projectId)visible(run);},setProgress:p=>{
  if(p.message.startsWith('Preparing traceable hazard results:'))setTimeout(()=>{activeProject='other';controller.abort();},0);
 }});}catch(error){caught=error;}
 expect(caught.recoveryRun.id).toBe('previous');
 expect(caught.recoveryRun.generatedSheets).toEqual(previousRun.generatedSheets);
 expect(caught.recoveryRun.pendingAttempt).toMatchObject({projectId:'p',runState:'incomplete',validatedAssessments:150});
 expect(visible).not.toHaveBeenCalled();
});
