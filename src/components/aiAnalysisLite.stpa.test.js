import { runLiteAIAnalysis } from './aiAnalysisLite';
import * as legacyStpa from './aiAnalysisSTPA';
import { generateStandardCodeHazardAnalysisSheets } from './aiAnalysisCodeHazardStandard';

jest.mock('./aiAnalysisCodeHazardStandard', () => ({
  generateStandardCodeHazardAnalysisSheets: jest.fn(async ({ sheets }) => sheets),
}));
jest.mock('./aiAnalysisSTPA', () => ({
  generateUnsafeControlActionsSheet: jest.fn(async ({ sheets }) => sheets),
  populateUCATimingColumnsWithLLM: jest.fn(async ({ sheets }) => sheets),
  generateCausalFactorsSheet: jest.fn(async ({ sheets }) => sheets),
  generateMitigationStrategiesSheet: jest.fn(async ({ sheets }) => sheets),
  generateSystemRequirementsSheet: jest.fn(async ({ sheets }) => sheets),
  generateBatchedRequirementsSheet: jest.fn(async ({ sheets }) => sheets),
  generateHazardMappingsSheet: jest.fn(async ({ sheets }) => sheets),
  generateLossMappingsSheet: jest.fn(async ({ sheets }) => sheets),
  generateSummarySheetFromMappings: jest.fn(async ({ sheets }) => ({ ...sheets, Summary: [['Hazard'], ['Synthetic hazard']] })),
}));

const options = hazardMethod => ({
  tableRows: [{ fromFunction: 'Controller', controlAction: 'Request stop', toFunction: 'Actuator' }],
  sheets: {}, currentFolder: 'Synthetic project', hazardMethod,
  setFolders: async update => update({}), setProgress: jest.fn(),
  setChatPrompt: jest.fn(), setChatResponse: jest.fn(),
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.values(legacyStpa).filter(jest.isMockFunction).forEach(generator => generator.mockImplementation(async ({ sheets }) => sheets));
  legacyStpa.generateSummarySheetFromMappings.mockImplementation(async ({ sheets }) => ({ ...sheets, Summary: [['Hazard'], ['Synthetic hazard']] }));
  generateStandardCodeHazardAnalysisSheets.mockImplementation(async ({ sheets }) => sheets);
});

test.each(['STPA-Textbook', 'STPA_TEXTBOOK', 'STPA_TEXTBOOK_APPROACH'])('%s uses the previous Projects generator', async method => {
  await runLiteAIAnalysis(options(method));
  expect(generateStandardCodeHazardAnalysisSheets).toHaveBeenCalledWith(expect.objectContaining({ method: 'STPA', completionPolicy: 'practical' }));
  expect(legacyStpa.generateUnsafeControlActionsSheet).not.toHaveBeenCalled();
});

test('plain STPA retains its original sequential assessment and summary workflow', async () => {
  const result = await runLiteAIAnalysis(options('STPA'));
  const calls = Object.values(legacyStpa).filter(jest.isMockFunction).map(generator => {
    expect(generator).toHaveBeenCalledTimes(1);
    return generator.mock.invocationCallOrder[0];
  });
  expect(calls).toEqual([...calls].sort((a, b) => a - b));
  expect(generateStandardCodeHazardAnalysisSheets).not.toHaveBeenCalled();
  expect(result.Summary).toEqual([['Hazard'], ['Synthetic hazard']]);
});

test('message-only updates still retain the generator progress percentage', async () => {
  generateStandardCodeHazardAnalysisSheets.mockImplementationOnce(async ({ sheets, onProgress }) => {
    onProgress({ step: 42, total: 100, completed: 5 });
    onProgress({ message: 'Continuing the assessment' });
    return sheets;
  });
  const request = options('STPA-Textbook');
  await runLiteAIAnalysis(request);
  expect(request.setProgress).toHaveBeenCalledWith(expect.objectContaining({
    message: 'Continuing the assessment', step: 42, total: 100, completed: 5,
  }));
});

test('the code architecture dispatcher retains its existing completion configuration', async () => {
  await runLiteAIAnalysis({ ...options('STPA-Textbook'), codeArchitectureWorkflow: true });
  expect(generateStandardCodeHazardAnalysisSheets).toHaveBeenCalledWith(expect.objectContaining({ method: 'STPA', completionPolicy: 'strict' }));
});
