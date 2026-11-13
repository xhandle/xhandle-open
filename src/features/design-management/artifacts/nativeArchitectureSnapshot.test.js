import { nativeArchitectureState, nativeElementSource } from './nativeArchitectureSnapshot';

const rows = [{ id: 'command', fromFunction: 'Operator', toFunction: 'Controller', controlAction: 'Command' }, { id: 'feedback', fromFunction: 'Controller', toFunction: 'Operator', controlAction: 'Status' }];
const diagram = { diagramHash: 'snapshot', snapshot: { native: { rows, storage: { ':groups:v1': '[{"id":"system","width":900}]', ':edge-routing:v1': '{"defaultStyle":"rectangular"}' } }, nodes: [], edges: rows.map(row => ({ id: row.id, row })) } };
test('native renderer gets a private copy of snapshot storage and rows', () => {
  const before = JSON.stringify(diagram), first = nativeArchitectureState(diagram), second = nativeArchitectureState(diagram);
  expect(first.storage.getItem(first.key + ':groups:v1')).toContain('900');
  first.storage.setItem(first.key + ':groups:v1', '[]'); first.rows[0].fromFunction = 'Changed';
  expect(JSON.stringify(diagram)).toBe(before);
  expect(second.rows[0].fromFunction).toBe('Operator');
  expect(second.storage.getItem(second.key + ':groups:v1')).toContain('900');
});
test('native relationship and aggregate clicks resolve stable source identities', () => {
  expect(nativeElementSource(diagram, { type: 'node', id: 'n:Operator' })).toBe('n:Operator');
  expect(nativeElementSource(diagram, { type: 'edge', id: 'e:n:Controller->n:Operator-1' })).toBe('feedback');
  expect(nativeElementSource(diagram, { type: 'edge', id: 'aggregate', data: { edgeIds: ['e:n:Operator->n:Controller-0', 'e:n:Controller->n:Operator-1'] } })).toBe('command');
});

test('saved arrangements overlay private storage and retain removals without changing evidence', () => {
  const before = JSON.stringify(diagram), changed = jest.fn();
  const state = nativeArchitectureState({ ...diagram, presentation: { storage: { ':groups:v1': '[]' } } }, changed);
  expect(state.storage.getItem(state.key + ':groups:v1')).toBe('[]');
  state.storage.removeItem(state.key + ':edge-routing:v1');
  const presentation = changed.mock.calls[0][0];
  const reopened = nativeArchitectureState({ ...diagram, presentation });
  expect(reopened.storage.getItem(reopened.key + ':edge-routing:v1')).toBeNull();
  expect(reopened.rows).toEqual(rows);
  expect(JSON.stringify(diagram)).toBe(before);
});
