import { createFolderRecord, createModuleRecord, loadFolders, migrateRequirementsState } from './requirementsState';

beforeEach(() => localStorage.clear());
test('a new empty workspace does not create a compulsory folder', () => {
  expect(migrateRequirementsState()).toMatchObject({ folders: [], requirements: [], activeFolderId: null });
  expect(loadFolders()).toEqual([]);
  expect(() => createModuleRecord({ name: 'Requirements' })).toThrow('Create a folder');
});
test('folders can be created as peers or subfolders without a root container', () => {
  const first = createFolderRecord({ name: 'Vehicle' }); const second = createFolderRecord({ name: 'Infrastructure' }); const child = createFolderRecord({ name: 'Control', parentId: first.id });
  expect(loadFolders().filter(folder => folder.parentId === null).map(folder => folder.id)).toEqual([first.id, second.id]);
  expect(child.parentId).toBe(first.id);
});
test('legacy Root becomes an ordinary folder without changing IDs, hierarchy, module content or requirement links', () => {
  const folders = [{ id: 'old', name: 'Root', modules: [{ id: 'm', name: 'Needs' }] }, { id: 'sub', name: 'Control', parentId: 'old', modules: [] }];
  const rows = [{ id: 'req', folderId: 'old', moduleId: 'm', links: [{ toId: 'other', type: 'refines' }] }];
  localStorage.setItem('xhandle:req-projects', JSON.stringify(folders)); localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
  const migrated = migrateRequirementsState();
  expect(migrated.folders[0]).toMatchObject({ id: 'old', name: 'Designs', parentId: null, modules: folders[0].modules });
  expect(migrated.folders[1]).toEqual(folders[1]); expect(migrated.requirements).toEqual(rows);
  expect(migrateRequirementsState().folders).toEqual(migrated.folders);
});
test('unfiled legacy requirements are preserved in an ordinary migration folder', () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify([{ id: 'r', module: 'Needs', title: 'Original content' }]));
  const result = migrateRequirementsState(); expect(result.folders[0].name).toBe('Designs');
  expect(result.requirements[0]).toMatchObject({ id: 'r', title: 'Original content', folderId: result.folders[0].id, moduleId: result.folders[0].modules[0].id });
});
