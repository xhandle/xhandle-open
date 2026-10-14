jest.mock('./codeHazardApplicabilityScreening', () => ({screenCodeHazardApplicability: jest.fn(async input => ({...input, applicabilityScreening: {counts: {yes: 0, no: 0, unresolved: 0}}}))}));
jest.mock('./codeHazardGenerationCheckpoint', () => ({createCodeHazardCheckpoint: jest.fn(async () => null)}));
jest.mock('../../components/aiAnalysisLite', () => ({ runLiteAIAnalysis: jest.fn() }));
jest.mock('./codeArchitectureHazardStore', () => ({ saveCodeArchitectureHazardRun: jest.fn(async run => run) }));
jest.mock('./codeArchitectureHazardSourceAudit', () => ({ enrichHazardTableRowsWithSourceContent: jest.fn(async rows => rows) }));
import { screenCodeHazardApplicability } from './codeHazardApplicabilityScreening';
import { runLiteAIAnalysis } from '../../components/aiAnalysisLite';
import { runLegacyCodeArchitectureHazardAnalysis as runCodeArchitectureHazardAnalysis } from './codeArchitectureHazardRunner';
import { buildCodeArchitectureHazardCsvDraft } from './codeArchitectureHazardCsv';
import { recordUserPreprocessing } from '../project-hazard-analysis/hazardUserPreprocessing';

const headers=['Function (From)','Control Action','Function (To)','Guide Phrase','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Raw Analysis Row ID','Guide Phrase Applicable','Guide Phrase Applicability Rationale','Hazard','Classification Resolution Status'];
const options={method:'STPA-Textbook',projectId:'p1',repoMeta:{repoId:'repo'},cbaRows:[{from:'Estimate Pose',action:'Publish pose estimate',to:'Plan Motion',traceId:'trace1',fromNodeId:'from1',toNodeId:'to1',edgeId:'edge1',hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}]};
beforeEach(()=>{
 jest.clearAllMocks();
 screenCodeHazardApplicability.mockImplementation(async input => ({...input, applicabilityScreening: {counts: {yes: 0, no: 0, unresolved: 0}}}));
 runLiteAIAnalysis.mockImplementation(async ({tableRows})=>({Summary:[headers,...tableRows.map((row,index)=>[
 row.fromFunction,row.controlAction,row.toFunction,row.guidePhrase,row.operationalContextId,row.operationalScenario,row.operationalMode,row.operatingConditions,`AI-${index}`,'Yes','AI rationale','Completed hazard','Policy Validated',
 ])]}));
});
test('runner leaves ordinary generation inputs and assessment behavior unchanged',async()=>{
 const result=await runCodeArchitectureHazardAnalysis(options);
 const request=runLiteAIAnalysis.mock.calls[0][0];
 expect(request.tableRows).toHaveLength(7);
 expect(request.tableRows.every(row=>!row.userPreprocessing && row.guidePhraseApplicable==='')).toBe(true);
 expect(result.generatedSheets.Summary[1][8]).toBe('AI-0');
 expect(result.generatedSheets.Summary[1][9]).toBe('Yes');
 expect(result.userPreprocessing).toBeUndefined();
});
test('runner completes unassessed rows while preserving imported No and its ID',async()=>{
 const previous=buildCodeArchitectureHazardCsvDraft(options,headers);
 const baseline=[...previous.generatedSheets.Summary[1]];
 const row=previous.generatedSheets.Summary[1]; row[9]='No';row[10]='No maintained actuation for this transaction';
 previous.userPreprocessing={[row[8]]:recordUserPreprocessing(null,headers,row,[headers[9],headers[10]],baseline)};
 const result=await runCodeArchitectureHazardAnalysis({...options,previousRun:previous});
 expect(runLiteAIAnalysis.mock.calls[0][0].tableRows[0].guidePhraseApplicable).toBe('No');
 expect(result.generatedSheets.Summary[1][8]).toBe(row[8]);
 expect(result.generatedSheets.Summary[1][9]).toBe('No');
 expect(result.generatedSheets.Summary[1][10]).toBe(row[10]);
 expect(result.generatedSheets.Summary[1][11]).toBe('Not Applicable');
 expect(result.generatedSheets.Summary[2][9]).toBe('Yes');
 expect(result.userPreprocessingConflicts.length).toBeGreaterThan(0);
});

test('intermediate output never replaces the displayed preprocessed table', async () => {
 const previous=buildCodeArchitectureHazardCsvDraft(options,headers);
 const baseline=[...previous.generatedSheets.Summary[1]];
 const row=previous.generatedSheets.Summary[1]; row[9]='No';
 previous.userPreprocessing={[row[8]]:recordUserPreprocessing(null,headers,row,[headers[9]],baseline)};
 const generate = runLiteAIAnalysis.getMockImplementation();
 runLiteAIAnalysis.mockImplementation(async request => {
   await request.setFolders(() => ({ CodeBasedArchitecture: { Summary: [headers] } }));
   return generate(request);
 });
 const onPartialRunUpdate=jest.fn();
 const result=await runCodeArchitectureHazardAnalysis({...options, previousRun:previous, onPartialRunUpdate});
 expect(onPartialRunUpdate).not.toHaveBeenCalled();
 expect(previous.generatedSheets.Summary[1][9]).toBe('No');
 expect(result.generatedSheets.Summary[1][9]).toBe('No');
});

test('ordinary generation still publishes intermediate output', async () => {
 const generate = runLiteAIAnalysis.getMockImplementation();
 runLiteAIAnalysis.mockImplementation(async request => {
   await request.setFolders(() => ({ CodeBasedArchitecture: { Summary: [headers] } }));
   return generate(request);
 });
 const onPartialRunUpdate=jest.fn();
 await runCodeArchitectureHazardAnalysis({...options,onPartialRunUpdate});
 expect(onPartialRunUpdate).toHaveBeenCalledTimes(1);
});

test('late completion after cancellation does not save a hazard run', async () => {
 const { saveCodeArchitectureHazardRun } = require('./codeArchitectureHazardStore');
 const controller = new AbortController();
 const generate = runLiteAIAnalysis.getMockImplementation();
 runLiteAIAnalysis.mockImplementation(async request => {
   const sheets = await generate(request);
   controller.abort();
   return sheets;
 });
 await expect(runCodeArchitectureHazardAnalysis({...options, signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
 expect(saveCodeArchitectureHazardRun).not.toHaveBeenCalled();
});

test.each([
 { 'Functional Decomposition': [['Function (From)'], ['Estimate Pose']] },
 { Summary: [headers] },
 { Summary: [headers, ['Estimate Pose','Publish pose estimate','Plan Motion','Not provided','','','','','RAW-1','','','','']] },
])('blank or missing assessment output never saves a successful run', async sheets => {
 const { saveCodeArchitectureHazardRun } = require('./codeArchitectureHazardStore');
 runLiteAIAnalysis.mockResolvedValue(sheets);
 await expect(runCodeArchitectureHazardAnalysis(options)).rejects.toThrow('did not produce completed assessment rows');
 expect(saveCodeArchitectureHazardRun).not.toHaveBeenCalled();
});

test.each([
 ['HARA', 'Hazard'],
 ['FHA', 'Hazard'],
 ['HRWhatIf', 'What-If Scenario'],
 ['STPA-SEC', 'Unacceptable Security Condition'],
 ['FMEA', 'Failure Mode'],
])('completion guard accepts populated %s assessment columns', async (method, column) => {
 runLiteAIAnalysis.mockResolvedValue({Summary:[[column],['Assessed result']]});
 const result = await runCodeArchitectureHazardAnalysis({...options, method});
 expect(result.generatedSheets.Summary[1][0]).toBe('Assessed result');
});


test.each(['Yes', 'No'])('accepted %s survives a context change and a conflicting generated result', async decision => {
 const previous=buildCodeArchitectureHazardCsvDraft(options,headers);
 const baseline=[...previous.generatedSheets.Summary[1]];
 const row=previous.generatedSheets.Summary[1]; row[9]=decision; row[10]='Accepted user rationale';
 previous.userPreprocessing={[row[8]]:recordUserPreprocessing(null,headers,row,[headers[9],headers[10]],baseline)};
 previous.userPreprocessing[row[8]].basis['Operational Scenario']='Previously reviewed scenario';
 const generate=runLiteAIAnalysis.getMockImplementation();
 runLiteAIAnalysis.mockImplementation(async request=>{
   const result=await generate(request);result.Summary[1][9]='Needs Review';return result;
 });
 const result=await runCodeArchitectureHazardAnalysis({...options,previousRun:previous});
 const request=runLiteAIAnalysis.mock.calls[0][0];
 expect(request.tableRows[0].guidePhraseApplicable).toBe(decision);
 expect(request.tableRows[0].guidePhraseApplicabilityReviewStatus).toBe('Reviewed');
 expect(result.generatedSheets.Summary[1][9]).toBe(decision);
 expect(result.generatedSheets.Summary[1][10]).toBe('Accepted user rationale');
});

test.each(['HARA','FHA'])('switch to %s does not reinterpret or mutate STPA preprocessing',async method=>{
 const previous=buildCodeArchitectureHazardCsvDraft(options,headers);
 previous.hazardMethod='STPA-Textbook';
 const baseline=[...previous.generatedSheets.Summary[1]];
 const row=previous.generatedSheets.Summary[1];row[9]='No';
 previous.userPreprocessing={[row[8]]:recordUserPreprocessing(null,headers,row,[headers[9]],baseline)};
 const snapshot=JSON.stringify(previous);
 await runCodeArchitectureHazardAnalysis({...options,method,previousRun:previous});
 expect(runLiteAIAnalysis.mock.calls[0][0].codeArchitectureWorkflow).toBe(true);
 expect(runLiteAIAnalysis.mock.calls[0][0].tableRows).toHaveLength(7);
 expect(JSON.stringify(previous)).toBe(snapshot);
});

test('enabled profile reaches screening and recorded provenance includes disabled state',async()=>{
 const result=await runCodeArchitectureHazardAnalysis({...options,organizationContext:'ORG-RULE'});
 expect(screenCodeHazardApplicability).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({organizationContext:'ORG-RULE'}));
 expect(runLiteAIAnalysis.mock.calls[0][0].organizationContext).toBe('ORG-RULE');
 expect(result.organizationProfileProvenance.effectiveEnabled).toBe(true);
 const disabled=await runCodeArchitectureHazardAnalysis(options);
 expect(disabled.organizationProfileProvenance.effectiveEnabled).toBe(false);
 expect(disabled.organizationProfileProvenance.effectiveContextIdentity).not.toBe(result.organizationProfileProvenance.effectiveContextIdentity);
});
test.each(['HRWhatIf','STPA-SEC','STPA','unknown'])('profile-enabled legacy method %s cannot silently ignore policy',async method=>{
 await expect(runCodeArchitectureHazardAnalysis({...options,method,organizationContext:'ORG-RULE'})).rejects.toThrow('does not support organization profiles');
 expect(runLiteAIAnalysis).not.toHaveBeenCalled();
});

test.each(['HARA','FHA'])('%s migrates legacy decisions without blocking regeneration and retains history on continuation',async method=>{
 const previous=buildCodeArchitectureHazardCsvDraft({...options,method},headers);
 previous.id='legacy-run';previous.hazardMethod=method;
 const row=[...previous.generatedSheets.Summary[1]];row[3]=method==='HARA'?'Functional malfunction':'Functional degradation or loss';row[9]='No';
 previous.generatedSheets.Summary=[headers,row];
 previous.userPreprocessing={[row[8]]:recordUserPreprocessing(null,headers,row,[headers[9]],row)};
 const snapshot=JSON.stringify(previous);
 const result=await runCodeArchitectureHazardAnalysis({...options,method,previousRun:previous,regenerate:true});
 expect(runLiteAIAnalysis.mock.calls[0][0].tableRows).toHaveLength(7);
 expect(runLiteAIAnalysis.mock.calls[0][0].tableRows.every(row=>row.guidePhraseApplicable==='')).toBe(true);
 expect(result.archivedUserPreprocessing[row[8]].values['Guide Phrase Applicable']).toBe('No');
 expect(JSON.stringify(previous)).toBe(snapshot);
 const {normalizeCodeArchitectureHazardRun}=require('./codeArchitectureHazardUtils');
 const reloaded=normalizeCodeArchitectureHazardRun(result);
 const next=await runCodeArchitectureHazardAnalysis({...options,method,previousRun:reloaded});
 expect(next.archivedUserPreprocessing).toEqual(result.archivedUserPreprocessing);
});
