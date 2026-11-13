import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { ARTIFACT_TEMPLATES } from './artifactModel';
import EngineeringProjectDialog from './EngineeringProjectDialog';
import EngineeringProjectEditor from './EngineeringProjectEditor';
import { ArtifactEditor } from './ArtifactWorkspace';
import { createEngineeringProject, loadEngineeringProject } from './engineeringProjectRepository';
import { saveProjectHazardAnalysisRecord } from '../../project-hazard-analysis/projectHazardAnalysisStorage';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
let host, root;
const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text || button.title === text);
const openActions = async () => {
  await until(() => !!host.querySelector('[aria-label="Artifact actions"]'));
  const trigger = host.querySelector('[aria-label="Artifact actions"]');
  if (trigger.getAttribute('aria-expanded') === 'false') await act(async () => trigger.click());
};
const click = async text => {
  if (!button(text) && host.querySelector('[aria-label="Artifact actions"]')) await openActions();
  await act(async () => button(text).click());
};
async function until(check) { for (let n = 0; n < 200; n++) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 5))); } throw new Error(host.textContent); }
function field(label, value) {
  const element = [...host.querySelectorAll('label')].find(node => node.firstChild?.textContent === label).querySelector('input,select,textarea');
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
}
const typeCheckbox = template => [...host.querySelectorAll('label')].find(node => node.textContent.trim() === template.name)?.querySelector('input[type=checkbox]');
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() }); Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Mission' }, { id: 'q', name: 'Payload' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [] }]));
  global.fetch = jest.fn(async (_url, options) => { const prompt = JSON.parse(JSON.parse(options.body).messages[1].content); return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'need', kind: 'requirement', title: 'Retain commands', text: 'The system shall retain commands.', sourceIds: prompt.sources.map(source => source.id) }] }) } }] }) }; });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks(); });

test('all document types are checkboxes with select-all, clear and scoped additional instances', async () => {
  const created = jest.fn();
  await act(async () => root.render(<EngineeringProjectDialog onClose={() => {}} onCreated={created} />));
  expect(ARTIFACT_TEMPLATES.every(template => !!typeCheckbox(template))).toBe(true);
  expect(ARTIFACT_TEMPLATES.filter(template => typeCheckbox(template).checked)).toHaveLength(2);
  await click('Select all document types'); expect(ARTIFACT_TEMPLATES.every(template => typeCheckbox(template).checked)).toBe(true);
  await click('Clear selection'); expect(ARTIFACT_TEMPLATES.some(template => typeCheckbox(template).checked)).toBe(false); expect(button('Create systems engineering project').disabled).toBe(true);
  await act(async () => typeCheckbox(ARTIFACT_TEMPLATES[2]).click());
  await click(`Add another subsystem — ${ARTIFACT_TEMPLATES[2].name}`);
  expect([...host.querySelectorAll('label')].filter(node => node.firstChild?.textContent === 'Subsystem')).toHaveLength(2);
  await click('Remove instance 2'); expect(host.textContent).toContain('1 documents selected');
  await click('Clear selection');
  await act(async () => { typeCheckbox(ARTIFACT_TEMPLATES[0]).click(); field('Project name', 'Mission engineering'); field('System', 'Mission'); field('Destination folder', 'f'); field('Shared project context', 'Operators review command history.'); });
  await act(async () => host.querySelector('.artifact-source-picker input').click());
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  const { program } = await loadEngineeringProject(created.mock.calls[0][0]);
  expect(program.members.map(member => member.config.templateId)).toEqual(['conops']); expect(program.ownerProjects).toEqual([{ id: 'p', workspaceType: 'functional' }]);
  expect(fetch).not.toHaveBeenCalled();
});
test('safety-only project creation requires hazard analysis and does not require replacement source notes', async () => {
  const created = jest.fn();
  await act(async () => root.render(<EngineeringProjectDialog activeFolderId="f" onClose={() => {}} onCreated={created} />));
  await click('Clear selection');
  await act(async () => typeCheckbox(ARTIFACT_TEMPLATES.find(template => template.id === 'safety-requirements')).click());
  await act(async () => { field('Project name', 'Mission safety'); field('System', 'Mission'); host.querySelector('.artifact-source-picker input').click(); });
  await until(() => host.querySelector('[aria-label="Hazard analysis sources"] [role="alert"]'));
  expect(host.querySelector('[aria-label="Hazard analysis sources"]').textContent).toContain('Perform hazard analysis');
  expect(button('Create systems engineering project').disabled).toBe(true);
  await act(async () => saveProjectHazardAnalysisRecord('p', { analysisResult: { Summary: [['Raw Analysis Row ID', 'Hazard', 'System Requirement'], ['R-1', 'Lost commands', 'The controller shall retain commands.']] } }));
  await until(() => !button('Create systems engineering project').disabled);
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  expect((await loadEngineeringProject(created.mock.calls[0][0])).records.map(record => record.meta.templateId)).toEqual(['hazard-tracking-list', 'safety-requirements']);
  expect(fetch).not.toHaveBeenCalled();
});
test('project generation reviews and accepts the complete set, then opens original requirements views with incoming links', async () => {
  const id = await createEngineeringProject({ name: 'Mission engineering', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }, { id: 'q', workspaceType: 'functional' }], sources: [], projectNotes: { 'functional:p': 'Operators review commands.', 'functional:q': 'Payload retains commands.' }, artifacts: [{ templateId: 'conops', title: 'Operations concept' }, { templateId: 'system-spec', title: 'System specification' }] });
  const open = jest.fn();
  await act(async () => root.render(<EngineeringProjectEditor id={id} onOpenArtifact={open} onDeleted={() => {}} />));
  await until(() => !!button('Generate / resume project')); await click('Generate / resume project'); await until(() => !!button('Review project proposal'));
  expect(fetch).toHaveBeenCalledTimes(12); expect(button('Accept complete project')).toBeUndefined();
  await click('Review project proposal'); await until(() => host.textContent.includes('Belongs to project')); expect(host.textContent).toContain('Belongs to project'); expect(host.textContent).toContain('Refines'); expect(host.textContent).toContain('Mission'); expect(host.textContent).toContain('Payload');
  await click('Accept complete project'); await until(() => host.querySelector('.artifact-header')?.textContent.includes('accepted'));
  const { records } = await loadEngineeringProject(id); expect(records.every(record => record.meta.revision === 1)).toBe(true);
  await click('Documents'); await click('Operations concept'); expect(open).toHaveBeenCalledWith(records[0].meta.id);
  await act(async () => root.render(<ArtifactEditor id={records[0].meta.id} onOpenProject={() => {}} onDeleted={() => {}} />));
  await until(() => !!button('Table view')); await click('Table view');
  await until(() => !!host.querySelector('.requirements-native-views thead th'));
  expect([...host.querySelectorAll('.requirements-native-views thead th')].map(node => node.textContent)).toEqual(['ID', 'Title', 'Description', 'Kind', 'Status', 'Version', 'Updated', 'Links']);
  expect(host.querySelector('[aria-label="Resize column Title"]')).not.toBeNull();
  await click('Traceability view'); await until(() => !!button('Refined by')); await click('Refined by'); expect(host.textContent).toContain('System specification');
  await openActions();
  expect(button('Generate update')).toBeUndefined(); expect(button('Open systems engineering project')).toBeDefined();
});

test('creates a destination folder in the modal, selects it, and uses it for every project document', async () => {
  const created = jest.fn(), changed = jest.fn(); window.addEventListener('xhandle:requirements-data-changed', changed);
  await act(async () => root.render(<EngineeringProjectDialog activeFolderId="f" onClose={() => {}} onCreated={created} />));
  await click('Create destination folder');
  await act(async () => field('Folder name', 'Mission documents')); await click('Create folder');
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects')); const destination = folders.find(folder => folder.name === 'Mission documents');
  expect(destination).toMatchObject({ parentId: 'f', modules: [] }); expect(folders).toHaveLength(2);
  const selector = [...host.querySelectorAll('label')].find(node => node.firstChild?.textContent === 'Destination folder').querySelector('select');
  expect(selector.value).toBe(destination.id); expect(changed).toHaveBeenCalled(); window.removeEventListener('xhandle:requirements-data-changed', changed);
  await act(async () => { field('Project name', 'Mission engineering'); field('System', 'Mission'); field('Shared project context', 'Operators review commands.'); host.querySelector('.artifact-source-picker input').click(); });
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  const { program, records } = await loadEngineeringProject(created.mock.calls[0][0]);
  expect(program.folderId).toBe(destination.id); expect(records.every(record => record.meta.folderId === destination.id)).toBe(true);
});
test('folder persistence failures keep the previous destination and show the storage error', async () => {
  await act(async () => root.render(<EngineeringProjectDialog activeFolderId="f" onClose={() => {}} onCreated={() => {}} />));
  await click('Create destination folder'); await act(async () => field('Folder name', 'New folder'));
  const original = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) { if (key === 'xhandle:req-projects') throw new Error('Storage full'); return original.call(this, key, value); });
  await click('Create folder'); expect(host.querySelector('[role=alert]').textContent).toBe('Storage full');
  expect(JSON.parse(localStorage.getItem('xhandle:req-projects'))).toHaveLength(1);
  expect([...host.querySelectorAll('label')].find(node => node.firstChild?.textContent === 'Destination folder').querySelector('select').value).toBe('f');
});

test('project area shows the active document, section, saved totals and progress bar during generation', async () => {
  const id = await createEngineeringProject({ name: 'Pronto', system: 'Robotaxi', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Operators request vehicle motion.', artifacts: [{ templateId: 'conops', title: 'Concept of Operations' }, { templateId: 'system-spec', title: 'System Specification' }] });
  const normal = global.fetch.getMockImplementation(); let finish;
  global.fetch.mockImplementationOnce((...args) => new Promise(resolve => { finish = async () => resolve(await normal(...args)); }));
  await act(async () => root.render(<EngineeringProjectEditor id={id} onOpenArtifact={() => {}} onDeleted={() => {}} />));
  await until(() => !!button('Generate / resume project')); await click('Generate / resume project');
  await until(() => !!finish);
  const panel = host.querySelector('[aria-label="Project generation progress"]');
  expect(panel.textContent).toContain('Document 1 of 2'); expect(panel.textContent).toContain('Concept of Operations'); expect(panel.textContent).toContain('Purpose and scope');
  expect(panel.textContent).toContain('0 of 12 sections saved');
  expect(panel.querySelector('progress').max).toBe(12); expect(panel.querySelector('progress').value).toBe(0);
  expect(host.querySelector('tbody tr.bg-indigo-50')).not.toBeNull();
  await act(async () => finish()); await until(() => !!button('Review project proposal'));
  expect(host.querySelector('[aria-label="Project generation progress"]')).toBeNull();
  expect(host.textContent).toContain('Draft generation complete. Ready for review.');
});


test('project details are editable from the project header and persist', async () => {
  const id = await createEngineeringProject({ name: 'Mission project', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Operators retain commands.', artifacts: [{ templateId: 'conops' }] });
  await act(async () => root.render(<EngineeringProjectEditor id={id} onOpenArtifact={() => {}} onDeleted={() => {}} />));
  await until(() => !!button('Edit details'));
  await click('Edit details');
  await act(async () => { field('Title', 'Mission design program'); field('Description', 'A coordinated document set.'); });
  await act(async () => host.querySelector('.artifact-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => !host.querySelector('.artifact-modal'));
  await until(() => host.querySelector('.artifact-header').textContent.includes('Mission design program'));
  expect((await loadEngineeringProject(id)).program.description).toBe('A coordinated document set.');
});

test('project artifacts have Delete artifact in the actions menu, with cancel and navigation back to the project', async () => {
  const id = await createEngineeringProject({ name: 'Pronto', system: 'Vehicle', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Retain commands.', artifacts: [{ templateId: 'conops' }, { templateId: 'system-spec' }] });
  const { records } = await loadEngineeringProject(id), openProject = jest.fn();
  await act(async () => root.render(<ArtifactEditor id={records[0].meta.id} onOpenProject={openProject} onDeleted={() => {}} />));
  await openActions();
  await until(() => !!button('Edit details'));
  expect(button('Edit details').nextElementSibling.textContent).toBe('Delete artifact');
  await click('Delete artifact'); expect(host.querySelector('[role=dialog]').textContent).toContain('other artifacts are kept');
  await click('Cancel'); expect((await loadEngineeringProject(id)).records).toHaveLength(2);
  await click('Delete artifact'); await click('Permanently delete artifact');
  await until(() => openProject.mock.calls.length === 1);
  expect(openProject).toHaveBeenCalledWith(id);
  expect((await loadEngineeringProject(id)).records.map(record => record.meta.id)).toEqual([records[1].meta.id]);
});
