jest.mock('../../components/aiAnalysisSTPA', () => ({fetchLLMResponse: jest.fn()}));
jest.mock('./codeHazardGenerationCheckpoint', () => ({createCodeHazardCheckpoint: jest.fn()}));
jest.mock('./codeArchitectureHazardStore', () => ({saveCodeArchitectureHazardRun: jest.fn()}));
jest.mock('./codeArchitectureHazardSourceAudit', () => ({enrichHazardTableRowsWithSourceContent: jest.fn()}));
import { fetchLLMResponse } from '../../components/aiAnalysisSTPA';
import { createCodeHazardCheckpoint } from './codeHazardGenerationCheckpoint';
import { saveCodeArchitectureHazardRun } from './codeArchitectureHazardStore';
import { enrichHazardTableRowsWithSourceContent } from './codeArchitectureHazardSourceAudit';
import { runCodeArchitectureHazardAnalysis } from './codeArchitectureHazardRunner';
import { restoreFunctionalCsvSnapshot, functionalModelIsReady } from '../code-architecture-context/functionalModel';
import { normalizeCodeArchitectureHazardRun } from './codeArchitectureHazardUtils';

beforeEach(() => {
  createCodeHazardCheckpoint.mockResolvedValue(null);
  saveCodeArchitectureHazardRun.mockImplementation(async run => run);
  enrichHazardTableRowsWithSourceContent.mockImplementation(async rows => rows);
  fetchLLMResponse.mockImplementation(async prompt => {
    // Any downstream call is a failure: every fixture decision is No.
    const records = JSON.parse(prompt.split('\nRecords:\n')[1]);
    return JSON.stringify(records.map(record => ({id: record.id, qualification: 'Non-control',
      evidence: record.action, decisions: record.phrases.map(phrase => ({phrase, value: 'No',
        rationale: 'Pure data transformation, not a commanded state change.', evidence: record.action}))})));
  });
});
test.each(['github', 'local'])('%s runner uses ready Functional rows, screens before hazards, and persists all exclusions', async sourceType => {
  const cbaRows = restoreFunctionalCsvSnapshot([{
    from: 'Transform Payload', action: 'Compute payload checksum', to: 'Checksum Result', traceId: 'functional-checksum',
    fromNodeId: 'transform', toNodeId: 'checksum', rowRef: 1,
    hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'manual',
    functionalCsvSnapshot: {version: 1, kind: 'data-flow', sourceTraceIds: ['raw-call-1']},
  }]);
  expect(functionalModelIsReady(cbaRows)).toBe(true);
  const progress = jest.fn();
  const run = await runCodeArchitectureHazardAnalysis({cbaRows, projectId: 'fixture-project',
    repoMeta: {repoId: 'fixture-repo', sourceType}, setProgress: progress});
  expect(run.analysisAbstraction).toBe('functional');
  expect(fetchLLMResponse).toHaveBeenCalledTimes(1);
  expect(run.applicabilityScreening.counts).toEqual({yes: 0, no: 7, unresolved: 0});
  const h = run.generatedSheets.Summary[0];
  expect(run.generatedSheets.Summary).toHaveLength(8);
  expect(run.generatedSheets.Summary.slice(1).every(row => row[h.indexOf('Guide Phrase Applicable')] === 'No')).toBe(true);
  expect(saveCodeArchitectureHazardRun).toHaveBeenCalledWith(run);
  // Serialization/reload preserves provenance, including source/Functional revision.
  const reloaded = normalizeCodeArchitectureHazardRun(JSON.parse(JSON.stringify(run)));
  expect(reloaded.applicabilityScreening).toEqual(run.applicabilityScreening);
  expect(progress.mock.calls.some(([patch]) => patch.phase === 'applicability-screening')).toBe(true);
});

test('failed screening persists reviewable unresolved rows without generating UCAs or declaring completion', async () => {
  fetchLLMResponse.mockResolvedValue('not JSON');
  const onActivityUpdate = jest.fn();
  const run = await runCodeArchitectureHazardAnalysis({projectId: 'p', repoMeta: {repoId: 'r'}, onActivityUpdate,
    cbaRows: [{from: 'Sender', action: 'Unknown interface operation', to: 'Receiver', traceId: 't',
      hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'manual'}]});
  expect(fetchLLMResponse).toHaveBeenCalledTimes(2);
  expect(run.applicabilityScreening.counts.unresolved).toBe(7);
  expect(onActivityUpdate.mock.calls.at(-1)[0].message).toContain('need review');
  const h = run.generatedSheets.Summary[0];
  expect(run.generatedSheets.Summary.slice(1).every(row => row[h.indexOf('Unsafe Control Actions')] === '')).toBe(true);
  expect(run.generatedSheets.Summary.slice(1).every(row => row[h.indexOf('Guide Phrase Applicable')] === 'Needs Review')).toBe(true);
});
