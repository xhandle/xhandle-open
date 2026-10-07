import { parseCodeArchitectureCsv } from './codeArchitectureCsvImport';
import { functionalDecompositionToCsv } from '../functional-decomposition/decompositionCsv';
import { toCsvText } from '../../lib/csv';

test('imports Projects CSV with labels, allocation and multiline details', () => {
  const rows = parseCodeArchitectureCsv(functionalDecompositionToCsv([{
    system: 'Vehicle', subsystem: 'Control', fromFunction: 'Driver',
    fromDetails: 'Line one,\nline two', controlAction: 'Brake', toFunction: 'Actuator',
  }]));
  expect(rows[0]).toMatchObject({ system: 'Vehicle', subsystem: 'Control', fromFunction: 'Driver', fromDetails: 'Line one,\nline two' });
});

test('retains code-specific columns and same labels in distinct source files', () => {
  const rows = parseCodeArchitectureCsv(toCsvText([
    ['Function (From)', 'Control Action', 'Function (To)', 'Function (From) File(s)', 'CSC'],
    ['run', 'Call save', 'save', 'a.py', 'A'],
    ['run', 'Call save', 'save', 'b.cpp', 'B'],
  ]));
  expect(rows).toHaveLength(2);
  expect(rows[1]['Function (From) File(s)']).toBe('b.cpp');
  expect(rows[1].CSC).toBe('B');
});

test('rejects incomplete, empty and hazard tables before publishing any rows', () => {
  expect(() => parseCodeArchitectureCsv('hello')).toThrow('Missing required');
  expect(() => parseCodeArchitectureCsv('Function (From),Control Action,Function (To)\na,b,')).toThrow('missing');
  expect(() => parseCodeArchitectureCsv('Function (From),Control Action,Function (To)')).toThrow('no functional');
  expect(() => parseCodeArchitectureCsv('Function (From),Control Action,Function (To),Guide Phrase\na,b,c,d')).toThrow('hazard analysis');
});

test('Functional CSV round trip preserves hierarchy, interaction identity, eligibility and supporting references', () => {
  const { restoreFunctionalCsvSnapshot, buildFunctionalModelRows } = require('./functionalModel');
  const csv = toCsvText([
    ['Interaction ID', 'Function (From)', 'Control Action', 'Function (To)', 'Interaction Type', 'Subsystem (From)', 'CSCI (From)', 'CSC (From)', 'Subsystem (To)', 'CSCI (To)', 'CSC (To)', 'Supporting Source Trace IDs', 'Supporting Source Rows', 'Hazard Analysis Eligibility'],
    ['interaction-1', 'Evaluate', 'Decision', 'Apply', 'control', 'System', 'Decision', 'Evaluation', 'System', 'Actuation', 'Execution', 'raw-1, raw-2', 'Row 1, Row 2', 'Include'],
    ['internal-1', 'Evaluate', 'Calculate', 'Evaluate', 'Internal operations', 'System', 'Decision', 'Evaluation', 'System', 'Decision', 'Evaluation', 'raw-3', 'Row 3', 'Exclude'],
  ]);
  const parsed = parseCodeArchitectureCsv(csv);
  const normalized = parsed.map(row => ({ ...row, from: row.fromFunction, to: row.toFunction, action: row.controlAction }));
  const restored = restoreFunctionalCsvSnapshot(normalized);
  const derived = buildFunctionalModelRows(JSON.parse(JSON.stringify(restored)));
  expect(derived).toHaveLength(2);
  const interaction = derived.find(row => row.traceId === 'interaction-1');
  expect(interaction).toMatchObject({ from: 'Evaluate', to: 'Apply', hazardAnalysisEligibility: 'Include', fromArchitecture: {csci: 'Decision', csc: 'Evaluation'}, toArchitecture: {csci:'Actuation', csc:'Execution'} });
  expect(interaction.functionalModel.sourceTraceIds).toEqual(['raw-1', 'raw-2']);
  expect(derived.find(row => row.traceId === 'internal-1').hazardAnalysisEligibility).toBe('Exclude');
});
