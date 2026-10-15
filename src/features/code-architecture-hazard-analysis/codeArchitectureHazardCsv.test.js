import {ensureCodeArchitectureTraceIds} from './codeArchitectureHazardUtils';
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

test.each(['HARA','FHA'])('%s CSV draft exposes all seven deviations with distinct import identities',method=>{
 const sheet=buildCodeArchitectureHazardCsvDraft({...options,method},headers).generatedSheets.Summary;
 expect(sheet).toHaveLength(8);
 expect(new Set(sheet.slice(1).map(row=>row[3])).size).toBe(7);
 expect(new Set(sheet.slice(1).map(row=>row[5])).size).toBe(7);
 const plan=planHazardAnalysisCsvImport(sheet,toCsvText(sheet));
 expect(plan.errors).toEqual([]);
});

test('reusing the workspace fingerprint preserves draft identity and import/export rows',()=>{
 const stableOptions={...options,cbaRows:ensureCodeArchitectureTraceIds(options.cbaRows)};
 const original=buildCodeArchitectureHazardCsvDraft(stableOptions,headers);
 const reused=buildCodeArchitectureHazardCsvDraft({...stableOptions,architectureSnapshotHash:original.architectureSnapshotHash},headers);
 expect(reused.architectureSnapshotHash).toBe(original.architectureSnapshotHash);
 expect(reused.generatedSheets).toEqual(original.generatedSheets);
 expect(reused.traceabilityMap).toEqual(original.traceabilityMap);
});

test('draft preparation reports completed row progress and reserves 100 for delivery',()=>{
 const progress=[];
 const draft=buildCodeArchitectureHazardCsvDraft(options,headers,value=>progress.push(value));
 expect(progress[0]).toBe(0);
 expect(progress.at(-1)).toBe(99);
 expect(progress.some(value=>value>0 && value<80)).toBe(true);
 expect(progress.length).toBeGreaterThan(draft.generatedSheets.Summary.length);
 expect(progress.every((value,index)=>value>=0 && value<=99 && (!index || value>=progress[index-1]))).toBe(true);
});
