import { moveFolder } from './folderOrder';

const folders = [
  { id: 'a', parentId: null }, { id: 'b', parentId: null },
  { id: 'child', parentId: 'a' }, { id: 'grandchild', parentId: 'child' },
  { id: 'other', parentId: 'b' },
];
const siblings = (rows, parent = null) => rows.filter(row => row.parentId === parent).map(row => row.id);

test('reorders root folders and preserves descendants after persistence', () => {
  const result = JSON.parse(JSON.stringify(moveFolder(folders, 'b', 'a')));
  expect(siblings(result)).toEqual(['b', 'a']);
  expect(siblings(result, 'a')).toEqual(['child']);
  expect(siblings(result, 'child')).toEqual(['grandchild']);
  expect(siblings(moveFolder(result, 'b', 'a', 'after'))).toEqual(['a', 'b']);
  expect(siblings(folders)).toEqual(['a', 'b']);
});

test('moves folders between parents with their subtree and back to root', () => {
  const result = moveFolder(folders, 'child', 'other', 'after');
  expect(siblings(result, 'b')).toEqual(['other', 'child']);
  expect(result.find(row => row.id === 'grandchild')).toBe(folders[3]);
  expect(siblings(moveFolder(result, 'child'))).toEqual(['a', 'b', 'child']);
});

test('rejects cycles, self drops and stale targets', () => {
  expect(moveFolder(folders, 'a', 'grandchild')).toBe(folders);
  expect(moveFolder(folders, 'a', 'child')).toBe(folders);
  expect(moveFolder(folders, 'a', 'a')).toBe(folders);
  expect(moveFolder(folders, 'missing', 'b')).toBe(folders);
  expect(moveFolder(folders, 'a', 'missing')).toBe(folders);
});

test('nests an entire subtree, preserves order after reload, and rejects descendant nesting', () => {
  const nested = JSON.parse(JSON.stringify(moveFolder(folders, 'a', 'b', 'inside')));
  expect(siblings(nested)).toEqual(['b']);
  expect(siblings(nested, 'b')).toEqual(['other', 'a']);
  expect(siblings(nested, 'a')).toEqual(['child']);
  expect(siblings(nested, 'child')).toEqual(['grandchild']);
  expect(moveFolder(nested, 'b', 'grandchild', 'inside')).toBe(nested);
  expect(moveFolder(nested, 'a', 'a', 'inside')).toBe(nested);
  const restored = moveFolder(nested, 'a');
  expect(siblings(restored)).toEqual(['b', 'a']);
  expect(siblings(restored, 'a')).toEqual(['child']);
});
