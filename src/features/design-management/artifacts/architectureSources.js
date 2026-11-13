import { CODE_ABSTRACTIONS, abstractCodeArchitecture } from './codeArchitectureAbstraction';
import { computeDiagramArchitectureByNode } from '../../../components/diagramArchitectureIndexes';
import { captureCodePresentation } from './codeArchitectureSnapshot';
import { buildFunctionalModelRows, functionalModelIsReady } from '../../code-architecture-context/functionalModel';
import { semanticHash } from './artifactModel';
import { artifactOperation } from './artifactOperation';
import { sourceManifestSize, DOCUMENT_EVIDENCE_LIMIT } from './artifactSize';
import { readFirstCbaRowsFromIndexedDB, codeArchitectureRowsKey } from '../../code-architecture-assurance/codeArchitectureStorage';

export const ARCHITECTURE_KINDS = { functional: 'Functional Architecture', system: 'System Architecture', logical: 'Logical Architecture', physical: 'Physical Architecture', 'code-based': 'Code-Based Architecture' };
const text = value => String(value ?? '').trim();
const array = (storage, key) => { const value = JSON.parse(storage.getItem(key) || '[]'); if (!Array.isArray(value)) throw new Error(`Cannot read ${key}.`); return value; };
export const architectureSourceKey = source => JSON.stringify([source.workspaceType, source.projectId, source.repoId || '']);
export function architectureCatalog(owners, storage = localStorage) {
  return owners.flatMap(owner => {
    const projects = array(storage, owner.workspaceType === 'functional' ? 'xhandle.projects' : 'xhandle.codeArchitectureProjects');
    const project = projects.find(p => String(p.id) === String(owner.id));
    if (!project) return [];
    const base = { projectId: String(project.id), workspaceType: owner.workspaceType, projectName: project.name || project.title || String(project.id) };
    return owner.workspaceType === 'functional' ? [{ ...base, label: `${base.projectName} — project diagram` }]
      : (project.repos || []).map(repo => ({ ...base, repoId: String(repo.id || repo.repoId), label: `${base.projectName} — ${repo.repoName || repo.repoId || repo.name || repo.id}` }));
  });
}
export function validateArchitectureSelection(config) {
  const selections = config.architectureSources || [];
  if (!Array.isArray(selections) || selections.length > 30) throw new Error('Select up to 30 source diagrams.');
  if (new Set(selections.map(architectureSourceKey)).size !== selections.length) throw new Error('Duplicate source diagram.');
  const owners = config.ownerProjects || [{ id: config.projectId, workspaceType: config.workspaceType }];
  for (const source of selections) {
    if (!owners.some(owner => String(owner.id) === source.projectId && owner.workspaceType === source.workspaceType)) throw new Error('A source diagram belongs to another owning project.');
    if (!['functional', 'code-architecture'].includes(source.workspaceType) || (source.workspaceType === 'code-architecture' && !source.repoId)) throw new Error('Choose a valid source diagram.');
    if (source.focus && (typeof source.focus !== 'string' || source.focus.length > 200)) throw new Error('Architecture scope must be at most 200 characters.');
    if (source.abstraction && (source.workspaceType !== 'code-architecture' || !Object.prototype.hasOwnProperty.call(CODE_ABSTRACTIONS, source.abstraction))) throw new Error('Choose Subsystem, CSCI, CSC, CSU, or Functional for the code architecture abstraction.');
    if (source.level && !['0', '1', '2', 'other'].includes(source.level)) throw new Error('Invalid architecture level.');
  }
  if (config.templateId === 'architecture') {
    if (!ARCHITECTURE_KINDS[config.architectureKind]) throw new Error('Choose an architecture type.');
    if (!selections.length) throw new Error('Select at least one source diagram for the architecture.');
    if (selections.some(s => (s.workspaceType === 'code-architecture') !== (config.architectureKind === 'code-based'))) throw new Error('Code-Based Architecture uses code architecture repositories; System, Functional, Logical, and Physical Architecture use project diagrams.');
  }
}

// Snapshot the actual saved graph, never a graph-index search result or AI redraw.
// Legacy project nodes are name-identified in their native canvas. Legacy edges
// without IDs use content identities, never row offsets that could retarget links.
export function architectureDiagram(source, rows, { groups = [], manual = [], positions = [], native = null, codeNative = null } = {}) {
  const id = `diagram:${encodeURIComponent(architectureSourceKey(source))}${source.focus ? ':scope:' + encodeURIComponent(source.focus) : ''}${source.abstraction ? ':abstraction:' + source.abstraction : ''}`;
  const ownerProjects = [{ id: source.projectId, workspaceType: source.workspaceType }];
  const nodes = new Map(), edges = new Map(), placements = new Map(positions);
  const nodeFiles = new Map(), nodeAllocations = new Map();
  const addNode = (nodeId, label, data = {}) => {
    if (!nodeId || !label) return;
    const old = nodes.get(nodeId);
    const saved = placements.get(nodeId);
    const details = text(data.details);
    if (!nodeFiles.has(nodeId)) { nodeFiles.set(nodeId, new Set()); nodeAllocations.set(nodeId, new Map()); }
    if (data.file) nodeFiles.get(nodeId).add(data.file);
    if (data.architecture) nodeAllocations.get(nodeId).set(semanticHash(data.architecture), data.architecture);
    nodes.set(nodeId, { ...old, id: nodeId, label, ...data,
      details: [...new Set([old?.details, details].filter(Boolean))].sort().join('\n'),
      ...(saved ? { position: saved.position || saved, parentId: saved.parentId || null } : {}),
    });
  };
  const current = rows.filter(row => row.lineage?.status !== 'historical');
  current.forEach((row, index) => {
    const from = text(row.fromFunction || row.from), to = text(row.toFunction || row.to);
    const nodeId = side => (source.workspaceType === 'code-architecture' && text(row[`${side}NodeId`])) || `n:${side === 'from' ? from : to}`;
    const fromId = from ? nodeId('from') : null, toId = to ? nodeId('to') : null;
    addNode(fromId, from, { details: row.fromDetails || '', file: row.fromFile || '', architecture: row.fromArchitecture || row.architecture || null });
    addNode(toId, to, { details: row.toDetails || '', file: row.toFile || '', architecture: row.toArchitecture || row.architecture || null });
    if (!fromId || !toId) return;
    const label = text(row.controlAction || row.action);
    const edgeId = text(row.traceId || row.edgeId || row.id || row.canonicalRelationshipId) || `legacy:${semanticHash(row)}`;
    const nativeId = row.edgeId || `e:${fromId}->${toId}-${index}`;
    // Legacy canvas offsets matter only when saved presentation refers to them.
    // Otherwise retain stable trace identities across source row reordering.
    const hasPresentation = codeNative?.routing?.manualRoutes?.[nativeId] || codeNative?.routing?.overrides?.[nativeId] || codeNative?.comments?.some(comment => comment.targetId === nativeId);
    const edge = { id: edgeId, from: fromId, to: toId, label, details: row.controlDetails || row.controlActionDetails || '', row,
      ...(source.workspaceType === 'code-architecture' && hasPresentation ? { nativeId } : {}) };
    if (edges.has(edgeId) && semanticHash({ ...edges.get(edgeId), nativeId: null }) !== semanticHash({ ...edge, nativeId: null })) throw new Error('A diagram has conflicting relationship identities. Repair the source before generating.');
    edges.set(edgeId, edge);
  });
  groups.forEach(group => addNode(text(group.id), text(group.label || group.name || group.data?.label || group.id), { group: true, parentId: group.parentNode || group.parentId || null, position: group.position, details: group.description || group.data?.description || '', groupType: group.elementType || group.type || group.groupType || 'group' }));
  manual.forEach(node => addNode(text(node.id), text(node.data?.label || node.label || node.name || node.id), { parentId: node.parentNode || null, position: node.position, details: node.data?.description || '' }));
  if (!nodes.size) throw new Error(`${source.label || source.projectName}: no saved diagram elements are available.`);
  for (const node of nodes.values()) {
    node.files = [...nodeFiles.get(node.id)].sort();
    node.architectures = [...nodeAllocations.get(node.id).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
    delete node.file; delete node.architecture;
  }
  if (source.workspaceType === 'code-architecture') {
    const displayAllocations = computeDiagramArchitectureByNode(current);
    for (const node of [...nodes.values()]) {
      node.displayArchitecture = displayAllocations.get(node.id);
      // Only recorded allocations become groups; do not invent default subsystems.
      const paths = node.architectures || [];
      if (paths.length !== 1) continue;
      let parentId = null; const path = [];
      for (const level of ['system', 'subsystem', 'csci', 'csc']) {
        const label = text(paths[0][level]); if (!label) continue;
        path.push([level, label]); const groupId = `arch-group:${semanticHash(path)}`;
        if (!nodes.has(groupId)) nodes.set(groupId, { id: groupId, label, details: text(paths[0].descriptions?.[level]), group: true, groupType: level, parentId });
        parentId = groupId;
      }
      if (parentId) node.parentId = parentId;
    }
  }
  const rawSnapshot = { ...(native ? { native } : {}), nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  const snapshot = source.workspaceType === 'code-architecture' ? abstractCodeArchitecture(rawSnapshot, source.abstraction) : rawSnapshot;
  if (source.workspaceType === 'code-architecture') snapshot.projectionVersion = 2;
  if (codeNative) snapshot.codeNative = codeNative;
  const snapshotNodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  const diagramHash = semanticHash(snapshot);
  const common = { diagramId: id, diagramTitle: source.label, ownerProjects, projectId: source.projectId, workspaceType: source.workspaceType, repoId: source.repoId || null, ...(source.abstraction ? { abstraction: source.abstraction } : {}), level: source.level || null, focus: source.focus || null, diagramHash };
  const diagram = { ...common, id, sourceType: 'architecture-diagram', title: source.label, snapshot, contentHash: diagramHash };
  const entries = [diagram, ...snapshot.nodes.map(node => ({ ...common, id: `${id}:node:${encodeURIComponent(node.id)}`, sourceType: 'architecture-element', elementType: node.group ? 'group' : 'node', elementId: node.id, title: node.label, text: node.details, contentHash: semanticHash(node), element: node })),
    ...snapshot.edges.map(edge => ({ ...common, id: `${id}:edge:${encodeURIComponent(edge.id)}`, sourceType: 'architecture-element', elementType: 'edge', elementId: edge.id, title: edge.label || `${snapshotNodes.get(edge.from).label} → ${snapshotNodes.get(edge.to).label}`, text: edge.details, contentHash: semanticHash(edge), element: edge }))];
  return entries;
}
export async function captureArchitectureSources(config, storage = localStorage) {
  validateArchitectureSelection(config);
  const owners = config.ownerProjects || [{ id: config.projectId, workspaceType: config.workspaceType }];
  const catalog = architectureCatalog(owners, storage);
  const entries = [];
  for (const selection of config.architectureSources || []) {
    const descriptor = catalog.find(source => architectureSourceKey(source) === architectureSourceKey(selection));
    if (!descriptor) throw new Error('A source diagram or repository is unavailable.');
    const source = { ...descriptor, ...(selection.abstraction ? { abstraction: selection.abstraction } : {}), level: selection.level || null, focus: selection.focus?.trim() || '' };
    if (source.abstraction) source.label += ` · ${CODE_ABSTRACTIONS[source.abstraction]}`;
    if (source.focus) source.label += ` / ${source.focus}`;
    let rows, sourceRepo, presentation = {};
    if (source.workspaceType === 'functional') {
      const map = JSON.parse(storage.getItem('xhandle.projectData') || '{}');
      rows = map?.[source.projectId]?.responseRows;
      if (!Array.isArray(rows)) throw new Error(`${source.projectName}: the saved project diagram is unavailable.`);
      const prefix = `diagram:positions:${source.projectId}`;
      presentation = { groups: array(storage, `${prefix}:groups:v1`), manual: array(storage, `${prefix}:manual:v1`), positions: array(storage, prefix) };
      const suffixes = ['', ':groups:v1', ':manual:v1', ':comments:v1', ':deleted-auto-groups:v1', ':ungrouped-auto-nodes:v1', ':edge-aggregation:v1', ':edge-routing:v1', ':auto-categories:v1'];
      presentation.native = { version: 1, rows, autoCategories: map[source.projectId].diagramCategories || null, storage: Object.fromEntries(suffixes.map(suffix => [suffix, storage.getItem(prefix + suffix)]).filter(([, value]) => value !== null)) };
    } else {
      const project = array(storage, 'xhandle.codeArchitectureProjects').find(p => String(p.id) === source.projectId);
      const repo = project.repos.find(r => String(r.id || r.repoId) === source.repoId);
      sourceRepo = repo;
      const primary = codeArchitectureRowsKey(source.projectId, source.repoId);
      const keys = [...new Set([source.repoId, repo.repoId, repo.repoName].filter(Boolean).map(key => codeArchitectureRowsKey(source.projectId, key)))];
      const loaded = await artifactOperation('Reading saved code architecture', () => readFirstCbaRowsFromIndexedDB(keys));
      if (!loaded.found) throw new Error(`${source.label}: saved code architecture is unavailable.`);
      rows = loaded.rows;
      if (rows.some(row => row.lineage?.scope && ![primary, loaded.key].includes(row.lineage.scope))) throw new Error('Saved architecture contains elements from another project or repository.');
    }
    if (source.abstraction === 'functional') {
      if (!rows.length || !rows.every(row => row.functionalModel)) {
        if (!functionalModelIsReady(rows)) throw new Error(`${source.label}: generate or refresh the Functional model in the code-based architecture project before selecting Functional here.`);
        rows = buildFunctionalModelRows(rows);
      }
    }
    if (sourceRepo) presentation.codeNative = await captureCodePresentation(source, sourceRepo, rows, storage);
    if (source.focus) {
      const matches = value => text(value).toLowerCase() === source.focus.toLowerCase();
      rows = rows.filter(row => [row.fromFunction, row.toFunction, row.from, row.to, row.subsystem, ...['architecture', 'fromArchitecture', 'toArchitecture'].flatMap(key => ['system', 'subsystem', 'csci', 'csc', 'csu'].map(field => row[key]?.[field]))].some(matches));
      if (!rows.length) throw new Error(`${source.label}: no saved elements match this scope.`);
      // A focused diagram contains the selected relationships and both endpoints.
      // Unrelated manual groups are not implied to be part of that scope.
      presentation = source.workspaceType === 'functional' ? { native: { version: 1, rows, autoCategories: null, storage: {} } } : { codeNative: presentation.codeNative };
    }
    const captured = await artifactOperation('Building the architecture snapshot', () => architectureDiagram(source, rows, presentation));
    for (const entry of captured) entries.push(entry);
    if (config.templateId !== 'architecture' && sourceManifestSize({ entries }) > DOCUMENT_EVIDENCE_LIMIT) throw new Error('Selected diagrams exceed the saved supporting-evidence limit. Select fewer diagrams or enter a subsystem/function scope. No diagram elements were omitted.');
  }
  return entries;
}
export function architectureObjects(meta, section, sources) {
  const selected = sources.entries.filter(e => e.sourceType === 'architecture-diagram' || e.sourceType === 'architecture-element');
  const sectionId = `${meta.id}:${section.id}`;
  return [{ id: sectionId, sectionId: section.id, parentId: null, title: ARCHITECTURE_KINDS[meta.config.architectureKind], text: '', kind: 'section', sourceIds: [], manual: false }, ...selected.map(source => ({
    id: `${meta.id}:${section.id}:${semanticHash(source.id)}`, key: semanticHash(source.id), sectionId: section.id, parentId: sectionId,
    title: source.title.slice(0, 300), text: (source.text || (source.sourceType === 'architecture-diagram' ? `Saved diagram: ${source.title}${source.level ? ` · Level ${source.level}` : ''}` : '')).slice(0, 16000),
    kind: source.sourceType === 'architecture-diagram' ? 'diagram' : 'architecture-element', sourceIds: [source.id], sourceEvidence: [source], evidenceHash: sources.hash, manual: false,
  }))];
}
