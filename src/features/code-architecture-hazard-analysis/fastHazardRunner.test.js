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
 expect(saveCodeArchitectureHazardRun).toHaveBeenCalledWith(run);
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

test('incomplete recovery survives storage reload and cannot derive software requirements',async()=>{
 const actual=jest.requireActual('./codeArchitectureHazardStore');
 saveCodeArchitectureHazardRun.mockImplementation(actual.saveCodeArchitectureHazardRun);
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>id==='HA-1'?{id}:answer('STPA',id))));
 let error;try{await runCodeArchitectureHazardAnalysis(base);}catch(e){error=e;}
 expect(error.recoveryRun).toMatchObject({runState:'incomplete',validatedAssessments:6,totalAssessments:7});
 const reloaded=normalizeCodeArchitectureHazardRun(await actual.getCodeArchitectureHazardRunById(error.recoveryRun.id));
 expect(reloaded.generatedSheets.Summary).toHaveLength(7);
 expect(reloaded.failedAssessments[0].id).toBe('HA-1');
 expect(()=>importHazardSoftwareRequirements({hazardAnalysis:reloaded})).toThrow('Complete and save');
 localStorage.removeItem('xhandle:code-architecture-hazard-analysis:v1');
});

test('a failed replacement is stored separately from the previous complete Summary',async()=>{
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
 const previous=await runCodeArchitectureHazardAnalysis(base);
 fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>id==='HA-1'?{id}:answer('STPA',id))));
 let error;try{await runCodeArchitectureHazardAnalysis({...base,previousRun:previous,regenerate:true});}catch(e){error=e;}
 expect(error.recoveryRun.generatedSheets).toEqual(previous.generatedSheets);
 expect(error.recoveryRun.runState).toBe('complete');
 expect(error.recoveryRun.pendingAttempt).toMatchObject({runState:'incomplete',validatedAssessments:6});
 expect(normalizeCodeArchitectureHazardRun(error.recoveryRun).pendingAttempt).toBeDefined();
});

test('Continue on a reloaded incomplete run requests only its unresolved assessment',async()=>{
 const {createCodeHazardCheckpoint}=jest.requireMock('./codeHazardGenerationCheckpoint');
 const cached=new Map();
 createCodeHazardCheckpoint.mockResolvedValue({read:async key=>cached.get(JSON.stringify(key)),write:async(key,value)=>cached.set(JSON.stringify(key),value)});
 try {
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>id==='HA-1'?{id}:answer('STPA',id))));
  let error;try{await runCodeArchitectureHazardAnalysis(base);}catch(e){error=e;}
  const reloaded=normalizeCodeArchitectureHazardRun(JSON.parse(JSON.stringify(error.recoveryRun)));
  fetchLLMResponse.mockClear();
  fetchLLMResponse.mockImplementation(async prompt=>JSON.stringify(JSON.parse(prompt.split('\nRows: ')[1]).map(({id})=>answer('STPA',id))));
  const run=await runCodeArchitectureHazardAnalysis({...base,previousRun:reloaded});
  expect(run.runState).toBe('complete');
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchLLMResponse.mock.calls[0][0].split('\nRows: ')[1]).map(row=>row.id)).toEqual(['HA-1']);
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
