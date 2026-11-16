import {runLiteAIAnalysis} from './aiAnalysisLite';
import {generateProjectHaraAnalysisSheets} from './aiAnalysisProjectHara';
import {generateHaraAnalysisSheets,generateFhaAnalysisSheets} from './aiAnalysisHaraFha';
jest.mock('./aiAnalysisProjectHara', () => ({generateProjectHaraAnalysisSheets:jest.fn()}));
jest.mock('./aiAnalysisHaraFha', () => ({generateHaraAnalysisSheets:jest.fn(),generateFhaAnalysisSheets:jest.fn()}));

beforeEach(() => jest.clearAllMocks());
const input = () => ({tableRows:[{fromFunction:'Controller',controlAction:'Brake command',toFunction:'Actuator'}],sheets:{},setFolders:async update=>update({}),currentFolder:'Project',haraItemDefinition:'Vehicle braking item'});
test('Projects HARA dispatches to the shared STPA mechanics plus ISO assessment workflow', async () => {
  generateProjectHaraAnalysisSheets.mockResolvedValue({Summary:[['ASIL'],['ASIL D']]});
  const result=await runLiteAIAnalysis({...input(),hazardMethod:'HARA'});
  expect(generateProjectHaraAnalysisSheets).toHaveBeenCalledWith(expect.objectContaining({itemDefinition:'Vehicle braking item',tableRows:input().tableRows}));
  expect(generateHaraAnalysisSheets).not.toHaveBeenCalled();
  expect(result.Summary[1][0]).toBe('ASIL D');
});
test('CBA HARA keeps its established generator and saved FHA remains supported internally', async () => {
  generateHaraAnalysisSheets.mockResolvedValue({Summary:[['ASIL'],['QM']]});
  await runLiteAIAnalysis({...input(),hazardMethod:'HARA',codeArchitectureWorkflow:true});
  expect(generateHaraAnalysisSheets).toHaveBeenCalled(); expect(generateProjectHaraAnalysisSheets).not.toHaveBeenCalled();
  generateFhaAnalysisSheets.mockResolvedValue({Summary:[['Severity Category'],['II']]});
  await runLiteAIAnalysis({...input(),hazardMethod:'FHA',codeArchitectureWorkflow:true});
  expect(generateFhaAnalysisSheets).toHaveBeenCalled();
});
