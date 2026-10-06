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
