import { folderDestinations } from './folderDestinations';

test('destination choices include nested folders with unambiguous paths', () => {
  expect(folderDestinations([{ id: 'a', name: 'Atoms' }, { id: 'b', name: 'Architectures', parentId: 'a' }, { id: 'c', name: 'CSU', parentId: 'b' }]).map(folder => [folder.id, folder.path]))
    .toEqual([['a', 'Atoms'], ['b', 'Atoms / Architectures'], ['c', 'Atoms / Architectures / CSU']]);
});

test('project folders show their displayed parent path', () => {
  expect(folderDestinations([{ id: 'f', name: 'Atoms' }, { id: 'sub', name: 'Specifications', parentId: 'f' }], [{ id: 'p', title: 'Pronto', folderId: 'f', libraryFolderIds: ['sub'] }])[1].path).toBe('Atoms / Pronto / Specifications');
});
