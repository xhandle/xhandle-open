import { libraryDrop, reorderedKeys } from './designLibraryDrag';
const folders = [{ id: 'a', parentId: null }, { id: 'child', parentId: 'a' }, { id: 'b', parentId: null }];
test('folders support sibling ordering, nesting and promotion without cycles', () => {
  const source = { kind: 'folder', id: 'a', parentId: null };
  expect(libraryDrop(source, { kind: 'folder', id: 'b', parentId: null }, 'before', folders)).toMatchObject({ container: 'library', anchor: 'folder:b' });
  expect(libraryDrop(source, { kind: 'folder', id: 'b' }, 'inside', folders)).toMatchObject({ folderId: 'b' });
  expect(libraryDrop(source, { kind: 'folder', id: 'child' }, 'inside', folders)).toBeNull();
  expect(libraryDrop({ kind: 'folder', id: 'child', parentId: 'a' }, null, 'inside', folders)).toMatchObject({ container: 'library', folderId: null });
});
test('projects and standalone artifacts move between folders, while project membership stays intact', () => {
  const target = { kind: 'folder', id: 'b' };
  for (const kind of ['project', 'artifact', 'module']) expect(libraryDrop({ kind, id: 'i', folderId: 'a' }, target, 'inside', folders)).toMatchObject({ folderId: 'b' });
  const member = { kind: 'artifact', id: 'doc', programId: 'program', folderId: 'a' };
  expect(libraryDrop(member, target, 'inside', folders)).toMatchObject({ container: 'folder:b', folderId: 'b' });
  expect(libraryDrop(member, { ...member, id: 'other', folderId: 'child', libraryParent: 'folder:child' }, 'before', folders)).toMatchObject({ container: 'folder:child', folderId: 'child' });
  expect(libraryDrop(member, { kind: 'artifact', id: 'other', programId: 'program' }, 'after', folders)).toMatchObject({ container: 'project:program' });
  expect(libraryDrop(member, { kind: 'artifact', id: 'other', programId: 'different' }, 'before', folders)).toBeNull();
});
test('relative insertion is stable, never duplicates an item and supports append', () => {
  expect(reorderedKeys(['artifact:a', 'artifact:b', 'artifact:c'], { kind: 'artifact', id: 'c' }, { anchor: 'artifact:a', position: 'before' })).toEqual(['artifact:c', 'artifact:a', 'artifact:b']);
  expect(reorderedKeys(['artifact:a', 'artifact:b'], { kind: 'artifact', id: 'a' }, { anchor: null, position: 'inside' })).toEqual(['artifact:b', 'artifact:a']);
});
test('standalone artifacts can join projects by dropping on the project or between its artifacts', () => {
  const item = { id: 'architecture', kind: 'artifact', folderId: 'a' };
  expect(libraryDrop(item, { kind: 'project', id: 'example', folderId: 'b' }, 'inside', folders)).toMatchObject({ container: 'project:example', programId: 'example' });
  expect(libraryDrop(item, { kind: 'artifact', id: 'doc', programId: 'example' }, 'before', folders)).toMatchObject({ programId: 'example', anchor: 'artifact:doc' });
  expect(libraryDrop({ ...item, kind: 'folder' }, { kind: 'project', id: 'example' }, 'inside', folders)).toMatchObject({ programId: 'example' });
});

test('mixed folder/project nesting rejects cycles and foreign members', () => {
  const projects = [{ ...folders[0], modules: [{ id: 'p', recordType: 'systems-engineering-project', libraryFolderIds: ['b'] }] }, folders[1], folders[2]];
  const project = { kind: 'project', id: 'p', folderId: 'a' };
  expect(libraryDrop({ kind: 'folder', id: 'a' }, project, 'inside', projects)).toBeNull();
  expect(libraryDrop(project, { kind: 'folder', id: 'b' }, 'inside', projects)).toBeNull();
  expect(libraryDrop({ kind: 'artifact', id: 'doc', programId: 'other' }, { kind: 'folder', id: 'b' }, 'inside', projects)).toBeNull();
  expect(libraryDrop({ kind: 'artifact', id: 'doc' }, { kind: 'folder', id: 'b' }, 'inside', projects)).toMatchObject({ folderId: 'b' });
  expect(libraryDrop({ kind: 'folder', id: 'child' }, { kind: 'folder', id: 'b', libraryParent: 'project:p' }, 'before', projects)).toMatchObject({ programId: 'p', anchor: 'folder:b' });
});
