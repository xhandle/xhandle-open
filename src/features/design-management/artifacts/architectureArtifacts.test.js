import * as codeStorage from '../../code-architecture-assurance/codeArchitectureStorage';
import { processFunctionalModel } from '../../code-architecture-context/testSupport/functionalHierarchyFixture';
import { updateArchitectureSources } from './architectureSourceUpdates';
import { architectureSVG } from './architectureGraph';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { TextEncoder } from 'util';
import { randomUUID, webcrypto } from 'crypto';
import { architectureCatalog, architectureDiagram } from './architectureSources';
import { captureLiveSources } from './artifactSources';
import { createArtifact, loadArtifact, acceptProposal, startProposal, listArtifacts } from './artifactRepository';
import { generateArtifact } from './artifactGeneration';
import { refreshArtifactSources } from './artifactMaintenance';
import { createEngineeringProject, addArtifactToEngineeringProject, loadEngineeringProject, acceptEngineeringProject, exportEngineeringProject } from './engineeringProjectRepository';
import { generateEngineeringProject } from './engineeringProjectGeneration';
import { writeCbaRowsToIndexedDB } from '../../code-architecture-assurance/codeArchitectureStorage';
import { artifactRequirementRows } from './artifactRequirementsAdapter';
import { portableArtifact } from './artifactExport';
import { deleteArtifact, ARTIFACT_CHANGED } from './artifactRepository';
import { loadArchitecturePresentation, saveArchitecturePresentation, listArchitecturePresentations } from './architecturePresentation';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
const owner = { id: 'p', workspaceType: 'functional' };
const selected = { projectId: 'p', workspaceType: 'functional', level: '1' };
const config = { templateId: 'architecture', architectureKind: 'system', title: 'Vehicle architecture', projectId: 'p', workspaceType: 'functional', system: 'Vehicle', folderId: 'f', sources: [], architectureSources: [selected] };
const rows = [ { id: 'command', fromFunction: 'Sense', toFunction: 'Brake', controlAction: 'Stop command', subsystem: 'Control', fromDetails: 'Observes obstacles', toDetails: 'Controls braking', controlDetails: 'Requests braking' }, { id: 'feedback', fromFunction: 'Brake', toFunction: 'Sense', controlAction: 'Status', controlDetails: 'Reports status' } ];
const saveRows = value => localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { responseRows: value } }));
beforeEach(() => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID, subtle: webcrypto.subtle } });
  global.TextEncoder = TextEncoder;
  localStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Vehicle Level 1' }, { id: 'q', name: 'Other' }]));
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'p', name: 'Vehicle implementation', repos: [{ id: 'repo', repoName: 'controller' }] }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [] }])); saveRows(rows);
});
afterEach(() => jest.restoreAllMocks());
const response = ({ sources }) => ({ objects: [{ key: 'braking', title: 'Braking command', text: 'The system shall issue the stop command.', kind: 'requirement', sourceIds: [sources.entries.find(source => source.sourceType === 'architecture-element' && source.elementType === 'edge').id] }] });

test('the five-document project finishes after fifteen minutes and maintains accurate source freshness', async () => {
  const id = await createEngineeringProject({ name: 'Vehicle engineering', system: 'Vehicle', folderId: 'f', owners: [owner], sources: [], architectureSources: [selected], artifacts: [
    { templateId: 'architecture', architectureKind: 'functional' }, { templateId: 'conops' },
    { templateId: 'system-spec' }, { templateId: 'software-spec' }, { templateId: 'hardware-spec' },
  ] });
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
  const request = jest.fn(async args => {
    now += 90000;
    const source = args.sources.entries.find(source => source.sourceType === 'artifact-object' && source.kind === 'requirement')
      || args.sources.entries.find(source => source.sourceType === 'architecture-element' && source.elementType === 'edge');
    return { objects: [{ key: 'braking', title: 'Braking command', text: 'The system shall issue the stop command.', kind: 'requirement', sourceIds: [source.id] }] };
  });
  await generateEngineeringProject(id, { request });
  let data = await loadEngineeringProject(id);
  expect(data.program.state).toBe('ready');
  expect(request).toHaveBeenCalledTimes(24);
  expect(data.records.map(record => [record.meta.templateId, record.job.state])).toEqual([
    ['architecture', 'ready'], ['conops', 'ready'], ['system-spec', 'ready'], ['software-spec', 'ready'], ['hardware-spec', 'ready'],
  ]);
  await refreshArtifactSources();
  expect((await listArtifacts()).every(meta => meta.freshness === 'current')).toBe(true);
  await acceptEngineeringProject(id, data.program.version, data.program.runToken);
  await refreshArtifactSources(); data = await loadEngineeringProject(id);
  expect(data.records.every(record => record.meta.freshness === 'current')).toBe(true);
  const saved = data.records.map(record => record.revision);
  saveRows(rows.map((row, index) => index ? row : { ...row, controlDetails: 'Updated braking interface' }));
  await refreshArtifactSources(); data = await loadEngineeringProject(id);
  expect(data.records.some(record => record.meta.freshness === 'stale')).toBe(true);
  expect(data.records.map(record => record.revision)).toEqual(saved);
});

test('artifact arrangements persist independently of evidence and are removed with their artifact', async () => {
  const id = await createArtifact(config), otherId = await createArtifact(config);
  const before = await loadArtifact(id);
  const diagram = { id: 'diagram', diagramHash: 'saved-revision' };
  const presentation = { geometry: { component: { position: { x: 120, y: 80 }, width: 320, height: 180 } } };
  const changed = jest.fn();
  window.addEventListener(ARTIFACT_CHANGED, changed);
  try {
    await saveArchitecturePresentation(id, diagram, presentation);
    expect(await loadArchitecturePresentation(id, diagram)).toEqual(presentation);
    expect(await loadArchitecturePresentation(otherId, diagram)).toBeNull();
    expect(await loadArchitecturePresentation(id, { ...diagram, diagramHash: 'new-revision' })).toBeNull();
    expect(await loadArtifact(id)).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
    await deleteArtifact(id);
    expect(await listArchitecturePresentations(id)).toEqual([]);
    await expect(saveArchitecturePresentation(id, diagram, presentation)).rejects.toThrow('no longer exists');
  } finally { window.removeEventListener(ARTIFACT_CHANGED, changed); }
});

test('captures diagram, nodes, relationships, groups, level, and scoped owning project identities', async () => {
  localStorage.setItem('diagram:positions:p:groups:v1', JSON.stringify([{ id: 'group', label: 'Vehicle', description: 'System boundary', elementType: 'system' }]));
  localStorage.setItem('diagram:positions:p', JSON.stringify([['n:Sense', { position: { x: 5, y: 10 }, parentId: 'group' }]]));
  const routing = { defaultStyle: 'rectangular', manualRoutes: { command: { points: [{ x: 1, y: 2 }] } }, colors: { command: '#123456' } };
  localStorage.setItem('diagram:positions:p:edge-routing:v1', JSON.stringify(routing));
  const manifest = await captureLiveSources(config);
  expect(manifest.entries).toHaveLength(6);
  expect(manifest.entries[0].snapshot.native.storage[':edge-routing:v1']).toBe(JSON.stringify(routing));
  expect(manifest.entries[0].snapshot.native.rows).toEqual(rows);
  localStorage.setItem('diagram:positions:p:edge-routing:v1', JSON.stringify({ ...routing, colors: { command: '#abcdef' } }));
  expect((await captureLiveSources(config)).hash).not.toBe(manifest.hash);
  const node = manifest.entries.find(source => source.elementId === 'n:Sense');
  expect(node).toMatchObject({ level: '1', ownerProjects: [owner], element: { parentId: 'group' }, sourceType: 'architecture-element' });
  expect(manifest.entries[0].snapshot.edges.map(edge => edge.id)).toEqual(['command', 'feedback']);
  expect(architectureCatalog([owner, { id: 'p', workspaceType: 'code-architecture' }])).toHaveLength(2);
});
test('row reordering preserves identities while recording native presentation order; edits and scopes change sources', async () => {
  const first = await captureLiveSources(config); saveRows([...rows].reverse());
  const reordered = await captureLiveSources(config);
  expect(reordered.hash).not.toBe(first.hash);
  expect(reordered.entries.map(source => source.id).sort()).toEqual(first.entries.map(source => source.id).sort());
  expect(reordered.entries[0].snapshot.native.rows).toEqual([...rows].reverse());
  saveRows([{ ...rows[0], controlDetails: 'Changed command' }, rows[1]]);
  const changed = await captureLiveSources(config); expect(changed.hash).not.toBe(first.hash);
  expect(changed.entries.map(source => source.id).sort()).toEqual(first.entries.map(source => source.id).sort());
  const focused = await captureLiveSources({ ...config, architectureSources: [{ ...selected, focus: 'Control' }] });
  expect(focused.entries[0].snapshot.edges).toHaveLength(1);
  await expect(captureLiveSources({ ...config, architectureSources: [{ ...selected, focus: 'Absent' }] })).rejects.toThrow('no saved elements');
  saveRows([]); await expect(captureLiveSources(config)).rejects.toThrow('no saved diagram');
});
test('legacy relationship references do not depend on row offsets', () => {
  const source = { ...selected, label: 'Diagram' }, a = { fromFunction: 'A', toFunction: 'B', controlAction: 'Signal' }, b = { fromFunction: 'B', toFunction: 'C', controlAction: 'Forward' };
  const first = architectureDiagram(source, [a, b]), second = architectureDiagram(source, [b, a]);
  expect(first).toEqual(second);
});
test('rejects foreign, missing, duplicate and incompatible source selections', async () => {
  await expect(captureLiveSources({ ...config, architectureSources: [{ ...selected, projectId: 'q' }] })).rejects.toThrow('another owning project');
  await expect(captureLiveSources({ ...config, architectureSources: [selected, selected] })).rejects.toThrow('Duplicate');
  await expect(captureLiveSources({ ...config, architectureKind: 'code-based' })).rejects.toThrow('Code-Based');
  localStorage.setItem('xhandle.projectData', '{}'); await expect(captureLiveSources(config)).rejects.toThrow('unavailable');
});
test('architecture capture uses no AI, retains graph snapshots and native trace links, and detects source edits', async () => {
  const request = jest.fn(); const id = await createArtifact(config); await generateArtifact(id, { request });
  let data = await loadArtifact(id); expect(request).not.toHaveBeenCalled(); expect(data.job.state).toBe('ready');
  await acceptProposal(id, 0, data.job.token); data = await loadArtifact(id);
  expect(data.revision.objects.filter(o => o.kind === 'diagram')).toHaveLength(1);
  const projected = artifactRequirementRows(data.meta, data.revision, data.revision.objects, data.revision.sources);
  expect(projected.rows.some(row => row.links.length && row.kind === 'architecture-element')).toBe(true);
  expect(portableArtifact(data.meta, data.revision).revision.sources.entries[0].snapshot.edges).toHaveLength(2);
  saveRows([{ ...rows[0], controlDetails: 'Changed' }, rows[1]]); await refreshArtifactSources();
  expect((await loadArtifact(id)).meta.freshness).toBe('stale');
  expect(data.revision.sources.entries[0].snapshot.edges[0].details).toBe('Requests braking');
});
test('ordinary artifacts derive from precise diagram elements without source notes or modules', async () => {
  const id = await createArtifact({ ...config, templateId: 'system-spec' });
  await generateArtifact(id, { request: async args => response(args) });
  const data = await loadArtifact(id); await acceptProposal(id, 0, data.job.token);
  const saved = await loadArtifact(id);
  expect(saved.revision.objects.filter(o => o.kind === 'requirement').every(o => o.sourceEvidence[0].elementType === 'edge')).toBe(true);
  await startProposal(id, 1); await generateArtifact(id, { request: async args => response(args) });
  const update = await loadArtifact(id); saveRows([{ ...rows[0], controlAction: 'Emergency stop' }]);
  await expect(acceptProposal(id, 1, update.job.token)).rejects.toThrow('Sources changed');
  expect((await loadArtifact(id)).meta.revision).toBe(1);
});
test('code-based architecture reads published project/repository storage, excludes historical rows and validates lineage', async () => {
  const codeConfig = { ...config, architectureKind: 'code-based', workspaceType: 'code-architecture', architectureSources: [{ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo' }] };
  const codeRows = [{ ...rows[0], traceId: 'code:call', fromNodeId: 'symbol:sense', toNodeId: 'symbol:brake', fromFile: 'sense.cpp', lineage: { scope: 'cba:p:repo' } }, { ...rows[1], lineage: { status: 'historical' } }];
  await writeCbaRowsToIndexedDB('cba:p:repo', codeRows);
  const snapshot = await captureLiveSources(codeConfig);
  expect(snapshot.entries[0].snapshot.edges.map(edge => edge.id)).toEqual(['code:call']);
  expect(snapshot.entries.find(source => source.elementId === 'symbol:sense').element.files).toEqual(['sense.cpp']);
  expect(snapshot.entries[0].ownerProjects).toEqual([{ id: 'p', workspaceType: 'code-architecture' }]);
  await writeCbaRowsToIndexedDB('cba:p:repo', [{ ...codeRows[0], lineage: { scope: 'cba:foreign:repo' } }]);
  await expect(captureLiveSources(codeConfig)).rejects.toThrow('another project');
});
test('complete projects capture architecture first and retain exact diagram traces through downstream documents', async () => {
  const id = await createEngineeringProject({ name: 'Vehicle program', system: 'Vehicle', folderId: 'f', owners: [owner], sources: [], architectureSources: [selected], artifacts: [{ templateId: 'system-spec', title: 'Requirements' }, { templateId: 'architecture', architectureKind: 'system', title: 'System Architecture' }] });
  const request = jest.fn(async args => ({ objects: [{ key: 'command', kind: 'requirement', title: 'Command braking', text: 'Command braking.', sourceIds: [args.sources.entries.find(source => source.sourceType === 'artifact-object' && source.architectureEvidence?.some(e => e.elementType === 'edge')).id] }] }));
  await generateEngineeringProject(id, { request });
  const { program } = await loadEngineeringProject(id); await acceptEngineeringProject(id, program.version, program.runToken);
  expect(request).toHaveBeenCalledTimes(6);
  const exported = await exportEngineeringProject(id);
  expect(exported.records.map(record => record.meta.templateId)).toEqual(['architecture', 'system-spec']);
  expect(exported.traceability.links.some(link => link.type === 'derived-from-diagram' && link.from.startsWith(exported.records[1].meta.id))).toBe(true);
  expect(exported.records[1].revision.objects.find(o => o.kind === 'requirement').sourceEvidence[0].architectureEvidence[0].elementType).toBe('edge');
  saveRows([]); await refreshArtifactSources(); expect((await listArtifacts()).every(meta => meta.freshness === 'unavailable')).toBe(true);
});


test('existing artifact source changes invalidate pending proposals but preserve accepted evidence', async () => {
  const id = await createArtifact({ ...config, templateId: 'system-spec', architectureSources: [], notes: 'Operator requests braking.' });
  const request = async () => ({ objects: [{ key: 'one', title: 'Initial claim', text: 'Operator requests braking.', kind: 'narrative', sourceIds: ['notes'] }] });
  await generateArtifact(id, { request }); let data = await loadArtifact(id); await acceptProposal(id, 0, data.job.token);
  await startProposal(id, 1); const oldJob = (await loadArtifact(id)).job;
  await updateArchitectureSources(id, [selected]); data = await loadArtifact(id);
  expect(data.meta.config.architectureSources).toEqual([selected]); expect(data.job.token).not.toBe(oldJob.token);
  expect(data.revision.sources.entries.some(source => source.diagramId)).toBe(false);
  expect(data.job.sources.entries.some(source => source.diagramId)).toBe(true); expect(data.meta.freshness).toBe('stale');
});
test('project source changes reset the entire run without deleting accepted revisions', async () => {
  const id = await createEngineeringProject({ name: 'Existing program', system: 'Vehicle', folderId: 'f', owners: [owner], sources: [], architectureSources: [selected], artifacts: [{ templateId: 'system-spec', title: 'Specification' }] });
  await generateEngineeringProject(id, { request: async args => response(args) }); let data = await loadEngineeringProject(id);
  await acceptEngineeringProject(id, data.program.version, data.program.runToken);
  await updateArchitectureSources(id, [{ ...selected, focus: 'Control' }]); data = await loadEngineeringProject(id);
  expect(data.program.state).toBe('paused'); expect(data.program.runToken).toBeNull(); expect(data.records[0].meta.revision).toBe(1);
  expect(data.records[0].job).toBeUndefined(); expect(data.program.members[0].config.architectureSources[0].focus).toBe('Control');
});
test.each([['functional', 'Functional Architecture'], ['logical', 'Logical Architecture'], ['physical', 'Physical Architecture']])('%s architecture retains its classification through generation and acceptance', async (kind, title) => {
  const request = jest.fn();
  const id = await createArtifact({ ...config, architectureKind: kind }); await generateArtifact(id, { request });
  const data = await loadArtifact(id); expect(data.job.sections.s1[0].title).toBe(title);
  await acceptProposal(id, 0, data.job.token);
  const saved = await loadArtifact(id);
  expect(saved.meta.config.architectureKind).toBe(kind);
  expect(saved.revision.objects[0].title).toBe(title);
  expect(request).not.toHaveBeenCalled();
});
test('SVG export escapes source labels', () => {
  const svg = architectureSVG({ title: '<script>injected</script>', snapshot: { nodes: [{ id: 'n', label: '<img src=x>' }], edges: [] } });
  expect(svg).not.toContain('<script>'); expect(svg).not.toContain('<img'); expect(svg).toContain('&lt;script&gt;');
});


test('an existing architecture joins a project without changing diagram snapshots or source identities', async () => {
  const id = await createArtifact(config); await generateArtifact(id); const draft = await loadArtifact(id);
  await acceptProposal(id, 0, draft.job.token); const before = await loadArtifact(id);
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [] }, { id: 'destination', name: 'Programs', modules: [] }]));
  const programId = await createEngineeringProject({ name: 'Vehicle program', system: 'Vehicle', folderId: 'destination', owners: [owner], architectureSources: [selected], artifacts: [{ templateId: 'conops' }] });
  await addArtifactToEngineeringProject(id, programId);
  const after = await loadArtifact(id);
  expect(after.revision).toEqual(before.revision); expect(after.meta.folderId).toBe('destination');
  expect(after.meta.config.architectureSources).toEqual(config.architectureSources);
  const exported = await exportEngineeringProject(programId);
  expect(exported.records.some(record => record.meta.id === id)).toBe(true);
  expect(exported.traceability.links.some(link => link.type === 'derived-from-diagram')).toBe(true);
  await generateEngineeringProject(programId, { request: response });
  const ready = await loadEngineeringProject(programId); await acceptEngineeringProject(programId, ready.program.version, ready.program.runToken);
  expect((await loadArtifact(id)).revision.sources.entries.find(entry => entry.snapshot).snapshot).toEqual(before.revision.sources.entries.find(entry => entry.snapshot).snapshot);
});

const codeSelection = abstraction => ({ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo', abstraction });
const codeConfigFor = abstraction => ({ ...config, workspaceType: 'code-architecture', architectureKind: 'code-based', architectureSources: [codeSelection(abstraction)] });
const allocation = (subsystem, csci, csc, csu) => ({ subsystem, csci, csc, csu });
const allocatedRows = [
  { traceId: 'raw-a', fromNodeId: 'a', toNodeId: 'b', fromFunction: 'Sense', toFunction: 'Plan', controlAction: 'Observation', fromFile: 'sense.cpp', toFile: 'plan.cpp', fromArchitecture: allocation('Motion', 'App', 'Control', 'Input'), toArchitecture: allocation('Motion', 'App', 'Control', 'Planner') },
  { traceId: 'raw-b', fromNodeId: 'b', toNodeId: 'c', fromFunction: 'Plan', toFunction: 'Brake', controlAction: 'Command', fromFile: 'plan.cpp', toFile: 'brake.cpp', fromArchitecture: allocation('Motion', 'App', 'Control', 'Planner'), toArchitecture: allocation('Actuation', 'App', 'Control', 'Output') },
];
test.each([['subsystem', 2, 1], ['csci', 2, 1], ['csc', 2, 1], ['csu', 3, 2]])('%s abstraction changes the saved graph while retaining every original relationship', async (level, nodeCount, edgeCount) => {
  await writeCbaRowsToIndexedDB('cba:p:repo', allocatedRows);
  const manifest = await captureLiveSources(codeConfigFor(level));
  const diagram = manifest.entries.find(entry => entry.snapshot);
  expect(diagram.abstraction).toBe(level);
  expect(diagram.id).toContain(':abstraction:' + level);
  expect(diagram.snapshot.nodes).toHaveLength(nodeCount);
  expect(diagram.snapshot.edges).toHaveLength(edgeCount);
  expect(diagram.snapshot.nodes.flatMap(node => node.members.map(member => member.id)).sort()).toEqual(['a', 'b', 'c']);
  const relationships = [...diagram.snapshot.edges.flatMap(edge => edge.relationships), ...diagram.snapshot.nodes.flatMap(node => node.internalRelationships)];
  expect(relationships.map(edge => edge.id).sort()).toEqual(['raw-a', 'raw-b']);
  expect(relationships.find(edge => edge.id === 'raw-b').row).toEqual(allocatedRows[1]);
  expect(architectureSVG(diagram)).toContain(diagram.title.replace(/&/g, '&amp;'));
  await writeCbaRowsToIndexedDB('cba:p:repo', [...allocatedRows].reverse());
  expect((await captureLiveSources(codeConfigFor(level))).hash).toBe(manifest.hash);
});
test('missing allocations use native display defaults without inventing recorded evidence', () => {
  const diagram = architectureDiagram({ projectId: 'p', workspaceType: 'code-architecture', repoId: 'repo', abstraction: 'csci', label: 'Implementation' }, [{ ...allocatedRows[0], fromArchitecture: null, toArchitecture: null }])[0];
  expect(diagram.snapshot.nodes).toHaveLength(1);
  expect(diagram.snapshot.nodes[0].label).toBe('Application Software');
  expect(diagram.snapshot.nodes[0].architectures).toEqual([]);
  expect(diagram.snapshot.nodes[0].members.map(node => node.id)).toEqual(['a', 'b']);
  expect(diagram.snapshot.nodes[0].internalRelationships).toHaveLength(1);
});
test('abstraction selection persists through acceptance, changes create a fresh proposal, and prior snapshots stay unchanged', async () => {
  await writeCbaRowsToIndexedDB('cba:p:repo', allocatedRows);
  const id = await createArtifact(codeConfigFor('subsystem')), request = jest.fn();
  await generateArtifact(id, { request }); const data = await loadArtifact(id);
  await acceptProposal(id, 0, data.job.token);
  const accepted = (await loadArtifact(id)).revision;
  await updateArchitectureSources(id, [codeSelection('csu')]);
  let updated = await loadArtifact(id);
  expect(updated.meta.config.architectureSources[0].abstraction).toBe('csu');
  expect(updated.revision).toEqual(accepted);
  expect(updated.job.sources.entries.find(source => source.snapshot).snapshot.nodes).toHaveLength(3);
  await generateArtifact(id, { request }); updated = await loadArtifact(id); await acceptProposal(id, 1, updated.job.token);
  expect(request).not.toHaveBeenCalled();
  expect((await loadArtifact(id)).revision.sources.entries.find(source => source.snapshot).abstraction).toBe('csu');
});
test('Functional requires a current saved Functional model and never silently substitutes CSU', async () => {
  await writeCbaRowsToIndexedDB('cba:p:repo', allocatedRows);
  await expect(captureLiveSources(codeConfigFor('functional'))).rejects.toThrow('generate or refresh the Functional model');
  await expect(captureLiveSources(codeConfigFor('invalid'))).rejects.toThrow('Choose Subsystem');
});


test('Functional artifacts reuse saved responsibilities with exact implementation traces and detect stale models', async () => {
  const model = await processFunctionalModel(allocatedRows, { request: async prompt => {
    if (prompt.includes('Consolidation input: ')) {
      const { functions } = JSON.parse(prompt.split('Consolidation input: ')[1]);
      return { responsibilities: functions.map(fn => ({ members: [fn.id], name: fn.name, description: fn.description })) };
    }
    const evidence = JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
    return { function: { name: 'Operate ' + evidence[0].from, description: 'Saved operational responsibility.', significance: 'implementation' }, relationships: evidence.map(row => ({ index: row.index, significance: 'meaningful', disposition: 'interaction', target: { name: 'Operate ' + row.to, description: 'Saved target responsibility.' }, action: 'Control request', kind: 'control', description: 'Control exchange.', rationale: 'Selected saved implementation evidence.' })) };
  } });
  await writeCbaRowsToIndexedDB('cba:p:repo', model);
  const manifest = await captureLiveSources(codeConfigFor('functional'));
  const diagram = manifest.entries.find(source => source.snapshot);
  expect(diagram.abstraction).toBe('functional');
  expect(diagram.snapshot.nodes.filter(node => !node.group).every(node => node.label.startsWith('Operate '))).toBe(true);
  expect([...new Set(diagram.snapshot.edges.flatMap(edge => edge.row.functionalModel.sourceTraceIds))].sort()).toEqual(['raw-a', 'raw-b']);
  await writeCbaRowsToIndexedDB('cba:p:repo', model.map((row, i) => i ? row : { ...row, controlAction: 'Changed implementation' }));
  await expect(captureLiveSources(codeConfigFor('functional'))).rejects.toThrow('generate or refresh the Functional model');
});


test('a storage failure identifies the failed creation stage and preserves the original stack', async () => {
  const cause = new RangeError('Invalid array length');
  jest.spyOn(codeStorage, 'readFirstCbaRowsFromIndexedDB').mockRejectedValueOnce(cause);
  await expect(createArtifact(codeConfigFor('csu'))).rejects.toMatchObject({
    message: 'Reading saved code architecture: Invalid array length', cause,
    artifactStage: 'Reading saved code architecture',
  });
  expect(await listArtifacts()).toHaveLength(0);
});

test('repository-sized CSU evidence creates, generates and accepts without a single-request context cap', async () => {
  const count = 320;
  const allocation = index => ({ system: 'Vehicle', subsystem: 'Localization', csci: 'Positioning', csc: 'Estimation', csu: `Unit ${index % 16}` });
  const original = Array.from({ length: count }, (_,index) => ({ id: `implementation-${index}`, fromNodeId: `fn-${index}`, toNodeId: `fn-${(index + 1) % count}`, fromFunction: `Function ${index}`, toFunction: `Function ${(index + 1) % count}`, fromArchitecture: allocation(index), toArchitecture: allocation((index + 1) % count), controlAction: 'Update position', controlDetails: `Relationship ${index}: ` + 'Saved implementation evidence. '.repeat(40) }));
  expect(await writeCbaRowsToIndexedDB('cba:p:repo', original)).toBe(true);
  const id = await createArtifact(codeConfigFor('csu'));
  let saved = await loadArtifact(id);
  expect(JSON.stringify(saved.job.sources).length).toBeGreaterThan(350000);
  const request = jest.fn();
  await generateArtifact(id, { request });
  saved = await loadArtifact(id);
  await acceptProposal(id, 0, saved.job.token);
  saved = await loadArtifact(id);
  const diagram = saved.revision.sources.entries.find(source => source.sourceType === 'architecture-diagram');
  expect(diagram.snapshot.nodes).toHaveLength(16);
  expect(diagram.snapshot.nodes.flatMap(node => node.members)).toHaveLength(count);
  expect(diagram.snapshot.edges.flatMap(edge => edge.relationships).map(edge => edge.row).sort((a,b) => a.id.localeCompare(b.id))).toEqual([...original].sort((a,b) => a.id.localeCompare(b.id)));
  expect(request).not.toHaveBeenCalled();
});

test('architecture snapshots above the narrative evidence budget remain complete through acceptance', async () => {
  const original = { id: 'large-relationship', fromFunction: 'Locate', toFunction: 'Publish', fromArchitecture: { csu: 'Localization' }, toArchitecture: { csu: 'Output' }, controlAction: 'Publish position', savedEvidence: 'z'.repeat(32000100) };
  expect(await writeCbaRowsToIndexedDB('cba:p:repo', [original])).toBe(true);
  const id = await createArtifact(codeConfigFor('csu'));
  const request = jest.fn();
  await generateArtifact(id, { request });
  const draft = await loadArtifact(id);
  await acceptProposal(id, 0, draft.job.token);
  const saved = await loadArtifact(id);
  const diagram = saved.revision.sources.entries.find(source => source.sourceType === 'architecture-diagram');
  expect(diagram.snapshot.edges[0].relationships[0].row.savedEvidence).toBe(original.savedEvidence);
  expect(saved.meta.revision).toBe(1);
  expect(request).not.toHaveBeenCalled();
}, 60000);
