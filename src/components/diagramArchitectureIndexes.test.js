import { computeArchitectureByFunction, computeFunctionGroupsByFile, inferFunctionGroupForFile } from './diagramArchitectureIndexes';

test('file index preserves group labels across shared files and endpoint combinations', () => {
  const rows = [
    { fromFile: 'a.cpp;b.cpp', toFile: 'a.cpp', fromFunction: 'Read position', toFunction: 'Compute velocity' },
    { fromFile: 'b.cpp', toFile: 'a.cpp', fromFunction: 'Resolve route', toFunction: 'Read position' },
    { fromFile: '', toFile: '', fromFunction: 'Start', toFunction: 'Stop' },
  ];
  const groups = computeFunctionGroupsByFile(rows);
  for (const file of ['a.cpp', 'b.cpp', '']) expect(groups.get(file)).toBe(inferFunctionGroupForFile(file, rows));
});
test('hub evidence preserves unique insertion order and isolates function evidence', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    fromFunction: `f${i}`, toFunction: 'hub', rowRef: `r${i}`,
    fromFile: `${i}.cpp`, toFile: 'hub.cpp', architecture: { subsystem: 'first', rationale: i ? 'later' : 'original' },
  }));
  const result = computeArchitectureByFunction(rows);
  expect(result.get('hub').evidence.rowRefs).toEqual(rows.map(row => row.rowRef));
  expect(result.get('hub').evidence.files).toHaveLength(1001);
  expect(result.get('hub').evidence.files.slice(0, 3)).toEqual(['0.cpp', 'hub.cpp', '1.cpp']);
  expect(result.get('f0').evidence.rowRefs).toEqual(['r0']);
  expect(result.get('hub').evidence.rationale).toBe('original');
  expect(rows[0]).not.toHaveProperty('evidence');
});
test('same-function endpoints do not duplicate evidence or lose bounded source data', () => {
  const row = { fromFunction: 'same', toFunction: 'same', rowRef: 'r', fromFile: 'a', toFile: 'a', codeEvidence: { files: [{ filePath: 'a', imports: ['x'], exports: ['y'] }] } };
  expect(computeArchitectureByFunction([row, row]).get('same').evidence).toMatchObject({ rowRefs: ['r'], files: ['a'], imports: ['x'], exports: ['y'] });
});
