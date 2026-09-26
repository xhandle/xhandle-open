import { buildCodeArchitectureHazardCsvDraft } from './codeArchitectureHazardCsv';
import { applyHazardAnalysisCsvImport, planHazardAnalysisCsvImport } from '../project-hazard-analysis/hazardAnalysisCsv';
import { toCsvText } from '../../lib/csv';

const headers = ['Function (From)', 'Control Action', 'Function (To)', 'Guide Phrase', 'Causal Scenario', 'Raw Analysis Row ID', 'Operational Context ID', 'Operational Scenario', 'Operational Mode', 'Operating Conditions'];
const options = {
  method: 'STPA-Textbook', projectId: 'p1', repoMeta: { repoId: 'repo1' },
  cbaRows: [
    { from: 'Estimate Pose', action: 'Publish pose estimate', to: 'Plan Motion', traceId: 'trace1', fromFile: 'pose.py', hazardAnalysisEligibility: 'Include', hazardAnalysisEligibilitySource: 'manual' },
    { from: 'Config', action: 'Define __init__', to: '__init__' },
  ],
};

test('draft exposes seven variants per eligible interface, with stable IDs and code traceability', () => {
  const run = buildCodeArchitectureHazardCsvDraft(options, headers);
  const sheet = run.generatedSheets.Summary;
  expect(sheet).toHaveLength(8);
  expect(new Set(sheet.slice(1).map(row => row[5])).size).toBe(7);
  expect(sheet[1][sheet[0].indexOf('Trace ID')]).toBe('trace1');
  expect(sheet[1][sheet[0].indexOf('Related Source File(s)')]).toContain('pose.py');
  expect(run.projectId).toBe('p1');
  expect(run.architectureSnapshotHash).toBeTruthy();
  expect(sheet.slice(1).every(row => row[4] === '')).toBe(true);
});

test('externally completed subset can populate the draft without deleting omitted rows', () => {
  const sheet = buildCodeArchitectureHazardCsvDraft(options, headers).generatedSheets.Summary;
  const completed = [...sheet[1]];
  completed[4] = 'Stale pose causes an unsafe trajectory';
  completed[5] = 'EXTERNAL-1';
  completed[6] = 'yard'; completed[7] = 'Pickup'; completed[8] = 'Driving';
  const plan = planHazardAnalysisCsvImport(sheet, toCsvText([sheet[0], completed]));
  expect(plan.errors).toEqual([]);
  const merged = applyHazardAnalysisCsvImport(sheet, plan.updates);
  expect(merged[1][4]).toBe(completed[4]);
  expect(merged[1][5]).toBe(sheet[1][5]);
  expect(merged.slice(2)).toEqual(sheet.slice(2));
});
