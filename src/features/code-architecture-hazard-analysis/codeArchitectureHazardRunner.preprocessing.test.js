jest.mock('../../components/aiAnalysisLite', () => ({ runLiteAIAnalysis: jest.fn() }));
jest.mock('./codeArchitectureHazardStore', () => ({ saveCodeArchitectureHazardRun: jest.fn(async run => run) }));
jest.mock('./codeArchitectureHazardSourceAudit', () => ({ enrichHazardTableRowsWithSourceContent: jest.fn(async rows => rows) }));
import { runLiteAIAnalysis } from '../../components/aiAnalysisLite';
import { runCodeArchitectureHazardAnalysis } from './codeArchitectureHazardRunner';
import { buildCodeArchitectureHazardCsvDraft } from './codeArchitectureHazardCsv';
import { recordUserPreprocessing } from '../project-hazard-analysis/hazardUserPreprocessing';

const headers=['Function (From)','Control Action','Function (To)','Guide Phrase','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Raw Analysis Row ID','Guide Phrase Applicable','Guide Phrase Applicability Rationale','Hazard','Classification Resolution Status'];
const options={method:'STPA-Textbook',projectId:'p1',repoMeta:{repoId:'repo'},cbaRows:[{from:'Estimate Pose',action:'Publish pose estimate',to:'Plan Motion',traceId:'trace1',fromNodeId:'from1',toNodeId:'to1',edgeId:'edge1',hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}]};
beforeEach(()=>{
 jest.clearAllMocks();
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
