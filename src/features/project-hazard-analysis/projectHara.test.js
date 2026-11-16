import { calculateProjectHaraAsil, PROJECT_HARA_HEADERS, recalculateProjectHaraRow, refreshProjectHaraSheets } from './projectHara';
import { normalizeProjectHazardMethod } from './hazardReconciliation';
import { CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS } from '../code-architecture-hazard-analysis/codeArchitectureHazardTypes';

// Independent transcribed oracle: NHTSA DOT HS 812 574, Table 21.
const cases = [
  ['S1','E1','QM','QM','QM'], ['S1','E2','QM','QM','QM'], ['S1','E3','QM','QM','A'], ['S1','E4','QM','A','B'],
  ['S2','E1','QM','QM','QM'], ['S2','E2','QM','QM','A'], ['S2','E3','QM','A','B'], ['S2','E4','A','B','C'],
  ['S3','E1','QM','QM','A'], ['S3','E2','QM','A','B'], ['S3','E3','A','B','C'], ['S3','E4','B','C','D'],
];
test.each(cases)('%s / %s computes all controllability classes', (s,e,...values) => {
  values.forEach((value, index) => expect(calculateProjectHaraAsil(s,e,`C${index+1}`)).toBe(value === 'QM' ? value : `ASIL ${value}`));
});
test.each([['S0','E4','C3'],['S3','E0','C3'],['S3','E4','C0']])('zero class %s/%s/%s does not silently become QM', (...ratings) => {
  expect(calculateProjectHaraAsil(...ratings)).toBe('Not assigned');
});
test.each([['','E4','C3'],['S9','E4','C3'],['S3','E2 or E4','C3'],['S3','E4','C4']])('invalid classification does not fabricate ASIL', (...ratings) => {
  expect(calculateProjectHaraAsil(...ratings)).toBe('Not assessed');
});
const headers = [...PROJECT_HARA_HEADERS, 'Raw Analysis Row ID', 'Operational Scenario'];
const row = overrides => headers.map(name => ({'Raw Analysis Row ID':'raw-1', 'Operational Scenario':'Urban driving', 'Guide Phrase Applicable':'Yes',
  'Hazardous Event':'Vehicle accelerates into pedestrians while stopping.', 'Potential Harm':'Fatal pedestrian injuries',
  'Severity':'S3', 'Severity Rationale':'Fatal pedestrian impact is possible.', 'Exposure':'E4', 'Exposure Rationale':'The vehicle stops at crossings frequently.',
  'Controllability':'C3', 'Controllability Rationale':'The vehicle is automated; the exposed pedestrian cannot avoid the impact.',
  'Item Definition':'Automated vehicle longitudinal motion control.', 'Safety Goal':'The vehicle shall prevent unintended acceleration while stopping.',
  'Safe State':'Stationary with propulsion inhibited.', 'Fault Tolerant Time Interval':'100 ms', 'FTTI Rationale':'Recorded hazard timing analysis H-1 specifies 100 ms.', ...overrides})[name] || '');
const read = (r, h) => r[headers.indexOf(h)];
test('goal ASIL is highest event ASIL and provenance survives regeneration and rating edits', () => {
  const one = row({}), two = row({'Raw Analysis Row ID':'raw-2',Severity:'S1',Exposure:'E3',Controllability:'C3'});
  const first = refreshProjectHaraSheets({Summary:[headers, one, two]});
  expect(first['Safety Goals']).toHaveLength(2);
  expect(first['Safety Goals'][1][2]).toBe('ASIL D');
  expect(read(first.Summary[1],'Safety Goal ID')).toBe(read(first.Summary[2],'Safety Goal ID'));
  const changed = [...first.Summary[1]]; changed[headers.indexOf('Severity')] = 'S1';
  const revised = refreshProjectHaraSheets({Summary:[headers, changed, first.Summary[2]]});
  expect(read(revised.Summary[1],'ASIL')).toBe('ASIL B');
  expect(revised['Safety Goals'][1][2]).toBe('ASIL B');
  expect(read(revised.Summary[1],'Hazardous Event ID')).toBe(read(first.Summary[1],'Hazardous Event ID'));
  expect(read(revised.Summary[1],'Assessment Status')).toBe('Inconsistent exposure');
});
test('missing rationale and item definition remain gaps and do not approve generated proposals', () => {
  const result = recalculateProjectHaraRow(headers, row({'Item Definition':'', 'Exposure Rationale':'', 'Exposure':''}));
  expect(read(result,'ASIL')).toBe('Not assessed');
  expect(read(result,'Assessment Gaps')).toMatch(/item definition/);
  expect(read(result,'Assessment Gaps')).toMatch(/exposure rationale/);
  expect(read(result,'Assessment Status')).toBe('In progress');
});
test('non-applicable guide phrases have no safety goal or risk assignment', () => {
  const result = refreshProjectHaraSheets({Summary:[headers,row({'Guide Phrase Applicable':'No'})]});
  expect(read(result.Summary[1],'ASIL')).toBe('Not applicable');
  expect(result['Safety Goals']).toHaveLength(1);
});
test('equivalent outcome wording shares one consolidated goal and highest linked ASIL', () => {
  const result=refreshProjectHaraSheets({Summary:[headers,
    row({'Hazard Outcome':'Unintended propulsion at an occupied crossing'}),
    row({'Raw Analysis Row ID':'raw-2','Hazard Outcome':'Unexpected acceleration into an occupied pedestrian crossing',Severity:'S1'}),
  ]});
  expect(result['Safety Goals']).toHaveLength(2);
  expect(read(result.Summary[1],'Safety Goal ID')).toBe(read(result.Summary[2],'Safety Goal ID'));
  expect(result['Safety Goals'][1][2]).toBe('ASIL D');
});
test('HARA is selectable in Projects; FHA is removed only from new CBA method options', () => {
  expect(normalizeProjectHazardMethod(' HARA ')).toBe('HARA');
  expect(normalizeProjectHazardMethod('STPA')).toBe('STPA-Textbook');
  expect(CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS.map(item => item.value)).toEqual(['STPA-Textbook','HARA']);
});
