jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
import { fetchLLMResponse } from './aiAnalysisSTPA';
import {
  getStandardConfig, HAZARD_ANALYSIS_REPAIR_STAGES, findApplicabilityPatternRepairIndexes,
} from './aiAnalysisCodeHazardStandard';

const config = getStandardConfig('STPA');
const stage = name => HAZARD_ANALYSIS_REPAIR_STAGES.find(([key]) => key === name)[1];
const item = (id, protection = 'Automatic screening') => ({
  id, from: 'Planner', controlAction: 'Send motion command', to: 'Executor',
  guidePhrase: 'The control action is provided too late',
  guidePhraseApplicable: 'Yes', guidePhraseApplicabilityRationale: 'Accepted timing decision',
  ...(protection === 'Reviewed' ? { guidePhraseApplicabilityReviewStatus: protection }
    : { guidePhraseApplicabilityOrigin: protection }),
});
const row = () => ({
  guidePhraseApplicable: 'Yes', guidePhraseApplicabilityRationale: 'Accepted timing decision',
  causalFactorCategory: 'Timing / sequencing',
  causalFactors: 'A timing and sequencing fault delays the motion command.',
});
const instructions = prompt => prompt.split(/Rows to classify:|Rows to repair:/)[0];
const schema = prompt => instructions(prompt).split('Each object must include:')[1]?.split('\n')[1]
  || instructions(prompt).split('Each object must include:\n')[1];

beforeEach(() => fetchLLMResponse.mockReset());

test.each(['Automatic screening', 'Reviewed'])('%s audit requests only downstream fields and ignores hostile applicability output', async protection => {
  fetchLLMResponse.mockResolvedValue(JSON.stringify([{
    id: 'FD-1', guidePhraseApplicable: 'No', guidePhraseApplicabilityRationale: 'Overwrite attempt',
    safetyClassification: 'Needs Review', safetyClassificationRule: 'U4', causalPathType: 'Uncertain',
    classificationEvidence: 'Receiver authority is unknown', protectionStatus: 'Unknown',
  }]));
  const onProgress = jest.fn();
  const result = await stage('safety-audit')(config, [row()], [item('FD-1', protection)], { onProgress });
  const prompt = fetchLLMResponse.mock.calls[0][0];
  expect(schema(prompt)).not.toMatch(/guidePhraseApplicable|applicabilityEvidence|semanticMeaningful/);
  expect(instructions(prompt)).not.toContain('re-decide applicability independently');
  expect(instructions(prompt)).toContain('intermediateSafetyFunction and intermediateSafetyEffect are mandatory');
  expect(instructions(prompt)).toContain('safetyEvidenceQuote must be an exact verbatim excerpt');
  expect(result[0].guidePhraseApplicable).toBe('Yes');
  expect(result[0].guidePhraseApplicabilityRationale).toBe('Accepted timing decision');
  expect(result[0].safetyClassification).toBe('Needs Review');
  expect(onProgress.mock.calls.some(([p]) => p.message.includes('Auditing safety significance and evidence'))).toBe(true);
});

test('mixed protected and legacy rows have separate audit requests and retain their original order', async () => {
  fetchLLMResponse.mockImplementation(async prompt => JSON.stringify(
    JSON.parse(prompt.split('Rows to classify:\n')[1]).reverse().map(({ row: input }) => ({
      id: input.id, safetyClassification: 'Needs Review', classificationEvidence: `Evidence for ${input.id}`,
    })),
  ));
  const items = [item('FD-1'), item('FD-2', ''), item('FD-3', 'Reviewed')];
  const result = await stage('safety-audit')(config, items.map(row), items, {});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
  const prompts = fetchLLMResponse.mock.calls.map(([prompt]) => prompt);
  const protectedPrompt = prompts.find(prompt => !schema(prompt).includes('semanticMeaningful'));
  const legacyPrompt = prompts.find(prompt => schema(prompt).includes('semanticMeaningful'));
  expect(JSON.parse(protectedPrompt.split('Rows to classify:\n')[1]).map(({ row }) => row.id)).toEqual(['FD-1', 'FD-3']);
  expect(JSON.parse(legacyPrompt.split('Rows to classify:\n')[1]).map(({ row }) => row.id)).toEqual(['FD-2']);
  expect(legacyPrompt).toContain('re-decide applicability independently');
  expect(result.map(r => r.classificationEvidence)).toEqual(['Evidence for FD-1', 'Evidence for FD-2', 'Evidence for FD-3']);
});

test.each(['Automatic screening', 'Reviewed'])('uniform %s decisions alone do not trigger applicability pattern requests', async protection => {
  const guides = ['Not providing', 'Providing', 'Too early', 'Too late', 'Wrong order', 'Stopped too soon', 'Applied too long'];
  const items = guides.map((guidePhrase, index) => ({ ...item(`FD-${index}`, protection), guidePhrase }));
  const rows = items.map(row);
  expect(findApplicabilityPatternRepairIndexes(rows, items)).toEqual([]);
  expect(await stage('audit-anomaly-repair')(config, rows, items, {})).toEqual(rows);
  expect(fetchLLMResponse).not.toHaveBeenCalled();
  // The existing legacy calibration remains active when no authoritative decision exists.
  expect(findApplicabilityPatternRepairIndexes(rows, items.map(i => ({ ...i,
    guidePhraseApplicabilityOrigin: '', guidePhraseApplicabilityReviewStatus: '',
  })))).not.toEqual([]);
});

test('genuine causal mismatches still receive repairs without structured applicability output', async () => {
  const items = Array.from({ length: 6 }, (_, index) => item(`FD-${index}`));
  const rows = items.map(row);
  rows[2] = { ...rows[2], causalFactorCategory: 'Power / energy',
    causalFactors: 'The publisher runs before sensor calibration and before the initialization gate has completed.' };
  expect(findApplicabilityPatternRepairIndexes(rows, items)).toEqual([2]);
  fetchLLMResponse.mockResolvedValue(JSON.stringify([{
    id: 'FD-2', causalFactorCategory: 'Timing / sequencing',
    causalFactors: 'The initialization gate allows premature consumption before calibration.',
    guidePhraseApplicable: 'No', guidePhraseApplicabilityRationale: 'Overwrite attempt',
    safetyClassification: 'Needs Review', classificationEvidence: 'Receiver effect remains unknown',
  }]));
  const result = await stage('audit-anomaly-repair')(config, rows, items, {});
  const [prompt, , , , options] = fetchLLMResponse.mock.calls[0];
  expect(options.workflow).toBe('hazard-safety-consistency-repair');
  expect(schema(prompt)).not.toMatch(/guidePhraseApplicable|semanticMeaningful|applicabilityEvidence/);
  expect(instructions(prompt)).not.toContain('Completed-run applicability distribution');
  expect(instructions(prompt)).not.toContain('Every No decision must satisfy');
  expect(result[2].causalFactorCategory).toBe('Timing / sequencing');
  expect(result[2].guidePhraseApplicable).toBe('Yes');
  expect(result[2].guidePhraseApplicabilityRationale).toBe('Accepted timing decision');
  expect(result[0]).toEqual(rows[0]);
});

test('protected rows still flag unsupported safety conclusions and mixed legacy rows retain causal checks', () => {
  const items = Array.from({ length: 7 }, (_, index) => item(`FD-${index}`));
  const rows = items.map(row);
  rows[1] = { ...rows[1], safetyClassification: 'Safety — Direct', causalPathType: 'None',
    safetyClassificationRule: 'D1', causalEffect: '', resultingSystemState: '' };
  items[5] = item('FD-5', '');
  rows[5] = { ...rows[5], causalFactorCategory: 'Power / energy',
    causalFactors: 'The publisher runs before sensor calibration and before the initialization gate has completed.' };
  expect(findApplicabilityPatternRepairIndexes(rows, items)).toEqual([1, 5]);
});

test('an empty protected repair response retains the independently audited row', async () => {
  const items = Array.from({ length: 6 }, (_, index) => item(`FD-${index}`));
  const rows = items.map(row);
  rows[2] = { ...rows[2], causalFactorCategory: '' };
  fetchLLMResponse.mockResolvedValue('[]');
  expect(await stage('audit-anomaly-repair')(config, rows, items, {})).toEqual(rows);
});
