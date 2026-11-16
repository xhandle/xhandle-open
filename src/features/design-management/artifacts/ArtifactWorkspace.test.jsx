import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID, webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { ARTIFACT_TEMPLATES, ENGINEERING_ARTIFACT_TYPES, validateSection } from './artifactModel';
import { generateArtifact } from './artifactGeneration';
import { ArtifactCreateDialog, ArtifactEditor } from './ArtifactWorkspace';
import { acceptProposal, checkpointJob, createArtifact, loadArtifact, openArtifactDatabase, saveObjects, startProposal } from './artifactRepository';
import * as artifactExports from './artifactExport';
import { saveProjectHazardAnalysisRecord } from '../../project-hazard-analysis/projectHazardAnalysisStorage';
import { HAZARD_TRACKING_TABLE_COLUMNS } from './hazardTrackingFields';
import * as safetyIssues from '../../project-hazard-analysis/safetyIssueGeneration';
import { fixtureSafetyIssues } from '../../project-hazard-analysis/testHelpers/safetyIssueFixtures';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: { 'x-ai-model': 'fixture' } }) }));
let root, host;
const config = { templateId: 'conops', title: 'Mission ConOps', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Mission', sources: [], notes: 'Operators request an observation.' };
const buttons = () => [...document.querySelectorAll('button')];
const button = text => buttons().find(b => b.textContent === text || b.getAttribute('aria-label') === text || b.title === ({ Outline: 'Outline view', Table: 'Table view', Trace: 'Traceability view', Document: 'Document view' }[text] || text));
const openActions = async () => {
  await until(() => !!host.querySelector('[aria-label="Artifact actions"]'));
  const trigger = host.querySelector('[aria-label="Artifact actions"]');
  if (trigger.getAttribute('aria-expanded') === 'false') await act(async () => trigger.click());
};
const click = async text => {
  if (!button(text) && host.querySelector('[aria-label="Artifact actions"]')) await openActions();
  const group = button(text)?.closest('details.design-action-group');
  if (group && !group.open) await act(async () => group.querySelector('summary').click());
  await act(async () => button(text).click());
  await until(() => !host.querySelector('.design-view-scroll [role="progressbar"]'));
};
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await act(async () => { await new Promise(r => setTimeout(r, 5)); }); } throw new Error(host.textContent); }
function setField(label, value) {
  const element = [...host.querySelectorAll('label')].find(l => [...l.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('') === label).querySelector('input,textarea,select');
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
}
beforeEach(() => {
  jest.spyOn(safetyIssues, 'requestSafetyIssueConsolidation').mockImplementation(fixtureSafetyIssues);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.TextEncoder = TextEncoder;
  global.structuredClone = v => deserialize(serialize(v));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID, subtle: webcrypto.subtle } });
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Mission program' }])); localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [] }]));
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n' + JSON.stringify({ objects: [{ key: 'ops', kind: 'narrative', title: 'Operator activity', text: 'An operator requests an observation.', sourceIds: ['notes'] }] }) + '\n```' } }] }) }));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks(); });

test('the standalone generator chooses Software as the System source and System as the Hardware source for code projects', async () => {
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'code', name: 'Controller implementation', repos: [] }]));
  const db = await openArtifactDatabase();
  for (const [id, templateId] of [['code-software', 'software-spec'], ['code-system', 'system-spec']]) {
    await db.put('metadata', { id, templateId, title: id, revision: 1, config: { ...config, templateId, projectId: 'code', workspaceType: 'code-architecture' } });
    await db.put('revisions', { id: `${id}:1`, artifactId: id, number: 1, objects: [{ id: `${id}-r1`, kind: 'requirement', text: 'The controller shall reject invalid commands.', sourceIds: [] }] });
  }
  db.close();
  const created = jest.fn();
  await act(async () => root.render(<ArtifactCreateDialog activeFolderId="f" onClose={() => {}} onCreated={created} />));
  await act(async () => { setField('Owning project', 'code-architecture:code'); setField('System', 'Mission'); setField('Document type', 'system-spec'); });
  await until(() => !!host.querySelector('select option[value="code-software"]'));
  expect(host.textContent).toContain('Source Software Requirements Specification');
  expect(host.querySelector('textarea')).toBeNull();
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  expect((await loadArtifact(created.mock.calls[0][0])).job.sources.entries[0]).toMatchObject({ artifactId: 'code-software', templateId: 'software-spec' });
  await act(async () => setField('Document type', 'hardware-spec'));
  await until(() => !!host.querySelector('select option[value="code-system"]'));
  expect(host.textContent).toContain('Source System Requirements Specification');
  await act(async () => setField('System Requirements Specification', 'code-system'));
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 2);
  expect((await loadArtifact(created.mock.calls[1][0])).job.sources.entries[0]).toMatchObject({ artifactId: 'code-system', templateId: 'system-spec' });
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['conops', 'system-spec', 'software-spec', 'hardware-spec'])('%s is available in the standalone generator and creates a correctly typed draft', async templateId => {
  const template = ARTIFACT_TEMPLATES.find(item => item.id === templateId), created = jest.fn();
  const derived = ['software-spec', 'hardware-spec'].includes(templateId);
  if (derived) {
    const db = await openArtifactDatabase();
    await db.put('metadata', { id: 'system-input', templateId: 'system-spec', title: 'Mission System Requirements', revision: 1, config: { ...config, templateId: 'system-spec' } });
    await db.put('revisions', { id: 'system-input:1', artifactId: 'system-input', number: 1, objects: [{ id: 'system-r1', kind: 'requirement', title: '', text: 'The controller shall retain commands.', sourceIds: [] }] });
    db.close();
  }
  await act(async () => root.render(<ArtifactCreateDialog onClose={() => {}} onCreated={created} />));
  await act(async () => {
    setField('Document type', templateId); setField('Owning project', 'functional:p'); setField('Destination folder', 'f');
    setField('System', 'Mission'); if (!derived) setField('Source notes', 'The controller shall retain commands.');
  });
  if (derived) {
    await until(() => host.textContent.includes('Mission System Requirements'));
    expect(host.textContent).not.toContain('Source notes'); expect(host.textContent).not.toContain('Source diagrams');
  }
  expect([...host.querySelectorAll('input')].some(input => input.value === template.name)).toBe(true);
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  const saved = await loadArtifact(created.mock.calls[0][0]);
  expect(saved.meta).toMatchObject({ templateId, templateVersion: 1, title: template.name, revision: 0 });
  expect(saved.job.sources.entries.some(source => source.text?.includes('retain commands'))).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test('History shows the current draft and explains the absence of accepted revisions', async () => {
  const id = await createArtifact(config); await savedPartial(id);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!host.querySelector('.requirements-outline-panel [data-artifact-object-id]'));
  const row = [...host.querySelectorAll('.requirements-outline-panel [data-artifact-object-id]')].find(row => row.textContent.includes('Saved operational scenario'));
  await act(async () => row.click()); await click('History');
  await until(() => !!host.querySelector('[role="dialog"][aria-label="Object history"]'));
  const dialog = host.querySelector('[aria-label="Object history"]');
  expect(dialog.textContent).toContain('Current draft');
  expect(dialog.textContent).toContain('An operator requests an observation.');
  expect(dialog.textContent).toContain('No accepted revisions');
  await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('[aria-label="Object history"]')).toBeNull();
});

test.each(['Outline', 'Table', 'Trace'])('%s toolbar commands save their effects, preserve selection, and respect hierarchy boundaries', async view => {
  const id = await createArtifact(config); await generateArtifact(id);
  const { job } = await loadArtifact(id); await acceptProposal(id, 0, job.token);
  const original = await loadArtifact(id), first = original.revision.objects.find(object => object.kind !== 'section');
  const beta = { ...first, id: `${id}:beta`, title: 'Beta topic', order: 1 };
  const gamma = { ...first, id: `${id}:gamma`, title: 'Gamma topic', order: 2 };
  await saveObjects(id, 1, [...original.revision.objects, beta, gamma]);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!host.querySelector('.requirements-outline-panel [data-artifact-object-id]'));
  await click(view);
  const toolbar = title => host.querySelector(`.requirements-row-actions button[title="${title}"]`);
  const press = title => act(async () => toolbar(title).click());
  const selected = async objectId => {
    await until(() => !host.querySelector('.design-view-scroll [role="progressbar"]') && !!host.querySelector(`.design-view-scroll [data-artifact-object-id="${objectId}"]`));
    await act(async () => host.querySelector(`.design-view-scroll [data-artifact-object-id="${objectId}"]`).click());
    await until(() => !toolbar('Edit').disabled);
  };
  const saved = () => loadArtifact(id);
  const afterSave = async check => until(() => !host.querySelector('.design-view-scroll [role="progressbar"]') && check());
  await press('Clear selection'); expect(toolbar('Edit').disabled).toBe(true); expect(toolbar('History').disabled).toBe(true);
  await selected(beta.id); expect(toolbar('Edit').disabled).toBe(false);
  await press('History'); await until(() => !!host.querySelector('[aria-label="Object history"]'));
  expect(host.querySelector('[aria-label="Object history"]').textContent).toContain('Revision 2');
  await click('Close Object history');
  await until(() => !toolbar('Edit').disabled);
  await press('Edit'); await act(async () => setField('Content', `Reviewed in ${view}.`)); await click('Save object');
  await afterSave(() => !toolbar('Edit').disabled);
  expect((await saved()).revision.objects.find(object => object.id === beta.id).text).toBe(`Reviewed in ${view}.`);
  await press('Move up'); await afterSave(() => !toolbar('Edit').disabled);
  let current = await saved();
  expect(current.revision.objects.find(object => object.id === beta.id).order).toBe(0);
  expect(toolbar('Move up').disabled).toBe(true);
  expect(toolbar('Demote (indent)').disabled).toBe(true);
  await press('Move down'); await afterSave(() => !toolbar('Edit').disabled);
  expect((await saved()).revision.objects.find(object => object.id === beta.id).order).toBe(1);
  await press('Demote (indent)'); await afterSave(() => !toolbar('Edit').disabled);
  expect((await saved()).revision.objects.find(object => object.id === beta.id).parentId).toBe(first.id);
  await press('Promote (outdent)'); await afterSave(() => !toolbar('Edit').disabled);
  expect((await saved()).revision.objects.find(object => object.id === beta.id).parentId).toBe(first.parentId);
  await press('New child'); await act(async () => { setField('Title', 'Toolbar child'); setField('Content', 'Child content.'); }); await click('Save object');
  await afterSave(() => !toolbar('Edit').disabled);
  const child = (await saved()).revision.objects.find(object => object.title === 'Toolbar child'); expect(child.parentId).toBe(beta.id);
  await press('Insert table (renders in place of title)'); await click('Save');
  await afterSave(() => !toolbar('Edit').disabled);
  expect((await saved()).revision.objects.find(object => object.id === beta.id).content.type).toBe('table');
  const file = new File(['image fixture'], 'toolbar.png', { type: 'image/png' });
  await act(async () => {
    const input = host.querySelector('.requirements-row-actions input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(() => !host.querySelector('.design-view-scroll [role="progressbar"]') && !toolbar('Edit').disabled && !host.querySelector('[role="dialog"]'));
  await until(() => host.querySelector('[data-artifact-revision="10"]'));
  expect((await saved()).revision.objects.find(object => object.id === beta.id).content).toMatchObject({ type: 'image', image: { name: 'toolbar.png' } });
  await selected(child.id); await press('Delete');
  await until(() => toolbar('Edit').disabled && !host.querySelector('.design-view-scroll [role="progressbar"]'));
  expect((await saved()).revision.objects.find(object => object.id === child.id).deleted).toBe(true);
  await selected(first.parentId); expect(toolbar('Promote (outdent)').disabled).toBe(true);
  const beforeBoundary = (await saved()).meta.revision; await press('Promote (outdent)');
  expect((await saved()).meta.revision).toBe(beforeBoundary);
  await press('Clear selection'); expect(toolbar('History').disabled).toBe(true);
});

test('Outline and Table menus contain artifact commands and execute export, details, editing and baseline actions', async () => {
  const id = await createArtifact(config); await generateArtifact(id);
  const { job } = await loadArtifact(id); await acceptProposal(id, 0, job.token);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!host.querySelector('.requirements-native-views [data-artifact-object-id]'));
  await click('File');
  expect([...host.querySelectorAll('[role="menu"][aria-label="File"] button')].map(node => node.textContent)).toEqual(['Export as Word', 'Export as PDF', 'Export as Markdown', 'Download backup (JSON)', 'Create baseline…']);
  const exporter = jest.spyOn(artifactExports, 'exportArtifact').mockResolvedValue(undefined);
  await click('Export as Word'); await until(() => exporter.mock.calls.length === 1); expect(exporter.mock.calls[0][0]).toBe('docx');
  await click('File'); await until(() => !button('Create baseline…').disabled); await click('Create baseline…');
  await act(async () => setField('Name', 'Reviewed design'));
  await click('Save baseline'); await until(() => !host.querySelector('[aria-label="Create artifact baseline"]'));
  expect((await loadArtifact(id)).baselines.map(item => item.label)).toContain('Reviewed design');
  await click('Extras'); expect(host.querySelector('[role="menu"][aria-label="Extras"]').textContent).not.toContain('Duplicate Module');
  await until(() => !button('Edit document details').disabled); await click('Edit document details'); await act(async () => setField('Description', 'Reviewed operations scope.'));
  await click('Save details'); await until(() => !host.querySelector('[aria-label="Edit details"]'));
  expect((await loadArtifact(id)).meta.description).toBe('Reviewed operations scope.');
  await until(() => !!host.querySelector('.requirements-native-views [data-artifact-object-id]'));
  await act(async () => host.querySelector('.requirements-native-views [data-artifact-object-id]').click());
  await click('Arrange'); expect(button('Move Up').disabled).toBe(true); expect(button('Promote').disabled).toBe(true);
  expect(button('Move Down').disabled).toBe(false); await click('Move Down');
  await until(() => host.querySelector('[data-artifact-revision="2"]') && !host.querySelector('.design-view-scroll [role="progressbar"]'));
  await click('Edit'); await click('Edit Selected');
  await act(async () => setField('Content', 'Updated from the editor menu.')); await click('Save object');
  await until(() => host.querySelector('[data-artifact-revision="3"]'));
  expect((await loadArtifact(id)).revision.objects.some(object => object.text === 'Updated from the editor menu.')).toBe(true);
  await click('Table'); expect(host.querySelector('[data-menubar]')).not.toBeNull();
  await click('Document'); expect(host.querySelector('[data-menubar]')).toBeNull();
  await click('Trace'); expect(host.querySelector('[data-menubar]')).toBeNull();
});

test('standalone creation excludes project-only matrices and exposes document templates and requires explicit project and destination', async () => {
  const created = jest.fn();
  await act(async () => root.render(<ArtifactCreateDialog onClose={() => {}} onCreated={created} />));
  const options = [...host.querySelector('select').options];
  expect(options.map(option => option.textContent)).toEqual(['ConOps', 'Architecture', 'System Requirements Specification', 'Software Requirements Specification', 'Hardware Requirements Specification']);
  expect(options.map(option => option.value)).toEqual(ENGINEERING_ARTIFACT_TYPES.filter(template => template.id !== 'traceability-matrix').map(template => template.id));
  expect([...host.querySelectorAll('input')].some(input => input.value === 'ConOps')).toBe(true);
  await act(async () => { setField('Owning project', 'functional:p'); setField('Destination folder', 'f'); setField('System', 'Mission'); setField('Source notes', 'Operators request an observation.'); });
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length > 0);
  expect((await loadArtifact(created.mock.calls[0][0])).meta.config).toMatchObject({ projectId: 'p', folderId: 'f', system: 'Mission' });
  expect(fetch).not.toHaveBeenCalled();
});
test('HTL opens with exactly the requested columns and edits an initially blank field', async () => {
  await saveProjectHazardAnalysisRecord('p', { analysisResult: { Summary: [['Raw Analysis Row ID', 'Function', 'Hazard', 'Safety Constraint', 'Verification Method', 'Excluded debug'], ['R-1', 'Controller', 'Lost commands', 'Retain valid commands.', 'Fault injection', 'Excluded diagnostic data']] } });
  const id = await createArtifact({ ...config, templateId: 'hazard-tracking-list', notes: '' });
  await generateArtifact(id); const { job } = await loadArtifact(id); await acceptProposal(id, 0, job.token);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!host.querySelector('[aria-label="Hazard tracking assessments"] tbody tr'));
  expect(button('Outline')).toBeUndefined();
  expect(button('Document')).toBeUndefined();
  expect(button('Trace')).toBeUndefined();
  expect(host.querySelector('.design-view-tools')).toBeNull();
  expect([...host.querySelectorAll('[aria-label="Hazard tracking assessments"] th')].map(node => node.querySelector('button span').textContent)).toEqual(HAZARD_TRACKING_TABLE_COLUMNS);
  await act(async () => host.querySelector('[data-hazard-group] [aria-expanded="false"]').click());
  const cell = host.querySelector('[data-object-field="Operating Conditions"]');
  await act(async () => cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => setField('Operating Conditions', 'Heavy rain'));
  await click('Save object');
  await until(() => host.querySelector('[data-artifact-revision="2"]'));
  expect((await loadArtifact(id)).revision.objects.find(object => object.hazardTrackingRow).attributes['Operating Conditions']).toBe('Heavy rain');
  expect(host.textContent).not.toContain('Excluded diagnostic data');
});
test('the consolidate action resumes persisted comparisons after a provider error instead of starting over', async () => {
  const summary = [['Raw Analysis Row ID', 'Hazard'], ...Array.from({ length: 66 }, (_, index) => [`R-${index}`, `Brake command unavailable at actuator number ${index}`])];
  await saveProjectHazardAnalysisRecord('p', { analysisResult: { Summary: summary } });
  const id = await createArtifact({ ...config, templateId: 'hazard-tracking-list', notes: '' });
  const request = safetyIssues.requestSafetyIssueConsolidation.mockImplementationOnce(fixtureSafetyIssues).mockRejectedValueOnce(new Error('Simulated provider interruption')).mockImplementation(fixtureSafetyIssues);
  await expect(generateArtifact(id)).rejects.toThrow('Simulated provider interruption');
  expect(Object.keys((await loadArtifact(id)).job.hazardSafetyIssues.rounds[0].completed)).toHaveLength(1);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!host.querySelector('[aria-label="Hazard tracking assessments"]'));
  expect(host.querySelector('[aria-label="Hazard tracking assessments"] th button span').textContent).toBe('HTR');
  await click('Consolidate into actionable HTRs');
  await openActions(); await until(() => document.querySelector('.artifact-actions-popover')?.textContent.includes('Review proposal'));
  expect(request.mock.calls[2][0].families[0].familyId).toBe('family-33:part-0');
  expect(request.mock.calls.length).toBeGreaterThan(3);
  const saved = await loadArtifact(id);
  expect(saved.job.state).toBe('ready'); expect(saved.job.hazardSafetyIssues.version).toBe(1);
  expect(saved.job.sections.s2.filter(object => object.hazardTrackingRow)).toHaveLength(66);
});
test('generation requires review, then supports manual edits and four canonical presentations', async () => {
  const id = await createArtifact(config);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await openActions();
  await until(() => !!button('Generate / resume draft'));
  expect(button('Accept proposal')).toBeUndefined();
  await click('Generate / resume draft'); await until(() => host.querySelector('[data-artifact-revision]') && !document.querySelector('.artifact-generation-summary')); await openActions(); await until(() => !!button('Review proposal'));
  expect(fetch).toHaveBeenCalledTimes(6); expect(button('Accept proposal')).toBeUndefined();
  await click('Review proposal'); await click('Accept proposal');
  await until(() => host.querySelector('[data-artifact-revision="1"]'));
  await click('Document');
  await act(async () => host.querySelector('.artifact-object-title button').click());
  await act(async () => setField('Content', 'Reviewed by the author.'));
  await act(async () => host.querySelector('.artifact-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => host.querySelector('[data-artifact-revision="2"]'));
  for (const name of ['Outline', 'Table', 'Document', 'Trace']) {
    await click(name); expect(button(name).getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.requirements-filter-bar')).toBeNull();
    if (name === 'Table') expect(host.querySelectorAll('.requirements-native-views tbody tr')).toHaveLength((await loadArtifact(id)).revision.objects.filter(object => !object.deleted).length);
  }
  const saved = await loadArtifact(id); expect(saved.revision.objects.some(o => o.text === 'Reviewed by the author.' && o.manual)).toBe(true);
  await click('Generate update'); await openActions(); await until(() => !!button('Review proposal')); await click('Review proposal'); await click('Accept proposal');
  await until(() => host.querySelector('[data-artifact-revision="3"]'));
  expect((await loadArtifact(id)).revision.objects.some(o => o.text === 'Reviewed by the author.')).toBe(true);
});

async function savedPartial(id) {
  const { job } = await loadArtifact(id);
  const sections = Object.fromEntries(ARTIFACT_TEMPLATES[0].sections.slice(0, 5).map(section => [section.id, validateSection({ objects: [{ key: 'saved', kind: 'narrative', title: 'Saved operational scenario', text: 'An operator requests an observation.', sourceIds: ['notes'] }] }, section, id, new Set(['notes']))]));
  return checkpointJob(id, job, { sections, state: 'paused', error: 'Unsupported claims must be represented as gaps.' });
}

test('five saved sections are visible after opening a paused draft and the last uncited section remains reviewable', async () => {
  const id = await createArtifact(config); await savedPartial(id);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!button('Document'));
  await click('Document');
  await until(() => !!host.querySelector('.artifact-paper'));
  await openActions();
  expect(document.body.textContent).toContain('Partial draft preview — 5 of 6 sections saved');
  expect(host.querySelector('.artifact-paper').textContent).toContain('Saved operational scenario');
  expect(host.textContent).not.toContain('Your document starts here');
  expect(button('Accept proposal')).toBeUndefined(); expect(host.querySelector('.artifact-object-title button').disabled).toBe(false);
  for (const view of ['Outline', 'Table']) { await click(view); expect(host.textContent).toContain('Saved operational scenario'); }
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'budget', kind: 'requirement', title: 'Timing budget', text: 'A timing budget is needed.', sourceIds: [] }] }) } }] }) }));
  await click('Generate / resume draft'); await until(() => host.querySelector('[data-artifact-revision]') && !document.querySelector('.artifact-generation-summary')); await openActions(); await until(() => !!button('Review proposal'));
  await until(() => host.textContent.includes('Unverified generated text:'));
  expect(fetch).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('Unverified generated text:');
  await click('Review proposal'); await click('Accept proposal'); await until(() => host.querySelector('[data-artifact-revision="1"]'));
  await click('Document'); expect(host.querySelector('.artifact-gap').textContent).toContain('no supporting source citation');
});

test('partial updates leave accepted content visible until preview is requested and cannot be accepted', async () => {
  const id = await createArtifact(config);
  await generateArtifact(id); const ready = await loadArtifact(id); await acceptProposal(id, 0, ready.job.token);
  await startProposal(id, 1); await savedPartial(id);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await openActions();
  await until(() => !!button('Preview saved sections'));
  await click('Document');
  expect(host.querySelector('.artifact-paper').textContent).toContain('Operator activity');
  expect(host.querySelector('.artifact-paper').textContent).not.toContain('Saved operational scenario');
  await click('Preview saved sections');
  expect(host.querySelector('.artifact-paper').textContent).toContain('Saved operational scenario');
  expect(host.querySelector('.artifact-paper').textContent).not.toContain('Operator activity');
  expect(button('Accept proposal')).toBeUndefined(); expect(host.querySelector('.artifact-object-title button').disabled).toBe(false);
  await click('Return to accepted document'); expect(host.querySelector('.artifact-paper').textContent).toContain('Operator activity');
});

test('the original requirements table retains columns, multi-selection, resizing, inline edits, rich tables and object history', async () => {
  const id = await createArtifact(config); await generateArtifact(id);
  const ready = await loadArtifact(id); await acceptProposal(id, 0, ready.job.token);
  const objectId = (await loadArtifact(id)).revision.objects[1].id;
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!button('Table')); await click('Table');
  const table = () => host.querySelector('.requirements-native-views table');
  expect([...table().querySelectorAll('thead th')].map(th => th.querySelector('button span').textContent)).toEqual(['ID', 'Title', 'Description', 'Kind', 'Status', 'Version', 'Updated', 'Links']);
  const row = () => [...table().querySelectorAll('tbody tr')].find(tr => tr.querySelector(`[title="${objectId}"]`));
  const first = table().querySelector('tbody tr');
  await act(async () => { first.dispatchEvent(new MouseEvent('click', { bubbles: true })); row().dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); });
  expect(table().querySelectorAll('tbody tr[aria-selected="true"]')).toHaveLength(2);
  const handle = table().querySelector('[aria-label="Resize column Title"]');
  await act(async () => { handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 })); window.dispatchEvent(new MouseEvent('mousemove', { clientX: 160 })); window.dispatchEvent(new MouseEvent('mouseup')); });
  expect(JSON.parse(localStorage.getItem('xhandle:table-colwidths:Mission ConOps')).title).toBe(400);
  await act(async () => { const status = row().querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(status, 'Approved'); status.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(() => host.querySelector('[data-artifact-revision="2"]'));
  await until(() => !!table());
  expect((await loadArtifact(id)).revision.objects.find(o => o.id === objectId).status).toBe('Approved');
  await act(async () => row().querySelector('[title="Double-click to edit title"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => { const input = row().querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Reviewed operator activity'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => row().querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await until(() => host.querySelector('[data-artifact-revision="3"]'));
  await until(() => !!table());
  expect((await loadArtifact(id)).revision.objects.find(o => o.id === objectId)).toMatchObject({ title: 'Reviewed operator activity', manual: true });
  await click('Insert table (renders in place of title)'); await click('Save');
  await until(() => host.querySelector('[data-artifact-revision="4"]'));
  await until(() => !!table());
  expect((await loadArtifact(id)).revision.objects.find(o => o.id === objectId).content.type).toBe('table');
  await act(async () => row().querySelector('table').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(host.querySelector('.xhandle-modal-viewport').textContent).toContain('Edit Table');
  await click('Save'); await until(() => host.querySelector('[data-artifact-revision="5"]'));
  await until(() => !!table());
  await click('History'); await until(() => host.textContent.includes('Object history'));
  expect(host.querySelector('.xhandle-modal-viewport').textContent).toContain('Revision 1');
});

test.each(['functional', 'logical', 'physical'])('%s architecture creation selects a typed diagram and level without requiring notes or modules', async kind => {
  const created = jest.fn();
  localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { responseRows: [{ id: 'edge', fromFunction: 'Operator', toFunction: 'Vehicle', controlAction: 'Request operation' }] } }));
  await act(async () => root.render(<ArtifactCreateDialog onClose={() => {}} onCreated={created} />));
  await act(async () => { setField('Document type', 'architecture'); setField('Owning project', 'functional:p'); setField('Destination folder', 'f'); setField('System', 'Mission'); });
  await act(async () => setField('Architecture type', kind));
  const diagrams = [...host.querySelectorAll('fieldset')].find(field => field.querySelector('legend')?.textContent === 'Source diagrams');
  await act(async () => diagrams.querySelector('input[type=checkbox]').click());
  const level = diagrams.querySelector('select');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(level, '2'); level.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length === 1);
  const data = await loadArtifact(created.mock.calls[0][0]);
  expect(data.meta.config.architectureKind).toBe(kind); expect(data.job.sources.entries[0].level).toBe('2'); expect(fetch).not.toHaveBeenCalled();
});


test('a condensed draft exposes coverage counts and the complete readable source register', async () => {
  const id = await createArtifact(config); await generateArtifact(id);
  const { job } = await loadArtifact(id);
  await checkpointJob(id, job, { evidenceBrief: { version: 1, sourceHash: job.sources.hash, rounds: [] } });
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await openActions();
  await click('Review proposal');
  await until(() => !!button('View document and source register'));
  expect(document.body.textContent).toContain('1 of 1 sources are cited; 0 are not cited');
  expect(document.body.textContent).toContain('A citation alone does not establish complete coverage');
  await click('View document and source register');
  expect(button('Document').getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('.artifact-paper').textContent).toContain('Source register');
  expect(host.querySelector('.artifact-paper').textContent).toContain('Operators request an observation.');
});

test('choosing a code project for Architecture exposes all five abstraction levels and persists the choice', async () => {
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'code', name: 'Implementation', repos: [{ id: 'repo', repoName: 'Controller' }] }]));
  const { writeCbaRowsToIndexedDB } = await import('../../code-architecture-assurance/codeArchitectureStorage');
  expect(await writeCbaRowsToIndexedDB('cba:code:repo', [{ fromFunction: 'Sense', toFunction: 'Brake', fromArchitecture: { subsystem: 'Control' }, toArchitecture: { subsystem: 'Actuation' } }])).toBe(true);
  const created = jest.fn();
  await act(async () => root.render(<ArtifactCreateDialog onClose={() => {}} onCreated={created} />));
  await act(async () => { setField('Document type', 'architecture'); setField('Owning project', 'code-architecture:code'); setField('Destination folder', 'f'); setField('System', 'Vehicle'); });
  expect([...host.querySelectorAll('select')].some(select => select.value === 'code-based')).toBe(true);
  await act(async () => [...host.querySelectorAll('fieldset')].find(field => field.querySelector('legend')?.textContent === 'Source diagrams').querySelector('input[type=checkbox]').click());
  const select = [...host.querySelectorAll('label')].find(label => label.textContent.startsWith('Abstraction level — Implementation')).querySelector('select');
  expect([...select.options].map(option => option.textContent)).toEqual(['Subsystem', 'CSCI', 'CSC', 'CSU', 'Functional']);
  expect(select.value).toBe('csu');
  await act(async () => setField('Abstraction level — Implementation', 'subsystem'));
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => created.mock.calls.length > 0);
  const saved = await loadArtifact(created.mock.calls[0][0]);
  expect(saved.meta.config.architectureSources[0].abstraction).toBe('subsystem');
  expect(saved.job.sources.entries.find(source => source.snapshot).snapshot.nodes).toHaveLength(2);
  expect(fetch).not.toHaveBeenCalled();
});


test('document details support cancel, save and reopening without regenerating a draft', async () => {
  const id = await createArtifact(config);
  const before = await loadArtifact(id);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await openActions();
  await until(() => !!button('Edit details'));
  await click('Edit details');
  await act(async () => { setField('Title', 'Cancelled title'); setField('Description', 'Discard this.'); });
  await click('Cancel');
  expect((await loadArtifact(id)).meta.title).toBe(config.title);
  await click('Edit details');
  await act(async () => { setField('Title', 'Renamed mission'); setField('Description', 'Concise operational overview.'); });
  await act(async () => host.querySelector('.artifact-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await until(() => !host.querySelector('.artifact-modal'));
  expect(host.querySelector('.artifact-header').textContent).toContain('Renamed mission');
  expect(host.textContent).toContain('Concise operational overview.');
  const saved = await loadArtifact(id);
  expect(saved.job).toEqual(before.job);
  expect(saved.meta.config.title).toBe('Renamed mission');
  expect(fetch).not.toHaveBeenCalled();
  await click('Edit details');
  expect(host.querySelector('.artifact-modal input').value).toBe('Renamed mission');
  expect(host.querySelector('.artifact-modal textarea').value).toBe('Concise operational overview.');
});


test('compact commands open a separate proposal review with comparisons, sources and acceptance', async () => {
  const id = await createArtifact(config); await generateArtifact(id);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!host.querySelector('[aria-label="Artifact actions"]'));
  const trigger = host.querySelector('[aria-label="Artifact actions"]');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.artifact-header').textContent).toBe(config.title + '…');
  expect(host.querySelector('.artifact-compact-status')).toBeNull();
  expect(document.querySelector('.artifact-job')).toBeNull();
  expect(document.body.textContent).not.toContain('object changes proposed.');
  expect(button('Edit details')).toBeUndefined();
  const reviewBar = host.querySelector('[aria-label="Document proposal review"]');
  expect(reviewBar).toBeNull(); expect(button('Review proposal')).toBeUndefined();
  expect(button('Accept proposal')).toBeUndefined();
  await openActions();
  const panel = document.querySelector('.artifact-actions-popover');
  expect(panel.parentElement).toBe(document.body);
  expect(document.activeElement).toBe(panel);
  expect(panel.textContent).toContain('Review proposal');
  expect(panel.textContent).not.toContain('object changes proposed.');
  expect(panel.querySelector('.artifact-job')).toBeNull();
  expect(panel.querySelector('.artifact-warning')).toBeNull();
  expect(panel.querySelectorAll('details.design-action-group[open]')).toHaveLength(0);
  for (const label of ['Edit details', 'Delete artifact', 'Source diagrams', 'Generate update']) expect(panel.contains(button(label))).toBe(true);
  expect(panel.textContent).not.toContain('Compare with accepted revision');
  await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('.artifact-actions-popover')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await openActions();
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await click('Review proposal');
  expect(document.querySelector('.artifact-actions-popover')).toBeNull();
  expect(host.querySelector('.requirements-native-views')).not.toBeNull();
  expect(button('Document').getAttribute('aria-pressed')).toBe('true');
  const dialog = document.querySelector('[aria-label="Document proposal review"]');
  expect(dialog.contains(button('Accept proposal'))).toBe(true);
  expect(dialog.textContent).toContain('object changes proposed.');
  expect(dialog.textContent).toContain('Compare with accepted revision');
  const before = (await loadArtifact(id)).job;
  await click('Accept proposal');
  await until(() => host.querySelector('[data-artifact-revision="1"]'));
  expect(host.querySelector('[aria-label="Document proposal review"]')).toBeNull();
  const saved = await loadArtifact(id);
  expect(saved.revision.objects.map(object => object.status)).toEqual(Object.values(before.sections).flat().map(object => object.status));
  expect(saved.job).toBeFalsy();
});

test.each(['Outline', 'Table', 'Trace', 'Document'])('%s supports double-click and context-menu editing of saved draft objects', async view => {
  const id = await createArtifact(config); await generateArtifact(id);
  const original = await loadArtifact(id);
  const object = Object.values(original.job.sections).flat().find(o => o.kind === 'narrative');
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!button(view)); await click(view);
  const area = () => host.querySelector(`[data-artifact-object-id="${object.id}"]`);
  await until(() => !!area());
  const target = view === 'Table' || view === 'Document' ? area().querySelector('[data-object-field="Description"]') : area();
  await act(async () => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(host.querySelector('[aria-label="Edit artifact object"]')).not.toBeNull();
  if (['Table', 'Document'].includes(view)) expect(document.activeElement.tagName).toBe('TEXTAREA');
  await act(async () => setField('Content', `Edited in ${view}`));
  await click('Save object');
  await until(() => !host.querySelector('[aria-label="Edit artifact object"]'));
  let saved = await loadArtifact(id);
  expect(saved.meta.revision).toBe(0);
  expect(Object.values(saved.job.sections).flat().find(o => o.id === object.id)).toMatchObject({ text: `Edited in ${view}`, manual: true });
  await until(() => !!area());
  await act(async () => area().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 })));
  expect(document.querySelector('.artifact-object-menu')).not.toBeNull();
  expect(document.activeElement.textContent).toBe('Edit object');
  await click('Edit object');
  await act(async () => setField('Title', `Reviewed in ${view}`));
  await click('Save object');
  await until(() => !host.querySelector('[aria-label="Edit artifact object"]'));
  saved = await loadArtifact(id); await act(async () => acceptProposal(id, 0, saved.job.token));
  expect((await loadArtifact(id)).revision.objects.find(o => o.id === object.id)).toMatchObject({ title: `Reviewed in ${view}`, text: `Edited in ${view}`, manual: true });
});

test('Safety Requirements table shows individual editable children under their original topic title', async () => {
  await saveProjectHazardAnalysisRecord('p', { analysisResult: { Summary: [['Hazard', 'Safety Constraint', 'Guide Phrase Applicable'], ['Expired command', 'Reject expired commands.', 'Yes']] } });
  const htl = await createArtifact({ ...config, templateId: 'hazard-tracking-list' });
  await generateArtifact(htl);
  const id = await createArtifact({ ...config, templateId: 'safety-requirements', title: 'Safety Requirements', hazardTrackingArtifactId: htl });
  await generateArtifact(id, { request: async ({ section, sources }) => ({ objects: section.id === 's2' ? [{ key: 'command-validity', kind: 'requirement', title: 'Command validity', text: 'The controller shall reject expired commands.', sourceIds: sources.entries.filter(source => source.sourceType === 'hazard-tracking-record').map(source => source.id) }] : [{ key: 'context', kind: 'narrative', title: section.title, text: 'Consolidated safety concern coverage for review.', sourceIds: sources.entries.filter(source => source.sourceType === 'hazard-tracking-record').map(source => source.id) }] }) });
  const legacy = (await loadArtifact(id)).job;
  await checkpointJob(id, legacy, { sections: { ...legacy.sections, s2: legacy.sections.s2.map(object => object.kind === 'requirement' ? { ...object, text: 'The controller shall reject expired commands and shall report the rejection. The controller shall retain the last valid command.' } : object) } });
  const initial = await loadArtifact(id);
  const topic = initial.job.sections.s2.find(object => object.title === 'Command validity');
  const children = initial.job.sections.s2.filter(object => object.parentId === topic.id);
  expect(children).toHaveLength(3);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!button('Table')); await click('Table');
  const row = objectId => host.querySelector(`[data-artifact-object-id="${objectId}"]`);
  await until(() => !!row(children[1].id));
  expect(row(topic.id).textContent).toContain('Command validity');
  expect(row(topic.id).textContent).toContain('2.1');
  expect(row(children[0].id).textContent).toContain('2.1.1');
  expect(row(children[1].id).textContent).toContain('2.1.2');
  expect(row(children[0].id).children[1].textContent.trim()).toBe('2.1.1');
  expect(row(children[1].id).children[1].textContent.trim()).toBe('2.1.2');
  expect(row(children[0].id).querySelector('[data-object-field="Description"]').textContent).toBe(children[0].text);
  expect(host.querySelector('.requirements-native-views thead').textContent).not.toContain('Requirement Text');
  await act(async () => row(children[1].id).querySelector('[data-object-field="Description"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => setField('Content', 'The controller shall report the rejection to the operator.'));
  await click('Save object');
  await until(() => !host.querySelector('[aria-label="Edit artifact object"]'));
  const saved = await loadArtifact(id);
  expect(saved.job.sections.s2.find(object => object.id === children[1].id)).toMatchObject({ text: 'The controller shall report the rejection to the operator.', manual: true, parentId: topic.id });
  expect(saved.job.sections.s2.find(object => object.id === topic.id)).toEqual(topic);
  expect(saved.job.sections.s2.find(object => object.id === children[0].id)).toEqual(children[0]);
});

test('architecture description paragraphs can be edited in the document and accepted without changing the diagram', async () => {
  localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { responseRows: [{ id: 'edge', fromFunction: 'Operator', toFunction: 'Vehicle', controlAction: 'Request operation' }] } }));
  const id = await createArtifact({ ...config, templateId: 'architecture', architectureKind: 'system', architectureSources: [{ projectId: 'p', workspaceType: 'functional', level: '1' }] });
  await generateArtifact(id);
  const before = await loadArtifact(id);
  await act(async () => root.render(<ArtifactEditor id={id} onDeleted={() => {}} />));
  await until(() => !!button('Document')); await click('Document');
  await until(() => !!host.querySelector('.architecture-description .artifact-object [data-object-field="Description"]'));
  const paragraph = host.querySelector('.architecture-description .artifact-object [data-object-field="Description"]');
  const objectId = paragraph.parentElement.dataset.artifactObjectId;
  await act(async () => paragraph.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await act(async () => setField('Content', 'The author describes this architecture in their own words.'));
  await click('Save object');
  await until(() => !host.querySelector('[aria-label="Edit artifact object"]'));
  await until(() => host.querySelector('.architecture-description')?.textContent.includes('The author describes this architecture in their own words.'));
  expect(host.querySelector('.architecture-description').textContent).toContain('The author describes this architecture in their own words.');
  const draft = await loadArtifact(id);
  expect(draft.meta.revision).toBe(0);
  expect(draft.job.sources).toEqual(before.job.sources);
  await act(async () => acceptProposal(id, 0, draft.job.token));
  const accepted = await loadArtifact(id);
  expect(accepted.revision.objects.find(object => object.id === objectId)).toMatchObject({ manual: true, text: 'The author describes this architecture in their own words.' });
});
