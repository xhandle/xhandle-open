// These tests isolate detailed assessment/recovery; the real prepass is covered in fastHazardApplicability.test.js.
jest.mock('./fastHazardApplicability',()=>({screenFastApplicability:async({sources})=>new Map(sources.map(s=>[s.id,{applicable:s.reviewedApplicability || 'Yes',rationale:s.reviewedRationale || 'Meaningful action deviation.'}]))}));
jest.mock('./fastHazardSemanticReview',()=>({...jest.requireActual('./fastHazardSemanticReview'),createReviewBatchPolicy:()=>({rows:24,chars:60000,successes:0,epoch:0}),reviewFastHazards:async ({entries})=>Object.fromEntries(entries.map(({source})=>[source.id,[]]))}));
jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
jest.mock('./codeHazardGenerationCheckpoint',()=>({createCodeHazardCheckpoint:jest.fn()}));
jest.mock('./codeArchitectureHazardStore',()=>({saveCodeArchitectureHazardRun:jest.fn()}));
jest.mock('../../components/aiAnalysisLite',()=>({runLiteAIAnalysis:jest.fn()}));
import {fetchLLMResponse} from '../../components/aiAnalysisSTPA';
import {runLiteAIAnalysis} from '../../components/aiAnalysisLite';
import {saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {runCodeArchitectureHazardAnalysis} from './codeArchitectureHazardRunner';
import {normalizeCodeArchitectureHazardRun} from './codeArchitectureHazardUtils';
import {importHazardSoftwareRequirements} from '../code-architecture-assurance/artifactAI';
import {FAST_HAZARD_COLUMNS,FAST_HAZARD_VERSION} from './fastHazardSchema';
import {answer} from './fastHazardTestFixtures';
import {toCsvText,parseCsv} from '../../lib/csv';
import {planHazardAnalysisCsvImport} from '../project-hazard-analysis/hazardAnalysisCsv';
import {recordUserPreprocessing} from '../project-hazard-analysis/hazardUserPreprocessing';
import {restoreFunctionalCsvSnapshot} from '../code-architecture-context/functionalModel';

const base={projectId:'project-A',repoMeta:{repoId:'repo-A'},cbaRows:[{from:'Planner',action:'Apply torque',to:'Actuator',traceId:'functional-1',rowRef:1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}],organizationContext:'Org requires fault injection for torque limits.',operationalContexts:[{id:'drive',scenario:'Urban driving',mode:'Automatic',conditions:'Wet road'}]};
beforeEach(()=>{jest.clearAllMocks();saveCodeArchitectureHazardRun.mockResolvedValue(undefined);});
test.each(['STPA-Textbook','HARA','FHA'])('%s default dispatch uses new pipeline and supplies traceable software requirements',async method=>{
 const short=method==='STPA-Textbook'?'STPA':method;
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer(short,id))));
 const progress=jest.fn();const run=await runCodeArchitectureHazardAnalysis({...base,method,setProgress:progress});
 expect(runLiteAIAnalysis).not.toHaveBeenCalled();expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
 expect(run.pipelineVersion).toBe(FAST_HAZARD_VERSION);expect(run.runState).toBe('complete');
 expect(run.generatedSheets.Summary).toHaveLength(8);
 expect(run.generatedSheets.Summary[0].slice(0,FAST_HAZARD_COLUMNS[short].length)).toEqual(FAST_HAZARD_COLUMNS[short]);
 const reloaded=normalizeCodeArchitectureHazardRun(JSON.parse(JSON.stringify(run)));
 expect(reloaded.pipelineVersion).toBe(FAST_HAZARD_VERSION);
 expect(importHazardSoftwareRequirements({hazardAnalysis:reloaded})).toEqual(expect.arrayContaining([expect.objectContaining({source:'hazard-derived',sourceTraceId:'functional-1',hazardAnalysisRunId:run.id})]));
 if(short==='STPA')expect(importHazardSoftwareRequirements({hazardAnalysis:reloaded})[0].mitigationStrategy).toBe(answer('STPA','HA-1').safetyConstraint);
 expect(saveCodeArchitectureHazardRun).toHaveBeenCalledWith(run,expect.objectContaining({onSaveState:expect.any(Function)}));
 expect(progress.mock.calls.at(-1)[0]).toMatchObject({step:100,total:100});
 expect(run.organizationProfileProvenance.effectiveEnabled).toBe(true);
 expect(parseCsv(toCsvText(run.generatedSheets.Summary))).toEqual(run.generatedSheets.Summary.map(row=>row.map(String)));
 expect(planHazardAnalysisCsvImport(run.generatedSheets.Summary,toCsvText(run.generatedSheets.Summary)).changedRowCount).toBe(0);
});

test('Functional input, imported No and accepted rationale survive regeneration and actual storage reload',async()=>{
 const actual=jest.requireActual('./codeArchitectureHazardStore');
 saveCodeArchitectureHazardRun.mockImplementation(actual.saveCodeArchitectureHazardRun);
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const cbaRows=restoreFunctionalCsvSnapshot([{...base.cbaRows[0],functionalCsvSnapshot:{version:1,kind:'control',sourceTraceIds:['raw-1']}}]);
 const first=await runCodeArchitectureHazardAnalysis({...base,cbaRows});
 expect(first.analysisAbstraction).toBe('functional');
 const headers=first.generatedSheets.Summary[0],row=first.generatedSheets.Summary[1],prior=[...row];
 row[headers.indexOf('Guide Phrase Applicable')]='No';
 row[headers.indexOf('Guide Phrase Applicability Rationale')]='Accepted human exclusion.';
 const id=row[headers.indexOf('Raw Analysis Row ID')];
 first.userPreprocessing={[id]:recordUserPreprocessing(null,headers,row,['Guide Phrase Applicable','Guide Phrase Applicability Rationale'],prior)};
 fetchLLMResponse.mockClear();
 const next=await runCodeArchitectureHazardAnalysis({...base,cbaRows,previousRun:first,regenerate:true});
 expect(fetchLLMResponse.mock.calls.flatMap(([p])=>JSON.parse(p.split('\nRows: ')[1]))).toHaveLength(6);
 const stored=await actual.getCodeArchitectureHazardRunById(next.id);
 expect(stored.pipelineVersion).toBe(FAST_HAZARD_VERSION);
 expect(stored.generatedSheets.Summary[1][headers.indexOf('Guide Phrase Applicable')]).toBe('No');
 expect(stored.generatedSheets.Summary[1][headers.indexOf('Guide Phrase Applicability Rationale')]).toBe('Accepted human exclusion.');
 expect(stored.userPreprocessing[id]).toBeDefined();
 localStorage.removeItem('xhandle:code-architecture-hazard-analysis:v1');
});
test('save failure publishes complete unsaved results with truthful completion',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 saveCodeArchitectureHazardRun.mockRejectedValue(new Error('Storage failed'));
 const progress=jest.fn();
 await expect(runCodeArchitectureHazardAnalysis({...base,setProgress:progress})).resolves.toMatchObject({runState:'complete',finalSavePending:true});
 expect(progress.mock.calls.at(-1)[0]).toMatchObject({step:100,message:expect.stringContaining('save pending')});
});

test.each(['STPA-Textbook','HARA','FHA'])('%s assumption-based completion survives storage, CSV and requirements derivation',async method=>{
 const actual=jest.requireActual('./codeArchitectureHazardStore');
 saveCodeArchitectureHazardRun.mockImplementation(actual.saveCodeArchitectureHazardRun);
 const short=method==='STPA-Textbook'?'STPA':method;
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>id==='HA-1'?{id}:answer(short,id))));
 const run=await runCodeArchitectureHazardAnalysis({...base,method});
 expect(run.runState).toBe('complete');
 const reloaded=normalizeCodeArchitectureHazardRun(await actual.getCodeArchitectureHazardRunById(run.id));
 const sheet=reloaded.generatedSheets.Summary;
 expect(sheet).toHaveLength(8);
 expect(sheet[1][sheet[0].indexOf('Assessment Basis')]).toContain('Assumption-based');
 expect(sheet[1][sheet[0].indexOf('Assumptions')]).toContain('premises');
 expect(parseCsv(toCsvText(sheet))).toEqual(sheet.map(row=>row.map(String)));
 expect(planHazardAnalysisCsvImport(sheet,toCsvText(sheet)).changedRowCount).toBe(0);
 expect(importHazardSoftwareRequirements({hazardAnalysis:reloaded})).toEqual(expect.arrayContaining([expect.objectContaining({source:'hazard-derived',sourceTraceId:'functional-1'})]));
 localStorage.removeItem('xhandle:code-architecture-hazard-analysis:v1');
});

test('a replacement completes with assumptions without modifying the prior run',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const previous=await runCodeArchitectureHazardAnalysis(base),snapshot=JSON.stringify(previous.generatedSheets);
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>id==='HA-1'?{id}:answer('STPA',id))));
 const next=await runCodeArchitectureHazardAnalysis({...base,previousRun:previous,regenerate:true});
 expect(next.runState).toBe('complete');
 expect(JSON.stringify(previous.generatedSheets)).toBe(snapshot);
 expect(next.generatedSheets.Summary[1][next.generatedSheets.Summary[0].indexOf('Assessment Basis')]).toContain('Assumption-based');
});

test('completed assumption-based rows are checkpointed without repeated provider calls',async()=>{
 const {createCodeHazardCheckpoint}=jest.requireMock('./codeHazardGenerationCheckpoint');
 const cached=new Map();
 createCodeHazardCheckpoint.mockResolvedValue({read:async key=>cached.get(JSON.stringify(key)),write:async(key,value)=>cached.set(JSON.stringify(key),value)});
 try {
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>id==='HA-1'?{id}:answer('STPA',id))));
  const run=await runCodeArchitectureHazardAnalysis(base);
  fetchLLMResponse.mockClear();
  const next=await runCodeArchitectureHazardAnalysis({...base,previousRun:normalizeCodeArchitectureHazardRun(JSON.parse(JSON.stringify(run)))});
  expect(next.runState).toBe('complete');
  expect(fetchLLMResponse).not.toHaveBeenCalled();
 } finally {createCodeHazardCheckpoint.mockReset();}
});

test('read-only native final-save error retains the complete in-memory result for recovery',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const native=Object.freeze(new DOMException('Native save failure','TransactionInactiveError'));
 saveCodeArchitectureHazardRun.mockRejectedValue(native);
 const onPartialRunUpdate=jest.fn();
 await expect(runCodeArchitectureHazardAnalysis({...base,onPartialRunUpdate})).resolves.toMatchObject({runState:'complete',finalSavePending:true,saveFailureMessage:'Native save failure'});
 expect(onPartialRunUpdate.mock.calls.at(-1)[0].generatedSheets.Summary).toHaveLength(8);
});

test('completion audit: invalid imported requirement is retained and does not block publication',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const previous=await runCodeArchitectureHazardAnalysis(base);
 const sheet=previous.generatedSheets.Summary,headers=sheet[0],row=sheet[1],prior=[...row];
 row[headers.indexOf('Software Safety Requirement')]='The software shall enforce the limit; needs review of the threshold.';
 const id=row[headers.indexOf('Raw Analysis Row ID')];
 previous.userPreprocessing={[id]:recordUserPreprocessing(null,headers,row,['Software Safety Requirement'],prior)};
 saveCodeArchitectureHazardRun.mockClear();
 const publish=jest.fn();
 const run=await runCodeArchitectureHazardAnalysis({...base,previousRun:previous,regenerate:true,onPartialRunUpdate:publish});
 expect(run.runState).toBe('complete');
 expect(run.retainedUserInputs[id]['Software Safety Requirement']).toContain('needs review');
 expect(run.generatedSheets.Summary[1][headers.indexOf('Software Safety Requirement')]).not.toContain('needs review');
 expect(publish).toHaveBeenCalled();
 expect(saveCodeArchitectureHazardRun).toHaveBeenCalled();
});

test('final reconciliation recovers one invalid imported row without dropping independent results',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const previous=await runCodeArchitectureHazardAnalysis(base);
 const sheet=previous.generatedSheets.Summary,headers=sheet[0],row=sheet[1],prior=[...row];
 row[headers.indexOf('Assessed Control Action')]='A different action';
 const id=row[headers.indexOf('Raw Analysis Row ID')];
 previous.userPreprocessing={[id]:recordUserPreprocessing(null,headers,row,['Assessed Control Action'],prior)};
 const run=await runCodeArchitectureHazardAnalysis({...base,previousRun:previous,regenerate:true});
 expect(run.runState).toBe('complete');
 expect(run.generatedSheets.Summary).toHaveLength(8);
 expect(run.generatedSheets.Summary[1][headers.indexOf('Assessed Control Action')]).toBe('Apply torque');
 expect(run.retainedUserInputs[id]['Assessed Control Action']).toBe('A different action');
 for(const header of ['Unsafe Control Action','Loss','Hazard','Safety Classification','Software Safety Requirement'])expect(run.generatedSheets.Summary[2][headers.indexOf(header)]).toEqual(sheet[2][headers.indexOf(header)]);
 expect(normalizeCodeArchitectureHazardRun(run).retainedUserInputs).toEqual(run.retainedUserInputs);
});
test('throwing UI observers cannot prevent final save and completion',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const fail=()=>{throw new Error('UI observer failed');};
 const run=await runCodeArchitectureHazardAnalysis({...base,setProgress:fail,onActivityUpdate:fail,onPartialRunUpdate:fail});
 expect(run.runState).toBe('complete');expect(saveCodeArchitectureHazardRun).toHaveBeenCalledWith(run,expect.objectContaining({onSaveState:expect.any(Function)}));
});

test.each(['HARA','FHA'])('%s normalizes saved ratings through fallback, final publication, reload and CSV',async method=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer(method,id))));
 const previous=await runCodeArchitectureHazardAnalysis({...base,method});
 const [headers,row]=previous.generatedSheets.Summary;
 const originals=method==='HARA'?{Severity:' S1 ',Exposure:' E2 ',Controllability:' C1 '}:{'Severity Category':' III ','Software Control Category':3};
 const id=row[headers.indexOf('Raw Analysis Row ID')];
 const owned=recordUserPreprocessing(null,headers,row,Object.keys(originals),row);
 previous.userPreprocessing={[id]:{...owned,values:{...owned.values,...originals}}};
 fetchLLMResponse.mockRejectedValue(new Error('Provider unavailable'));
 const run=await runCodeArchitectureHazardAnalysis({...base,method,previousRun:previous,regenerate:true});
 expect(run.runState).toBe('complete');expect(run.generatedSheets.Summary).toHaveLength(8);
 const [columns,...rows]=run.generatedSheets.Summary;
 const result=rows.find(value=>value[columns.indexOf('Raw Analysis Row ID')]===id);
 for(const [header,value] of Object.entries(originals)){
  expect(result[columns.indexOf(header)]).toBe(String(value).trim());
  expect(run.retainedUserInputs[id][header]).toBe(value);
  expect(run.userPreprocessing[id].values[header]).toBe(String(value).trim());
 }
 expect(result[columns.indexOf(method==='HARA'?'ASIL':'Software Criticality Index')]).toBe(method==='HARA'?'QM':'SwCI 4');
 expect(saveCodeArchitectureHazardRun).toHaveBeenLastCalledWith(run,expect.objectContaining({onSaveState:expect.any(Function)}));
 const reloaded=normalizeCodeArchitectureHazardRun(JSON.parse(JSON.stringify(run)));
 expect(reloaded.retainedUserInputs).toEqual(run.retainedUserInputs);
 expect(parseCsv(toCsvText(reloaded.generatedSheets.Summary))).toEqual(run.generatedSheets.Summary.map(row=>row.map(String)));
 expect(importHazardSoftwareRequirements({hazardAnalysis:reloaded}).length).toBeGreaterThan(0);
});

test('checkpoint recovery clears the displayed warning immediately but cannot mask final-save failure',async()=>{
 const pipeline=require('./resultsFirstHazardPipeline');
 const progress=jest.fn();let storageObserver;
 const generate=jest.spyOn(pipeline,'generateFastHazards').mockImplementationOnce(async options=>{
  storageObserver=options.onStorageState;
  options.onProgress({step:40,message:'Assessing rows'});
  options.onStorageState({unsaved:true,status:'failed',message:'Transient abort'});
  expect(progress.mock.calls.at(-1)[0].message).toContain('Progress could not be saved');
  options.onStorageState({unsaved:false,status:'saved'});
  expect(progress.mock.calls.at(-1)[0].message).toBe('Assessing rows');
  return options.sources.map(({id})=>answer('STPA',id));
 });
 saveCodeArchitectureHazardRun.mockRejectedValue(new Error('Final save failed'));
 try{
  const run=await runCodeArchitectureHazardAnalysis({...base,setProgress:progress});
  expect(run.finalSavePending).toBe(true);
  const last=progress.mock.calls.at(-1)[0];expect(last.message).toContain('save pending');
  storageObserver({unsaved:false,status:'saved'});
  expect(progress.mock.calls.at(-1)[0]).toBe(last);
 }finally{generate.mockRestore();}
});
test.each([false,true])('standalone runner retires checkpoint work on completion (final save fails: %s)',async fails=>{
 const pipeline=require('./resultsFirstHazardPipeline');let checkpointSignal;
 const generate=jest.spyOn(pipeline,'generateFastHazards').mockImplementationOnce(async options=>{
  checkpointSignal=options.checkpointSignal;
  expect(checkpointSignal.aborted).toBe(false);
  return options.sources.map(({id})=>answer('STPA',id));
 });
 if(fails)saveCodeArchitectureHazardRun.mockRejectedValue(new Error('Final save failed'));
 try{
  const run=await runCodeArchitectureHazardAnalysis(base);
  expect(checkpointSignal.aborted).toBe(true);expect(run.runState).toBe('complete');
  expect(Boolean(run.finalSavePending)).toBe(fails);
 }finally{generate.mockRestore();}
});
