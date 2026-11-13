import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import DesignManagementView from './DesignManagementView';
import QuickSearch from '../../components/QuickSearch';
import { writeArtifactStorage } from './artifacts/artifactRepository';
import { createArtifact, listArtifacts, loadArtifact, updateDocumentDetails } from './artifacts/artifactRepository';
import { createEngineeringProject, listEngineeringProjects, loadEngineeringProject } from './artifacts/engineeringProjectRepository';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
jest.mock('./SysMLV2Modeler/SysMLV2ModelerView', () => () => null);
jest.mock('../../components/LLMModuleLinkerModal', () => () => null);
jest.mock('../../components/HazardAttributeMapper', () => () => null);
jest.mock('../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));

let root, host;
const contents = () => host.querySelector('[aria-label="Folder contents"]');
const button = (label, scope = host) => [...scope.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.title === label || node.textContent === label);
const click = async (label, scope = host) => act(async () => { const target = button(label, scope); if (!target) throw new Error(`Missing button: ${label}`); target.click(); });
async function until(check) {
  for (let n = 0; n < 150; n++) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 5))); }
  throw new Error(host.textContent);
}
const mount = () => act(async () => root.render(<DesignManagementView />));
const submit = async () => act(async () => host.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const field = async (label, value) => act(async () => {
  const input = [...host.querySelectorAll('[role="dialog"] label')].find(node => node.firstChild.textContent === label).querySelector('input,textarea');
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
});
const folderButton = name => button(name, host.querySelector('[aria-label="Design library"]'));
const config = { templateId: 'conops', title: 'Operations concept', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Mission', sources: [], notes: 'Operators request observations.' };
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Mission' }]));
  localStorage.setItem('xhandle:req-active-project', JSON.stringify('f'));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([
    { id: 'f', name: 'Designs', description: 'Mission design library', modules: [{ id: 'm', name: 'Source requirements', description: 'Source description' }] },
    { id: 'sub', name: 'Subsystems', parentId: 'f', modules: [] },
    { id: 'other', name: 'Other', modules: [{ id: 'other-m', name: 'Source requirements' }] },
  ]));
  localStorage.setItem('xhandle:requirements', JSON.stringify([
    { id: 'r', folderId: 'f', moduleId: 'm', module: 'Source requirements', title: 'Retain commands', links: [] },
    { id: 'legacy', folderId: 'f', module: 'Source requirements', title: 'Legacy source', links: [] },
    { id: 'other-r', folderId: 'other', moduleId: 'other-m', module: 'Source requirements', title: 'Other source', links: [] },
  ]));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks(); });

test('folder clicks show direct children once and opening an artifact or module switches to the editor', async () => {
  localStorage.setItem('xhandle:req-views', JSON.stringify([{ name: 'Legacy filtered view', selectedModule: 'Source requirements', viewMode: 'table', filterText: 'No matching rows', filterStatus: 'Rejected', sortKey: 'title', sortDir: 'desc' }]));
  const id = await createArtifact(config);
  const projectId = await createEngineeringProject({ name: 'Mission engineering', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Review commands.', artifacts: [{ templateId: 'conops', title: 'Project document' }] });
  const { program } = await loadEngineeringProject(projectId);
  await mount(); await until(() => !!contents()?.querySelector(`[data-folder-item-id="${id}"]`));
  expect(contents().querySelectorAll('tbody tr')).toHaveLength(4);
  expect(contents().querySelector(`[data-folder-item-id="${program.members[0].id}"]`)).toBeNull();
  expect(host.querySelector('[data-menubar]')).toBeNull(); expect(host.querySelector('.requirements-filter-bar')).toBeNull();
  await click('Open Operations concept', contents()); await until(() => !!host.querySelector('.artifact-header'));
  expect(host.querySelector('[data-menubar]')).not.toBeNull();
  await act(async () => folderButton('Designs').click());
  expect(contents()).not.toBeNull(); expect(host.querySelector('[data-menubar]')).toBeNull();
  await click('Open Source requirements', contents()); expect(host.querySelector('[data-menubar]')).not.toBeNull();
  expect(host.querySelector('.requirements-filter-bar')).toBeNull();
  await click('Table view'); expect(host.querySelector('[data-menubar]')).not.toBeNull();
  expect(host.querySelector('.requirements-filter-bar')).toBeNull();
  await click('View'); await click('Legacy filtered view');
  expect(host.querySelectorAll('.requirements-table-panel tbody tr')).toHaveLength(2);
  expect([...host.querySelectorAll('.requirements-table-panel tbody tr')].map(row => row.dataset.artifactObjectId)).toEqual(['legacy', 'r']);
  jest.spyOn(window, 'prompt').mockReturnValue('Current layout');
  await click('View'); await click('Save Current View…');
  expect(JSON.parse(localStorage.getItem('xhandle:req-views')).find(view => view.name === 'Current layout')).toEqual({ name: 'Current layout', selectedModule: 'Source requirements', viewMode: 'table' });
  await click('Traceability view'); expect(host.querySelector('[data-menubar]')).toBeNull();
  expect(host.querySelector('.requirements-filter-bar')).toBeNull();
  await act(async () => folderButton('Designs').click()); expect(contents()).not.toBeNull();
  await click('Open Subsystems', contents()); expect(contents().textContent).toContain('This folder is empty');
});

test('artifact and folder details persist from the list and stale artifact edits stay open with an error', async () => {
  const id = await createArtifact(config); await mount(); await until(() => !!contents()?.querySelector(`[data-folder-item-id="${id}"]`));
  await click('Edit details for Operations concept', contents()); await field('Title', 'Reviewed operations'); await field('Description', 'Operating scenarios and boundaries.'); await submit();
  await until(() => !host.querySelector('[role="dialog"]'));
  expect((await loadArtifact(id)).meta).toMatchObject({ title: 'Reviewed operations', description: 'Operating scenarios and boundaries.' });
  await until(() => !!button('Edit details for Reviewed operations', contents()));
  await click('Edit details for Reviewed operations', contents());
  await act(async () => updateDocumentDetails(id, 1, { title: 'Edited in another window', description: 'Latest details' }));
  await field('Title', 'Stale edit'); await submit();
  await until(() => !!host.querySelector('[role="dialog"] [role="alert"]'));
  expect(host.querySelector('[role="dialog"] [role="alert"]').textContent).toContain('changed in another window');
  expect((await loadArtifact(id)).meta.title).toBe('Edited in another window');
  await click('Cancel'); await click('Edit folder details', contents()); await field('Title', 'Mission designs'); await field('Description', 'Reviewed folder'); await submit();
  expect(JSON.parse(localStorage.getItem('xhandle:req-projects')).find(folder => folder.id === 'f')).toMatchObject({ name: 'Mission designs', description: 'Reviewed folder' });
  expect(contents().textContent).toContain('Mission designs'); expect(folderButton('Mission designs')).toBeDefined();
});

test('removing artifacts and complete projects from a folder deletes their records after confirmation', async () => {
  const id = await createArtifact(config);
  const projectId = await createEngineeringProject({ name: 'Mission engineering', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Review commands.', artifacts: [{ templateId: 'conops', title: 'Project document' }] });
  await mount(); await until(() => !!button('Remove Operations concept', contents()));
  await click('Remove Operations concept', contents()); await click('Cancel'); expect((await listArtifacts()).some(item => item.id === id)).toBe(true);
  await click('Remove Operations concept', contents()); await click('Permanently remove'); await until(() => !button('Remove Operations concept', contents()));
  expect((await listArtifacts()).some(item => item.id === id)).toBe(false);
  await click('Remove Mission engineering', contents()); expect(host.querySelector('[role="dialog"]').textContent).toContain('all its generated documents');
  await click('Permanently remove'); await until(() => !button('Remove Mission engineering', contents()));
  expect(await listEngineeringProjects()).toEqual([]); expect(await listArtifacts()).toEqual([]);
  expect(JSON.parse(localStorage.getItem('xhandle.projects'))).toHaveLength(1);
  expect(host.querySelector('[data-menubar]')).toBeNull();
});

test('legacy module rename and removal update only its own requirements and baselines', async () => {
  localStorage.setItem('xhandle:req-baselines:v2', JSON.stringify({ f: { m: { first: {} } }, other: { 'other-m': { first: {} } } }));
  await mount(); await click('Edit details for Source requirements', contents()); await field('Title', 'Mission requirements'); await field('Description', 'Reviewed sources'); await submit();
  expect(JSON.parse(localStorage.getItem('xhandle:requirements')).filter(row => row.folderId === 'f').map(row => row.module)).toEqual(['Mission requirements', 'Mission requirements']);
  await click('Remove Mission requirements', contents()); await click('Permanently remove');
  expect(JSON.parse(localStorage.getItem('xhandle:requirements')).map(row => row.id)).toEqual(['other-r']);
  expect(JSON.parse(localStorage.getItem('xhandle:req-baselines:v2'))).toEqual({ f: {}, other: { 'other-m': { first: {} } } });
  expect(contents().textContent).not.toContain('Mission requirements');
});

test('subfolders open in the list and empty subfolders can be removed', async () => {
  await mount(); await click('Edit details for Subsystems', contents()); await field('Description', 'Subsystem folders'); await submit();
  expect(JSON.parse(localStorage.getItem('xhandle:req-projects')).find(folder => folder.id === 'sub').description).toBe('Subsystem folders');
  await click('Remove Subsystems', contents()); await click('Permanently remove');
  expect(JSON.parse(localStorage.getItem('xhandle:req-projects')).some(folder => folder.id === 'sub')).toBe(false);
  expect(contents().querySelector('[data-folder-item-id="sub"]')).toBeNull();
});

test('a failed module save restores folder details and leaves its requirements unchanged', async () => {
  await mount();
  const originalFolders = localStorage.getItem('xhandle:req-projects'), originalRows = localStorage.getItem('xhandle:requirements');
  const setItem = Storage.prototype.setItem;
  let rejectSave = true;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === 'xhandle:requirements' && rejectSave) { rejectSave = false; throw new Error('Storage is full'); }
    return setItem.call(this, key, value);
  });
  await click('Edit details for Source requirements', contents()); await field('Title', 'Unsaved title'); await submit();
  expect(host.querySelector('[role="dialog"] [role="alert"]').textContent).toContain('Storage is full');
  expect(localStorage.getItem('xhandle:req-projects')).toBe(originalFolders); expect(localStorage.getItem('xhandle:requirements')).toBe(originalRows);
  expect(contents().textContent).toContain('Source requirements');
});

test('removing a nonempty subfolder keeps its contents and explains how to remove it', async () => {
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects'));
  folders.find(folder => folder.id === 'sub').modules = [{ id: 'sub-module', name: 'Subsystem requirements' }];
  localStorage.setItem('xhandle:req-projects', JSON.stringify(folders));
  await mount(); await click('Remove Subsystems', contents()); await click('Permanently remove');
  expect(host.querySelector('[role="dialog"] [role="alert"]').textContent).toContain('remove its contents');
  expect(JSON.parse(localStorage.getItem('xhandle:req-projects')).find(folder => folder.id === 'sub').modules).toHaveLength(1);
});

test('global Find searches folders, offscreen requirements and other artifact drafts, then reveals the original assessment', async () => {
  jest.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{ width: 100, height: 20 }]);
  Element.prototype.scrollIntoView = jest.fn();
  const id = await createArtifact(config);
  await writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const meta = await tx.objectStore('metadata').get(id);
    await tx.objectStore('metadata').put({ ...meta, templateId: 'hazard-tracking-list', title: 'Tracking records' });
    const job = await tx.objectStore('jobs').get(id);
    const rows = Array.from({ length: 250 }, (_, index) => ({ id: `deep-${index}`, sectionId: 's2', hazardTrackingRow: true, attributes: { Hazard: `Event ${Math.floor(index / 2)}`, Function: index === 249 ? 'Unique localization evidence' : 'Brake' }, sourceIds: [] }));
    await tx.objectStore('jobs').put({ ...job, state: 'paused', sections: { s2: rows } });
  });
  await act(async () => root.render(<><QuickSearch /><DesignManagementView /></>));
  await until(() => !!contents()?.querySelector(`[data-folder-item-id="${id}"]`));
  const search = async (query, kind) => {
    await click('Quick search');
    const input = document.querySelector('[role="combobox"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const match = () => [...document.querySelectorAll('[role="option"]')].find(node => !kind || node.textContent.startsWith(kind));
    await until(() => !!match());
    return match();
  };
  const requirement = await search('Other source', 'Requirement');
  await act(async () => requirement.click());
  await until(() => host.querySelector('[data-artifact-object-id="other-r"]')?.classList.contains('xhandle-search-hit'));
  expect(host.querySelector('[data-artifact-object-id="other-r"]').classList.contains('xhandle-search-hit')).toBe(true);
  const assessment = await search('Unique localization evidence');
  expect(assessment.textContent).toContain('Tracking records');
  await act(async () => assessment.click());
  await until(() => host.querySelector('[data-artifact-object-id="deep-249"]')?.classList.contains('xhandle-search-hit'));
  expect(host.querySelector('[aria-label="Hazard tracking page"]').value).toBe('2');
  expect(host.querySelector('[data-artifact-object-id="deep-249"]').classList.contains('xhandle-search-hit')).toBe(true);
  const folder = await search('Subsystems');
  await act(async () => folder.click());
  await until(() => !!contents()?.textContent.includes('This folder is empty'));
});
