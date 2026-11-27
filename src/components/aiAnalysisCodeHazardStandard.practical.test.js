import { fetchLLMResponse } from './aiAnalysisSTPA';
import { getStandardConfig, runStandardHazardAnalysisStages, requestStandardRowsWithRetries } from './aiAnalysisCodeHazardStandard';
import { completeProjectStpaAssessment, usableProjectStpaAssessment, STPA_COMPLETION_POLICY, needsPracticalStpaCompletion } from '../features/project-hazard-analysis/stpaAcceptance';

jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
const config = { ...getStandardConfig('STPA'), completionPolicy: STPA_COMPLETION_POLICY };
const item = { id: 'FD-1', from: 'Input Monitor', controlAction: 'Publish operating state', to: 'Sequence Controller', guidePhrase: 'Not providing the control action causes a hazard', operationalContextId: 'context-1', contextAssumptions: 'The sequence controller consumes the state for the current cycle.' };
const assessed = () => completeProjectStpaAssessment({
  hazards: 'Sequence Controller starts the next operation with an obsolete operating state.',
  safetyClassification: 'Mission/Reliability',
  safetySignificanceRationale: 'The modeled consequence is an incorrect production sequence.',
}, item);
beforeEach(() => fetchLLMResponse.mockReset());

test('retains a usable assessment without strict proof audits or repeated requests', async () => {
  const row = assessed();
  fetchLLMResponse.mockResolvedValue(JSON.stringify([row]));
  const stages = [];
  const result = await runStandardHazardAnalysisStages({ config, items: [item], onStageComplete: ({stage}) => stages.push(stage) });
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(stages).toEqual(['generation']);
  expect(result[0].hazards).toBe(row.hazards);
  expect(usableProjectStpaAssessment(result[0], item)).toBe(true);
  for (const key of ['classificationEvidence', 'protectionAssessment', 'physicalHarmChainTermination']) expect(result[0][key]).toBe('');
});

test('corrects unresolved rows once, retaining useful content and completing the remaining fields', async () => {
  fetchLLMResponse.mockResolvedValueOnce(JSON.stringify([{ id: item.id, hazards: 'Sequence Controller starts the next operation with obsolete operating state.', losses: 'TBD', safetyClassification: 'Needs Review' }]))
    .mockResolvedValueOnce(JSON.stringify([{ id: item.id, hazards: 'Needs Review', unsafeControlActions: 'The monitor omits Publish operating state while the next sequence starts.' }]));
  const [row] = await requestStandardRowsWithRetries(config, [item]);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
  expect(fetchLLMResponse.mock.calls[1][0]).toContain('obsolete operating state');
  expect(row.hazards).toContain('obsolete operating state');
  expect(row.unsafeControlActions).toContain('while the next sequence starts');
  expect(usableProjectStpaAssessment(row, item)).toBe(true);
  expect(JSON.stringify(row)).not.toMatch(/needs review|TBD|TBC|not assessed|evidence gap/i);
});

test('automatic unresolved screening is assessed while a supplied No bypasses generation', async () => {
  const excluded = { ...item, id: 'FD-2', guidePhraseApplicable: 'No', guidePhraseApplicabilityRationale: 'This transaction has no maintained duration.' };
  const screened = { ...item, guidePhraseApplicable: 'Needs Review', guidePhraseApplicabilityOrigin: 'Automatic screening' };
  fetchLLMResponse.mockResolvedValue(JSON.stringify([assessed()]));
  const rows = await runStandardHazardAnalysisStages({ config, items: [excluded, screened] });
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(rows[0].guidePhraseApplicable).toBe('No');
  expect(rows[0].hazards).toBe('Not applicable');
  expect(rows[0].guidePhraseApplicabilityRationale).toBe(excluded.guidePhraseApplicabilityRationale);
  expect(rows[1].guidePhraseApplicable).toBe('Yes');
  expect(rows.every((row, index) => usableProjectStpaAssessment(row, [excluded, screened][index]))).toBe(true);
});

test('keeps analyst Yes and safety-significance decisions', () => {
  const reviewed = { ...item, guidePhraseApplicable: 'Yes', guidePhraseApplicabilityOrigin: 'user', guidePhraseApplicabilityReviewStatus: 'reviewed', guidePhraseApplicabilityRationale: 'Analyst selected this operating scope.', safetySignificant: 'Yes', safetySignificanceReviewStatus: 'reviewed' };
  const row = completeProjectStpaAssessment({ ...assessed(), guidePhraseApplicable: 'No' }, reviewed);
  expect(row.guidePhraseApplicable).toBe('Yes');
  expect(row.guidePhraseApplicabilityRationale).toBe(reviewed.guidePhraseApplicabilityRationale);
  expect(row.safetySignificant).toBe('Yes');
});

test('uses row identities rather than response order across context variants', async () => {
  const second = { ...item, id: 'FD-2', operationalContextId: 'context-2' };
  fetchLLMResponse.mockResolvedValue(JSON.stringify([{ ...assessed(), id: 'FD-2-STPA', hazards: 'Context two hazardous state.' }, assessed()]));
  const rows = await requestStandardRowsWithRetries(config, [item, second]);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(rows.map(row => row.id)).toEqual(['FD-1-STPA', 'FD-2-STPA']);
  expect(rows[1].hazards).toBe('Context two hazardous state.');
});

test('reuses completed generation checkpoints without new provider requests', async () => {
  const checkpoint = { read: jest.fn(async () => [assessed()]), write: jest.fn() };
  const rows = await runStandardHazardAnalysisStages({ config, items: [item], generationCheckpoint: checkpoint });
  expect(rows[0].hazards).toBe(assessed().hazards);
  expect(fetchLLMResponse).not.toHaveBeenCalled();
  expect(checkpoint.read.mock.calls[0][0].config.completionPolicy).toBe(STPA_COMPLETION_POLICY);
});

test.each([
  Object.assign(new Error('Stopped'), { name: 'AbortError' }),
  Object.assign(new Error('Storage unavailable'), { code: 'HAZARD_EVIDENCE_STORAGE_UNAVAILABLE' }),
  new TypeError('Invalid program state'),
])('does not replace interruption or persistence failures with generated drafts: %s', async error => {
  fetchLLMResponse.mockRejectedValue(error);
  await expect(requestStandardRowsWithRetries(config, [item])).rejects.toBe(error);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
});

test('retains best-effort progress through recoverable provider timeouts', async () => {
  fetchLLMResponse.mockRejectedValue(Object.assign(new Error('Timed out'), { name: 'TimeoutError' }));
  const [row] = await requestStandardRowsWithRetries(config, [item]);
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
  expect(usableProjectStpaAssessment(row, item)).toBe(true);
});

test('old unresolved STPA drafts are regenerated while HARA stays on its own acceptance rules', () => {
  const headers = ['Unsafe Control Action', 'Guide Phrase Applicable', 'Guide Phrase Applicability Rationale'];
  expect(needsPracticalStpaCompletion(headers, ['Needs Review', 'Needs Review', 'Pending'])).toBe(true);
  expect(needsPracticalStpaCompletion([...headers, 'Hazardous Event ID'], ['Needs Review', 'Needs Review', 'Pending', 'HE-1'])).toBe(false);
});

test('an applicable row cannot satisfy the acceptance bar using Not applicable in place of an assessment', () => {
  const candidate = { ...assessed(), hazards: 'Not applicable', unsafeControlActions: 'Not applicable' };
  expect(usableProjectStpaAssessment(candidate, item)).toBe(false);
  const completed = completeProjectStpaAssessment(candidate, item);
  expect(usableProjectStpaAssessment(completed, item)).toBe(true);
  expect(completed.hazards).not.toBe('Not applicable');
});
