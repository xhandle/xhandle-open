import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { CREATABLE_ARTIFACT_TEMPLATES as ARTIFACT_TEMPLATES, getTemplate } from './artifactModel';
import EngineeringProjectDialog from './EngineeringProjectDialog';
import EngineeringProjectEditor from './EngineeringProjectEditor';
import { ArtifactEditor } from './ArtifactWorkspace';
import { createEngineeringProject, loadEngineeringProject } from './engineeringProjectRepository';
import { captureLiveSources } from './artifactSources';

jest.mock('reactflow', () => {
  const React = require('react');
  const fitView = jest.fn();
  return { __esModule: true, default: props => <div data-trace-graph>{props.nodes.map(node => <button key={node.id} onClick={() => props.onNodeClick(null, node)}>{node.data.label}</button>)}{props.edges.map(edge => <span key={edge.id}>{edge.label}</span>)}</div>,
    ReactFlowProvider: ({ children }) => children, useReactFlow: () => ({ fitView, fitBounds: fitView }), Background: () => null, Controls: () => null, MiniMap: () => null, Handle: () => null, MarkerType: { ArrowClosed: 'arrowclosed' }, Position: { Left: 'left', Right: 'right' } };
});
jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
let host, root;
const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text || button.title === text || button.getAttribute('aria-label') === text);
const openActions = async () => {
  await until(() => !!host.querySelector('[aria-label="Artifact actions"], [aria-label="Project actions"]'));
  const trigger = host.querySelector('[aria-label="Artifact actions"], [aria-label="Project actions"]');
  if (trigger.getAttribute('aria-expanded') === 'false') await act(async () => trigger.click());
};
const click = async text => {
  if (!button(text) && host.querySelector('[aria-label="Artifact actions"], [aria-label="Project actions"]')) await openActions();
  const group = button(text)?.closest('details.design-action-group');
  if (group && !group.open) await act(async () => group.querySelector('summary').click());
  await act(async () => button(text).click());
};
async function until(check) { for (let n = 0; n < 200; n++) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 5))); } throw new Error(host.textContent); }
function field(label, value) {
  const element = [...host.querySelectorAll('label')].find(node => node.firstChild?.textContent === label).querySelector('input,select,textarea');
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
}
const typeCheckbox = template => [...host.querySelectorAll('label')].find(node => node.textContent.trim() === template.name)?.querySelector('input[type=checkbox]');
const sourceDiagramCheckbox = () => [...host.querySelectorAll('fieldset')].find(node => node.querySelector('legend')?.textContent === 'Source diagrams').querySelector('input[type=checkbox]');
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() }); Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Mission' }, { id: 'q', name: 'Payload' }]));
  localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { responseRows: [
    { id: 'command', fromFunction: 'Operator', controlAction: 'Command', toFunction: 'Controller' },
    { id: 'feedback', fromFunction: 'Controller', controlAction: 'Feedback', toFunction: 'Operator' },
  ] } }));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [] }]));
  global.fetch = jest.fn(async (_url, options) => { const prompt = JSON.parse(JSON.parse(options.body).messages[1].content); return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'need', kind: 'requirement', title: 'Retain commands', text: 'The system shall retain commands.', sourceIds: prompt.sources.map(source => source.id) }] }) } }] }) }; });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks(); });

test('the simplified document choices support select-all, clear and multiple architectures', async () => {
  const created = jest.fn();
  await act(async () => root.render(<EngineeringProjectDialog onClose={() => {}} onCreated={created} />));
  expect(ARTIFACT_TEMPLATES.every(template => !!typeCheckbox(template))).toBe(true);
  expect([...host.querySelectorAll('fieldset')].find(node => node.querySelector('legend')?.textContent === 'Artifacts to generate').querySelectorAll('input[type=checkbox]')).toHaveLength(5);
  expect(ARTIFACT_TEMPLATES.filter(template => typeCheckbox(template).checked)).toHaveLength(2);
  await click('Select all document types'); expect(ARTIFACT_TEMPLATES.every(template => typeCheckbox(template).checked)).toBe(true);
  await click('Clear selection'); expect(ARTIFACT_TEMPLATES.some(template => typeCheckbox(template).checked)).toBe(false); expect(button('Create systems engineering project').disabled).toBe(true);
  await act(async () => typeCheckbox(getTemplate('architecture')).click());
  await click('Add another architecture — Architecture');
  expect([...host.querySelectorAll('label')].filter(node => node.firstChild?.textContent === 'Architecture type')).toHaveLength(2);
  await click('Remove instance 2'); expect(host.textContent).toContain('1 documents selected');
  await click('Clear selection');
  await act(async () => { typeCheckbox(ARTIFACT_TEMPLATES[0]).click(); field('Project name', 'Mission engineering'); field('System', 'Mission'); field('Destination folder', 'f'); });
  await act(async () => host.querySelector('.artifact-source-picker input').click());
  await act(async () => sourceDiagramCheckbox().click());
  for (const removed of ['Architecture scope', 'Diagram level', 'Source notes', 'Source modules and their owners', 'Shared project context']) expect(host.textContent).not.toContain(removed);
  const savedSource = localStorage.getItem('xhandle.projectData');
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  const { program } = await loadEngineeringProject(created.mock.calls[0][0]);
  expect(program.members.map(member => member.config.templateId)).toEqual(['conops']); expect(program.ownerProjects).toEqual([{ id: 'p', workspaceType: 'functional' }]);
  expect(program.config.architectureSources).toEqual([{ projectId: 'p', workspaceType: 'functional' }]);
  expect(program.config).toMatchObject({ notes: '', sources: [], projectNotes: { 'functional:p': '' } });
  const captured = await captureLiveSources(program.config);
  const diagram = captured.entries.find(source => source.sourceType === 'architecture-diagram');
  expect(diagram.snapshot.edges.map(edge => edge.label).sort()).toEqual(['Command', 'Feedback']);
  expect(diagram.ownerProjects).toEqual(program.ownerProjects);
  expect(captured.entries.some(source => ['project-notes', 'source-notes', 'module-object'].includes(source.sourceType))).toBe(false);
  expect(localStorage.getItem('xhandle.projectData')).toBe(savedSource);
  expect(fetch).not.toHaveBeenCalled();
});
test('new project choices exclude retired types and retain the existing default selection', async () => {
  await act(async () => root.render(<EngineeringProjectDialog activeFolderId="f" onClose={() => {}} onCreated={() => {}} />));
  const retired = ['subsystem-spec', 'system-design', 'subsystem-design', 'interface-spec', 'hazard-tracking-list', 'safety-requirements'];
  for (const id of retired) expect(typeCheckbox(getTemplate(id))).toBeUndefined();
  expect(ARTIFACT_TEMPLATES.filter(template => typeCheckbox(template).checked).map(template => template.id)).toEqual(['conops', 'system-spec']);
  expect(host.querySelector('[aria-label="Hazard analysis sources"]')).toBeNull();
});
test('the project generator creates both new requirements specification types from selected checkboxes', async () => {
  const created = jest.fn();
  await act(async () => root.render(<EngineeringProjectDialog activeFolderId="f" onClose={() => {}} onCreated={created} />));
  await click('Clear selection');
  await act(async () => {
    typeCheckbox(ARTIFACT_TEMPLATES.find(template => template.id === 'software-spec')).click();
    typeCheckbox(ARTIFACT_TEMPLATES.find(template => template.id === 'hardware-spec')).click();
    field('Project name', 'Allocated specifications'); field('System', 'Mission');
    host.querySelector('.artifact-source-picker input').click();
  });
  await act(async () => sourceDiagramCheckbox().click());
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  expect((await loadEngineeringProject(created.mock.calls[0][0])).records.map(record => record.meta.templateId)).toEqual(['system-spec', 'software-spec', 'hardware-spec']);
  expect(fetch).not.toHaveBeenCalled();
});
test('project generation reviews and accepts the complete set, then opens original requirements views with incoming links', async () => {
  const id = await createEngineeringProject({ name: 'Mission engineering', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }, { id: 'q', workspaceType: 'functional' }], sources: [], projectNotes: { 'functional:p': 'Operators review commands.', 'functional:q': 'Payload retains commands.' }, artifacts: [{ templateId: 'conops', title: 'Operations concept' }, { templateId: 'system-spec', title: 'System specification' }] });
  const open = jest.fn();
  await act(async () => root.render(<EngineeringProjectEditor id={id} onOpenArtifact={open} onDeleted={() => {}} />));
  await openActions(); await until(() => !!button('Generate / resume project')); await click('Generate / resume project'); await until(() => host.querySelector('[data-project-state="ready"]')); await openActions(); await until(() => !!button('Review project proposal'));
  expect(fetch).toHaveBeenCalledTimes(12); expect(button('Accept complete project')).toBeUndefined();
  await click('Review project proposal'); await until(() => host.querySelector('[data-trace-graph]'));
  expect(button('Diagram').getAttribute('aria-pressed')).toBe('true');
  await click('Operations concept'); expect(host.querySelector('[aria-label="Selected traceability item"]')).not.toBeNull();
  await click('Open linked item'); expect(open).toHaveBeenCalledWith(expect.any(String), null);
  await click('Table'); await until(() => host.textContent.includes('Belongs to project')); expect(host.textContent).toContain('Belongs to project'); expect(host.textContent).toContain('Refines'); expect(host.textContent).toContain('Mission'); expect(host.textContent).toContain('Payload');
  await click('Accept complete project'); await until(() => host.querySelector('[data-project-state="accepted"]'));
  const { records } = await loadEngineeringProject(id); expect(records.every(record => record.meta.revision === 1)).toBe(true);
  await click('Documents'); await click('Operations concept'); expect(open).toHaveBeenCalledWith(records[0].meta.id);
  await act(async () => root.render(<ArtifactEditor id={records[0].meta.id} onOpenProject={() => {}} onDeleted={() => {}} />));
  await until(() => !!button('Table view')); await click('Table view');
  await until(() => !!host.querySelector('.requirements-native-views thead th'));
  expect([...host.querySelectorAll('.requirements-native-views thead th')].map(node => node.querySelector('button span').textContent)).toEqual(['ID', 'Title', 'Description', 'Kind', 'Status', 'Version', 'Updated', 'Links']);
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
  await act(async () => { field('Project name', 'Mission engineering'); field('System', 'Mission'); host.querySelector('.artifact-source-picker input').click(); });
  await act(async () => sourceDiagramCheckbox().click());
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
  await openActions(); await until(() => !!button('Generate / resume project')); await click('Generate / resume project');
  await until(() => !!finish);
  const panel = host.querySelector('[aria-label="Project generation progress"]');
  expect(panel.textContent).toContain('Document 1 of 2'); expect(panel.textContent).toContain('Concept of Operations'); expect(panel.textContent).toContain('Purpose and scope');
  expect(panel.textContent).toContain('0 of 12 sections saved');
  expect(panel.querySelector('progress').max).toBe(12); expect(panel.querySelector('progress').value).toBe(0);
  expect(host.querySelector('tbody tr.bg-indigo-50')).not.toBeNull();
  await act(async () => finish()); await until(() => host.querySelector('[data-project-state="ready"]')); await openActions(); await until(() => !!button('Review project proposal'));
  expect(host.querySelector('[aria-label="Project generation progress"]')).toBeNull();
  expect(button('Review project proposal')).toBeDefined();
  expect(document.querySelector('.artifact-actions-popover .artifact-job')).toBeNull();
});


test('project details are editable from the project header and persist', async () => {
  const id = await createEngineeringProject({ name: 'Mission project', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Operators retain commands.', artifacts: [{ templateId: 'conops' }] });
  await act(async () => root.render(<EngineeringProjectEditor id={id} onOpenArtifact={() => {}} onDeleted={() => {}} />));
  await openActions(); await until(() => !!button('Edit details'));
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
  expect(button('Delete artifact').classList.contains('danger')).toBe(true);
  expect(button('Delete artifact').closest('.design-actions-list')).not.toBe(button('Edit details').closest('.design-actions-list'));
  await click('Delete artifact'); expect(host.querySelector('[role=dialog]').textContent).toContain('other artifacts are kept');
  await click('Cancel'); expect((await loadEngineeringProject(id)).records).toHaveLength(2);
  await click('Delete artifact'); await click('Permanently delete artifact');
  await until(() => openProject.mock.calls.length === 1);
  expect(openProject).toHaveBeenCalledWith(id);
  expect((await loadEngineeringProject(id)).records.map(record => record.meta.id)).toEqual([records[1].meta.id]);
});

test('project management actions share one overflow menu and exports and delete confirmation remain usable', async () => {
  const id = await createEngineeringProject({ name: 'Mission project', system: 'Mission', folderId: 'f', owners: [{ id: 'p', workspaceType: 'functional' }], notes: 'Operators retain commands.', artifacts: [{ templateId: 'conops' }] });
  const deleted = jest.fn(), createMatrix = jest.fn();
  window.addEventListener('xhandle:create-traceability-matrix', createMatrix);
  const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:project-export'); URL.revokeObjectURL = jest.fn();
  const downloads = []; jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.download); });
  try {
    await act(async () => root.render(<EngineeringProjectEditor id={id} onOpenArtifact={() => {}} onDeleted={deleted} />));
    await until(() => !!button('Project actions'));
    expect(host.querySelector('.artifact-header').querySelectorAll('button')).toHaveLength(1);
    expect(button('Edit details')).toBeUndefined(); expect(button('Generate fresh update')).toBeUndefined();
    await openActions();
    const panel = document.querySelector('.artifact-actions-popover');
    for (const label of ['Edit details', 'Source diagrams', 'Export project and traceability', 'Download project backup (JSON)', 'Delete project', 'Generate fresh update', 'Create traceability matrix']) expect(panel.contains(button(label))).toBe(true);
    await click('Source diagrams'); await until(() => !!host.querySelector('[aria-label="Manage source diagrams"]')); await click('Cancel');
    await click('Project traceability profile'); await until(() => !!host.querySelector('[aria-label="Project traceability profile"]')); await click('Cancel');
    await click('Create traceability matrix'); expect(createMatrix).toHaveBeenCalledTimes(1); expect(createMatrix.mock.calls[0][0].detail.id).toBe(id);
    await click('Export project and traceability'); await until(() => downloads.length === 1);
    await click('Download project backup (JSON)'); await until(() => downloads.length === 2);
    expect(downloads[0]).toMatch(/\.html$/); expect(downloads[1]).toMatch(/\.json$/);
    await click('Delete project'); await click('Cancel'); expect((await loadEngineeringProject(id)).records).toHaveLength(1);
    await click('Delete project'); await click('Delete complete project'); await until(() => deleted.mock.calls.length === 1);
    await expect(loadEngineeringProject(id)).rejects.toThrow('no longer exists');
    expect(JSON.parse(localStorage.getItem('xhandle.projects')).some(project => project.id === 'p')).toBe(true);
  } finally {
    window.removeEventListener('xhandle:create-traceability-matrix', createMatrix);
    URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke;
  }
});
