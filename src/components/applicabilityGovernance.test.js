jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
import { fetchLLMResponse } from './aiAnalysisSTPA';
import { generateStandardCodeHazardAnalysisSheets, HAZARD_ANALYSIS_STAGE_KEYS } from './aiAnalysisCodeHazardStandard';
import { normalizeNeedsReviewClassificationDecision, applyGuidePhraseApplicabilityUpdates } from '../features/project-hazard-analysis/needsReviewResolver';
import { planHazardAnalysisCsvImport, applyHazardAnalysisCsvImport } from '../features/project-hazard-analysis/hazardAnalysisCsv';
import { toCsvText } from '../lib/csv';

beforeEach(() => jest.clearAllMocks());

test.each([['Yes', 'Reviewed', ''], ['No', 'Reviewed', ''], ['Yes', '', 'Automatic screening'], ['No', '', 'Automatic screening']])('%s with review=%s origin=%s survives the full standard STPA pipeline', async (decision, reviewStatus, origin) => {
  const rationale = `${decision} — accepted applicability assessment.`;
  const stages = [];
  // Deliberately hostile provider output: generation and later audit/repair
  // responses attempt to replace the accepted applicability decision.
  fetchLLMResponse.mockResolvedValue(JSON.stringify([{
    id: 'FD-1-STPA', guidePhraseApplicable: 'No',
    guidePhraseApplicabilityRationale: 'Model would reject applicability.',
    hazards: 'Loss of commanded motion', safetyClassification: 'Needs Review',
    safetySignificant: 'Needs Review', safetySignificanceRationale: 'Missing safety-path evidence.',
  }]));
  const sheets = await generateStandardCodeHazardAnalysisSheets({
    sheets: {'Functional Decomposition': [
      ['Function (From)','Control Action','Function (To)','Guide Phrase','Guide Phrase Applicable','Guide Phrase Applicability Rationale','Guide Phrase Applicability Review Status', 'Guide Phrase Applicability Origin'],
      ['Planner','Command motion','Executor','Too late',decision,rationale,reviewStatus,origin],
    ]},
    currentFolder: 'fixture', setFolders: jest.fn(), method: 'STPA',
    onStageComplete: ({stage, rows}) => {
      stages.push(stage);
      expect(rows[0].guidePhraseApplicable).toBe(decision);
      expect(rows[0].guidePhraseApplicabilityRationale).toBe(rationale);
    },
  });
  const headers = sheets.Summary[0];
  expect(sheets.Summary[1][headers.indexOf('Guide Phrase Applicable')]).toBe(decision);
  expect(sheets.Summary[1][headers.indexOf('Guide Phrase Applicability Rationale')]).toBe(rationale);
  if (decision === 'No') expect(fetchLLMResponse).not.toHaveBeenCalled();
  else {
    expect(fetchLLMResponse).toHaveBeenCalled();
    expect(stages).toEqual(HAZARD_ANALYSIS_STAGE_KEYS);
  }
});

test.each(['Yes','No'])('classification Needs Review cannot overwrite resolved %s or its rationale', decision => {
  const current = {'Guide Phrase Applicable':decision,'Guide Phrase Applicability Rationale':'Human rationale'};
  const result = normalizeNeedsReviewClassificationDecision({
    normalizedDecision:'Needs Review', remainingEvidenceGap:'Missing downstream exposure evidence',
    'Classification Evidence':'Exposure is unknown', 'Guide Phrase Applicable':'Needs Review',
    'Guide Phrase Applicability Rationale':'AI rationale',
  }, current).decision;
  expect(result['Guide Phrase Applicable']).toBe(decision);
  expect(result['Guide Phrase Applicability Rationale']).toBe('Human rationale');
  expect(result['Safety Classification']).toBe('Needs Review');
});

test('explicit applicability review can change a decision; downstream classification cannot', () => {
  const headers=['Raw Analysis Row ID','Guide Phrase Applicable','Guide Phrase Applicability Rationale'];
  const summary=[headers,['RAW-1','Yes','Accepted Yes']];
  const result=applyGuidePhraseApplicabilityUpdates(summary,[{sourceRowId:'RAW-1',
    'Guide Phrase Applicable':'No','Guide Phrase Applicability Rationale':'Reviewer corrected applicability'}]);
  expect(result.rejectedUpdates).toEqual([]);
  expect(result.summary[1].slice(1)).toEqual(['No','Reviewer corrected applicability']);
  expect(normalizeNeedsReviewClassificationDecision({normalizedDecision:'Mission/Reliability',
    'Guide Phrase Applicable':'Yes','Physical-Harm Chain Termination':'Contained',
    'Classification Evidence':'Contained'}, Object.fromEntries(headers.map((h,i)=>[h,result.summary[1][i]])))
    .decision['Guide Phrase Applicable']).toBe('No');
});

test('CSV export/import preserves both applicability decisions and their rationales', () => {
  const headers=['Raw Analysis Row ID','Guide Phrase Applicable','Guide Phrase Applicability Rationale','Hazard'];
  const exported=[headers,['RAW-1','Yes','Yes — accepted command applicability','Assessed hazard'],['RAW-2','No','No — no duration','Not Applicable']];
  const target=[headers,['RAW-1','','',''],['RAW-2','','','']];
  const plan=planHazardAnalysisCsvImport(target,toCsvText(exported));
  expect(plan.errors).toEqual([]);
  expect(applyHazardAnalysisCsvImport(target,plan.updates)).toEqual(exported);
});
