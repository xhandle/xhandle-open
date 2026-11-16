import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import TraceabilityProfilesDialog from './TraceabilityProfilesDialog';
import TraceabilityTable from './TraceabilityTable';
import TraceabilityMatrix from './TraceabilityMatrix';
import MatrixSetupFields from './MatrixSetupFields';
import LineageSourceFields from './LineageSourceFields';
import DerivationMatrixTable from './DerivationMatrixTable';
import { ArtifactCreateDialog } from '../artifacts/ArtifactWorkspace';
import { createMatrix, profiles } from './traceabilityRepository';
import { writeArtifactStorage, loadArtifact } from '../artifacts/artifactRepository';
import { DEFAULT_PROFILE } from './traceabilityModel';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));
let host, root;
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text);
async function until(check) { for (let i = 0; i < 300; i++) { if (check()) return; await act(async () => new Promise(resolve => setTimeout(resolve, 5))); } throw Error(host.textContent); }
async function openMatrixActions() {
  await until(() => button('Matrix actions'));
  if (button('Matrix actions').getAttribute('aria-expanded') === 'false') await act(async () => button('Matrix actions').click());
}
async function click(text) { if (!button(text) && button('Matrix actions')) await openMatrixActions(); const group = button(text)?.closest('details.design-action-group'); if (group && !group.open) await act(async () => group.querySelector('summary').click()); await act(async () => button(text).click()); }
function input(label, value) {
  const element = [...document.querySelectorAll('label')].find(item => [...item.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('') === label)?.querySelector('input,textarea,select');
  if (!element) throw Error('Missing field ' + label);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Controller' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Specifications', modules: [] }]));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const programId = 'se-project:fixture';
async function projectMembers(ids) {
  return writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), before = await store.get(programId);
    const members = [...(before?.members || [])];
    for (const id of ids) {
      const meta = await store.get(id);
      await store.put({ ...meta, programId, projectId: programId, workspaceType: 'systems-engineering' });
      if (!members.some(member => member.id === id)) members.push({ id, config: meta.config, dependsOn: [] });
    }
    const program = { ...before, id: programId, title: 'Controller engineering', recordType: 'systems-engineering-project', folderId: 'f', ownerProjects: [{ id: 'p', workspaceType: 'functional' }], config: { projectId: 'p', workspaceType: 'functional', system: 'Controller' }, members, version: (before?.version || 0) + 1, state: 'draft' };
    await store.put(program); return program;
  });
}
async function seed() {
  await writeArtifactStorage(['metadata', 'revisions'], async tx => {
    for (const [id, templateId] of [['system', 'system-spec'], ['software', 'software-spec']]) {
      await tx.objectStore('metadata').put({ id, title: id, projectId: 'p', workspaceType: 'functional', templateId, revision: 1, config: { projectId: 'p', workspaceType: 'functional' } });
      await tx.objectStore('revisions').put({ id: `${id}:1`, artifactId: id, number: 1, objects: [{ id: `${id}-1`, title: `${id} command`, text: 'The controller shall reject invalid commands.', kind: 'requirement', sourceIds: [] }], sources: { entries: [] } });
    }
  });
  await projectMembers(['system', 'software']);
  return createMatrix({ title: 'Command traceability', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Controller', scopeId: programId, stage: 'definition', profile: { id: DEFAULT_PROFILE.id, version: 1 }, bindings: { software: ['software'], system: ['system'] } });
}
function Setup({ owner = { id: programId, recordType: 'systems-engineering-project' }, initialBindings = {} }) {
  const [config, setConfig] = React.useState({ profile: { id: DEFAULT_PROFILE.id, version: 1 }, bindings: initialBindings, scopeId: owner?.scopeId });
  return <MatrixSetupFields owner={owner} config={config} onChange={patch => setConfig(current => ({ ...current, ...patch }))} />;
}
test('suggest bindings refreshes project members, reveals matches and keeps manual selections', async () => {
  await seed();
  await act(async () => root.render(<Setup initialBindings={{ system: ['manually-selected'] }} />));
  await until(() => button('Suggest role bindings from this project') && !button('Suggest role bindings from this project').disabled);
  // Added after the modal was opened: the catalog must be refreshed on click.
  await writeArtifactStorage(['metadata'], tx => tx.objectStore('metadata').put({ id: 'new-member', title: 'New safety requirements', templateId: 'safety-requirements', projectId: 'se-project:one', workspaceType: 'systems-engineering', programId, config: { projectId: 'p', workspaceType: 'functional' } }));
  await projectMembers(['new-member']);
  await click('Suggest role bindings from this project');
  await until(() => host.textContent.includes('Found 3 matching artifacts across 3 roles. Added 3 role bindings.'));
  expect(host.textContent).toContain('System requirement · 2 bound artifact(s)');
  expect(host.querySelectorAll('details[open]')).toHaveLength(3);
  expect([...host.querySelectorAll('details[open] input:checked')].map(input => input.parentElement.textContent)).toEqual(expect.arrayContaining(['system (system-spec)', 'software (software-spec)', 'New safety requirements (safety-requirements)']));
  await click('Suggest role bindings from this project');
  await until(() => host.textContent.includes('All suggested bindings are already selected.'));
  expect(host.textContent).toContain('System requirement · 2 bound artifact(s)');
});
test('suggest bindings explains empty matches and requires an owning project', async () => {
  await seed();
  await writeArtifactStorage(['metadata'], tx => tx.objectStore('metadata').put({ id: 'empty', recordType: 'systems-engineering-project', members: [] }));
  await act(async () => root.render(<Setup owner={{ id: 'empty', recordType: 'systems-engineering-project' }} />));
  await until(() => button('Suggest role bindings from this project'));
  await click('Suggest role bindings from this project');
  await until(() => host.textContent.includes('No matching artifacts were found for this project and profile.'));
  await act(async () => root.render(<Setup owner={null} />));
  await until(() => button('Suggest role bindings from this project').disabled);
  expect(host.textContent).toContain('Choose an owning project');
});
test('configuring a program matrix suggests only that program rather than other projects with the same owner', async () => {
  await seed();
  await writeArtifactStorage(['metadata'], async tx => {
    await tx.objectStore('metadata').put({ id: 'se-project:one', recordType: 'systems-engineering-project', members: [{ id: 'system' }] });
    for (const [id, programId] of [['system', 'se-project:one'], ['software', 'se-project:two']]) {
      const meta = await tx.objectStore('metadata').get(id);
      await tx.objectStore('metadata').put({ ...meta, projectId: programId, workspaceType: 'systems-engineering', programId });
    }
  });
  await act(async () => root.render(<Setup owner={{ projectId: 'p', workspaceType: 'functional', scopeId: 'se-project:one' }} />));
  await until(() => button('Suggest role bindings from this project'));
  await click('Suggest role bindings from this project');
  await until(() => host.textContent.includes('Found 1 matching artifact across 1 role.'));
  expect(host.textContent).toContain('System requirement · 1 bound artifact(s)');
  expect(host.textContent).toContain('Software requirement · 0 bound artifact(s)');
});
test('project matrix creation fixes its project and destination and registers the artifact', async () => {
  await seed(); const program = await projectMembers([]), created = jest.fn();
  await act(async () => root.render(<ArtifactCreateDialog matrixProject={program} onClose={() => {}} onCreated={created} />));
  await until(() => button('Create matrix') && !button('Create matrix').disabled);
  expect(host.textContent).toContain('Project: Controller engineering');
  expect([...host.querySelectorAll('label')].some(label => label.textContent.startsWith('Owning project'))).toBe(false);
  expect(host.querySelector('select').options).toHaveLength(1);
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length > 0);
  const record = await loadArtifact(created.mock.calls[0][0]);
  expect(record.meta).toMatchObject({ programId, projectId: programId, workspaceType: 'systems-engineering', folderId: 'f' });
  expect(record.meta.config.scopeId).toBe(programId);
  expect((await projectMembers([])).members.some(member => member.id === record.meta.id)).toBe(true);
});
test('profile rules and scheme share edits; publishing creates a selectable immutable version', async () => {
  await act(async () => root.render(<TraceabilityProfilesDialog onClose={() => {}} />));
  await click('Duplicate profile'); await act(async () => input('Profile name', 'Customer controller profile'));
  await click('Scheme');
  await act(async () => host.querySelector('.trace-scheme-edge').click());
  expect(host.querySelector('details[open] summary').textContent).toContain('system-origin');
  await act(async () => input('Minimum outgoing', '2'));
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => host.textContent.includes('Profile version published'));
  const saved = (await profiles()).find(profile => profile.name === 'Customer controller profile');
  expect(saved.rules[0].minSource).toBe(2); expect(saved.id).not.toBe(DEFAULT_PROFILE.id);
  expect(DEFAULT_PROFILE.rules[0].minSource).toBe(1);
  expect(host.querySelector('.design-dialog-footer').textContent).toContain('Publish profile version');
});
test('every coverage column has searchable multiselect filters and filters do not change source rows', async () => {
  const rows = [{ id: 'a', ID: 'A', Status: 'Missing' }, { id: 'b', ID: 'B', Status: 'Covered' }, { id: 'c', ID: 'C', Status: 'Missing' }];
  await act(async () => root.render(<TraceabilityTable columns={['ID', 'Status']} rows={rows} />));
  await click('Filter Status');
  expect(document.querySelector('[aria-label="Search Status values"]')).not.toBeNull();
  await click('Deselect all');
  await act(async () => [...document.querySelectorAll('[role="dialog"] label')].find(label => label.textContent === 'Missing').querySelector('input').click());
  await click('Done'); expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  await click('Filter ID'); await click('Select all'); await click('Done'); expect(rows).toHaveLength(3);
  await click('Clear filters'); expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
});
test('standalone artifact generation does not offer traceability matrices', async () => {
  await act(async () => root.render(<ArtifactCreateDialog onClose={() => {}} onCreated={() => {}} />));
  expect([...host.querySelector('select').options].map(option => option.value)).not.toContain('traceability-matrix');
  expect(button('Create matrix')).toBeUndefined();
});
test('matrix displays missing coverage, source navigation and immutable saved revisions', async () => {
  const id = await seed(), open = jest.fn();
  await act(async () => root.render(<TraceabilityMatrix id={id} onDeleted={() => {}} onOpenArtifact={open} />));
  await openMatrixActions(); await until(() => button('Save assessment revision') && !button('Save assessment revision').disabled);
  await click('Advanced controls'); await click('Coverage'); expect(host.textContent).toContain('Missing');
  await act(async () => host.querySelector('.trace-object-link').click()); expect(open).toHaveBeenCalled();
  await click('Save assessment revision'); await until(() => host.querySelector('option[value="1"]'));
  await act(async () => input('Assessment revision', '1')); expect(button('Add relationship').disabled).toBe(true);
  expect(host.textContent).toContain('Profile, source identities and relationships are pinned');
});
test('the default matrix is the same simple derivation table used in Code-Based Architecture', async () => {
  const id = await seed();
  await act(async () => root.render(<TraceabilityMatrix id={id} onDeleted={() => {}} onOpenArtifact={() => {}} />));
  await until(() => host.querySelector('.trace-linear-matrix th'));
  const headers = [...host.querySelectorAll('.trace-linear-matrix th')].map(node => node.textContent);
  expect(headers.join(' ')).toMatch(/Functional decomposition.*Hazard analysis.*Software safety requirements.*System requirements.*Software requirements.*Hardware requirements.*Subsystem requirements.*Design details/);
  expect(host.textContent).toContain('Safety carry-forward');
  expect(button('Add relationship')).toBeUndefined(); expect(button('Configure matrix')).toBeUndefined();
  expect(button('Refresh Traceability')).toBeUndefined(); expect(button('Matrix actions')).toBeDefined(); expect(host.textContent).toContain('Open:');
});
test('derivation cells keep a source identity intact when an artifact title contains commas', async () => {
  const label = 'Controller, West · SWR-1', node = { id: 'exact-object', artifactId: 'software', objectId: 'req-1' }, open = jest.fn();
  const lineage = { nodes: [node], rows: [{ id: 'chain', traceChainId: 'TRACE-0001', software: label, cellNodes: { software: { [label]: node.id } } }], summary: { chains: 1, complete: 0, open: 1 }, stageCounts: {} };
  await act(async () => root.render(<DerivationMatrixTable lineage={lineage} identity="comma-title" onOpen={open} />));
  await until(() => button(label)); await click(label); expect(open).toHaveBeenCalledWith(node);
});
test('explicit configuration changes require an impact preview and review before applying', async () => {
  const id = await seed();
  await act(async () => root.render(<TraceabilityMatrix id={id} onDeleted={() => {}} onOpenArtifact={() => {}} />));
  await openMatrixActions(); await until(() => button('Advanced controls')); await click('Advanced controls'); await click('Select sources');
  await until(() => button('Apply configuration'));
  expect(button('Apply configuration').disabled).toBe(true);
  await click('Preview source changes'); await until(() => host.textContent.includes('Impact preview:'));
  await act(async () => [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].find(input => input.parentElement.textContent.includes('I reviewed the selected sources')).click());
  await until(() => !button('Apply configuration').disabled);
  await click('Apply configuration'); await until(() => !document.querySelector('[aria-label="Configure traceability matrix"]'));
});

test('an unavailable profile can be replaced without losing the matrix or its saved history', async () => {
  const id = await seed();
  await writeArtifactStorage(['metadata'], async tx => { const meta = await tx.objectStore('metadata').get(id); await tx.objectStore('metadata').put({ ...meta, config: { ...meta.config, profile: { id: 'missing-profile', version: 1 } } }); });
  await act(async () => root.render(<TraceabilityMatrix id={id} onDeleted={() => {}} onOpenArtifact={() => {}} />));
  await until(() => host.textContent.includes('profile version is unavailable'));
  await click('Advanced controls'); await click('Select sources');
  await act(async () => input('Traceability profile', `${DEFAULT_PROFILE.id}@1`));
  await until(() => host.textContent.includes('Software requirement · 1 bound artifact'));
  await click('Preview source changes'); await until(() => host.textContent.includes('Impact preview:'));
  await act(async () => [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].find(input => input.parentElement.textContent.includes('I reviewed the selected sources')).click());
  await until(() => !button('Apply configuration').disabled); await click('Apply configuration');
  await until(() => !document.querySelector('[aria-label="Configure traceability matrix"]'));
  await openMatrixActions(); await until(() => !button('Save assessment revision').disabled);
  expect((await loadArtifact(id)).meta.config.profile.id).toBe(DEFAULT_PROFILE.id);
});


test('both source pickers offer only member artifacts, even when external artifacts share source owners and folders', async () => {
  await seed();
  await writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), original = await store.get('system');
    await store.put({ ...original, id: 'foreign', title: 'Foreign system artifact', programId: 'other-program' });
    await store.put({ ...original, id: 'standalone', title: 'Standalone artifact', programId: undefined });
    await store.put({ ...original, id: 'forged-member', title: 'Unregistered artifact' });
  });
  const config = { scopeId: programId, stage: 'definition', profile: { id: DEFAULT_PROFILE.id, version: 1 }, bindings: {} };
  await act(async () => root.render(<LineageSourceFields config={config} owner={{ id: programId, recordType: 'systems-engineering-project' }} onChange={() => {}} />));
  await until(() => [...host.querySelectorAll('.trace-source-stage label')].some(label => label.textContent === 'system'));
  expect(host.textContent).not.toContain('Foreign system artifact');
  expect(host.textContent).not.toContain('Standalone artifact');
  expect(host.textContent).not.toContain('Unregistered artifact');
  expect(host.textContent).toContain('software (software-spec)');
});


test('delete is available in the compact matrix actions and confirms before removing only the matrix', async () => {
  const id = await seed(), deleted = jest.fn();
  await act(async () => root.render(<TraceabilityMatrix id={id} onDeleted={deleted} onOpenArtifact={() => {}} />));
  await openMatrixActions(); await until(() => button('Save assessment revision') && !button('Save assessment revision').disabled);
  await click('Save assessment revision');
  await openMatrixActions(); await until(() => !button('Delete matrix').disabled);
  expect(button('Add relationship')).toBeUndefined();
  await click('Delete matrix');
  expect(host.querySelector('[aria-label="Delete traceability matrix"] .design-dialog-footer')).not.toBeNull();
  await click('Cancel'); expect((await loadArtifact(id)).meta.revision).toBe(1); expect(deleted).not.toHaveBeenCalled();
  await click('Delete matrix'); await click('Delete matrix and assessments');
  await until(() => deleted.mock.calls.length === 1);
  await expect(loadArtifact(id)).rejects.toThrow('no longer exists');
  expect((await loadArtifact('software')).meta.id).toBe('software'); expect((await loadArtifact('system')).meta.id).toBe('system');
  expect((await projectMembers([])).members.some(member => member.id === id)).toBe(false);
});
