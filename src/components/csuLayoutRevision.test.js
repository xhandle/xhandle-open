import { csuLayoutRevision } from './csuLayoutRevision';
const row = { fromFunction: 'A', toFunction: 'B', controlAction: 'Call', architecture: { csc: 'Control' } };
test('evidence and descriptions do not reset geometry', () => {
  expect(csuLayoutRevision([row])).toBe(csuLayoutRevision([{ ...row, fromDetails: 'Updated', codeEvidence: { source: 'Large evidence' } }]));
});
test.each([
  { fromFunction: 'Renamed' }, { fromNodeId: 'new-id' }, { toArchitecture: { csc: 'Elsewhere' } },
  { architecture: { csc: 'Changed' } }, { functionalModel: { internal: true } }, { controlAction: 'Changed' },
])('topology, labels and endpoint allocation invalidate geometry: %j', edit => {
  expect(csuLayoutRevision([row])).not.toBe(csuLayoutRevision([{ ...row, ...edit }]));
});
