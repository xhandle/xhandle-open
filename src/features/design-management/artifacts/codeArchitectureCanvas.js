import { buildArchitectureLayout, buildCompactArchitectureViewNodes } from '../../../components/LiteSummaryDiagramReactFlowGitHub';
import { arrangedNodes } from '../../../components/diagramArrangementGeometry';
import { codeArchitectureDisplay } from './codeArchitectureDisplay';

const levels = ['subsystem', 'csci', 'csc', 'csu'];
const colors = ['#7A37FF', '#2D7DFE', '#F3B63F', '#22C55E', '#EF4444', '#14B8A6'];

function retainSavedHierarchy(presentation, nodes, groups, sizes, legacySizes) {
  if (!presentation?.storage) return presentation;
  const storage = { ...presentation.storage };
  const read = (key, fallback) => {
    try { return JSON.parse(storage[key]) || fallback; } catch { return fallback; }
  };
  const positions = new Map(read('', []));
  const savedSizes = read(':element-sizes:v1', {});
  // Older adapters seeded the full decomposition bounds into the compact view.
  // Replace only those known generated sizes; retain actual user resizes.
  for (const [id, size] of Object.entries(savedSizes)) {
    const old = legacySizes[id];
    if (old && size.width === old.width && size.height === old.height) delete savedSizes[id];
  }
  storage[':element-sizes:v1'] = JSON.stringify({ ...sizes, ...savedSizes });
  const savedGroups = new Map(read(':groups:v1', []).map(group => [group.id, group]));
  const sourceGroups = new Map(groups.map(group => [group.id, group]));
  for (const group of groups) {
    const saved = savedGroups.get(group.id), old = legacySizes[group.id];
    if (!saved) savedGroups.set(group.id, group);
    else if (old && saved.width === old.width && saved.height === old.height) {
      savedGroups.set(group.id, { ...saved, width: group.width, height: group.height });
    }
  }
  for (const node of nodes) {
    if (node.group) continue;
    const saved = positions.get(node.id);
    // The Projects canvas infers automatic ownership from functional rows.
    // Code rows instead have an explicit, multi-level source hierarchy. Older
    // presentations lost that intent and were consequently flattened on load.
    // Keep deliberate user reparenting (including ungrouping) intact.
    if (saved?.groupingIntent === 'explicit') continue;
    const parentId = node.parentId || null;
    const detached = saved && (saved.parentId || null) !== parentId;
    positions.set(node.id, { ...saved, parentId, groupingIntent: 'explicit',
      position: !detached && saved?.position ? saved.position : node.position });
    if (!detached) continue;
    // A flattened layout may also have shrunk its now-empty containers. Restore
    // enough room for their children without moving manually arranged groups.
    let parent = sourceGroups.get(parentId);
    while (parent) {
      const current = savedGroups.get(parent.id);
      savedGroups.set(parent.id, { ...current,
        width: Math.max(current.width || 0, parent.width || 0),
        height: Math.max(current.height || 0, parent.height || 0) });
      parent = sourceGroups.get(parent.parentNode);
    }
  }
  storage[''] = JSON.stringify([...positions]);
  storage[':groups:v1'] = JSON.stringify([...savedGroups.values()]);
  return { ...presentation, storage };
}

// Adapt the saved code projection, not its underlying functional decomposition.
// All interaction, routing, arrangement and paint belongs to the Projects canvas.
export function codeArchitectureCanvas(diagram) {
  const display = codeArchitectureDisplay(diagram);
  const positions = new Map(display.snapshot.positions || []);
  const seeds = new Map();
  for (const row of display.rows) for (const side of ['from', 'to']) {
    const id = row[`${side}NodeId`];
    if (!id || !row[`${side}Function`] || seeds.has(id)) continue;
    const path = row[`${side}Architecture`];
    seeds.set(id, { id, type: 'bidirectional', position: positions.get(id) || { x: (seeds.size % 4) * 400, y: Math.floor(seeds.size / 4) * 250 }, data: {
      label: row[`${side}Function`], ...path,
      ...Object.fromEntries(levels.map((level, index) => [`${level}Key`, levels.slice(0, index + 1).map(key => path[key]).join('::')])),
      architectureDescriptions: path.descriptions || {},
    } });
  }
  const coarse = display.abstraction !== 'detailed';
  const nativeNodes = buildArchitectureLayout([...seeds.values()], { preservePositions: true, functionalPresentation: display.functionalPresentation }).groupedNodes;
  const projected = coarse ? buildCompactArchitectureViewNodes({ nodes: nativeNodes, nodeVisibility: new Map(nativeNodes.map(node => [node.id, true])), level: display.abstraction }) : nativeNodes;
  // Compact projection changes CSS bounds but can retain measured dimensions
  // from the full decomposition. Match the bounds rendered by the source view
  // before applying deliberate user geometry overrides.
  const view = arrangedNodes(projected.map(node => ({ ...node,
    width: node.style?.width || node.width, height: node.style?.height || node.height,
  })), diagram.presentation?.geometry);
  const leaf = node => node.type !== 'groupBox' || (coarse && node.data.groupKind === display.abstraction);
  // Opaque source IDs avoid merging identically named components in different
  // subsystems. Human labels remain separate from the canvas's row identities.
  const ids = new Map(view.map(node => [node.id, leaf(node) ? `n:code:${node.id}` : node.id]));
  const legacySizes = Object.fromEntries(projected.filter(node => !diagram.presentation?.geometry?.[node.id]?.width)
    .map(node => [ids.get(node.id), { width: node.width || node.style?.width, height: node.height || node.style?.height }]));
  const nodeSources = new Map(), sourceNodes = new Map(), nodeLabels = {}, sizes = {};
  const nodes = view.map(node => {
    const id = ids.get(node.id), group = !leaf(node);
    const source = display.nodeSources.get(node.id) || node.id;
    nodeSources.set(id, source);
    sourceNodes.set(source, id);
    nodeLabels[id] = node.data.label;
    const width = node.width || node.style?.width, height = node.height || node.style?.height;
    if (!group && width && height) sizes[id] = { width, height };
    return { id, label: node.data.label, details: node.data.description || '', group, groupType: node.data.groupKind,
      parentId: ids.get(node.parentNode), position: node.position, width, height };
  });
  // Snapshot edges at coarse levels contain the original relationships. Expand
  // those into rows at the SAME projected endpoints; aggregation is presentation.
  const rows = [], edges = [], included = new Set(), routeKeys = new Map(), edgeTargets = new Map();
  const nativeEdges = new Map();
  for (const [nativeId, sourceId] of display.edgeSources) {
    if (!nativeEdges.has(sourceId)) nativeEdges.set(sourceId, []);
    nativeEdges.get(sourceId).push(nativeId);
  }
  const endpoint = sourceId => {
    if (!coarse) return ids.get(sourceId);
    const seed = seeds.get(sourceId);
    return seed && ids.get(`box:${display.abstraction}:${seed.data[`${display.abstraction}Key`]}`);
  };
  for (const edge of diagram.snapshot.edges) {
    const from = endpoint(edge.from), to = endpoint(edge.to);
    if (!from || !to) continue;
    const pair = `${from}->${to}`;
    for (const nativeId of nativeEdges.get(edge.id) || []) routeKeys.set(nativeId, `pair:${pair}`);
    const oldFrom = from.replace(/^n:code:/, ''), oldTo = to.replace(/^n:code:/, '');
    routeKeys.set(`e:cba-aggregate:directional:${oldFrom}->${oldTo}`, `pair:${pair}`);
    routeKeys.set(`e:cba-aggregate:bidirectional:${[oldFrom, oldTo].sort().join('<->')}`, `bipair:${[from, to].sort().join('<->')}`);
    for (const relationship of edge.relationships?.length ? edge.relationships : [edge]) {
      const row = { fromFunction: from.slice(2), toFunction: to.slice(2), controlAction: relationship.label || edge.label || '',
        controlDetails: relationship.details || '', rowRef: relationship.id };
      const target = `e:${from}->${to}-${rows.length}`;
      edgeTargets.set(relationship.nativeId || relationship.row?.edgeId || relationship.id, target);
      routeKeys.set(relationship.nativeId || relationship.row?.edgeId || relationship.id, target);
      rows.push(row); included.add(from); included.add(to);
      edges.push({ id: relationship.id, from, to, label: row.controlAction, row });
      nodeSources.set(relationship.id, diagram.displayOwners?.[edge.id] || edge.id);
    }
  }
  for (const node of nodes) if (!node.group && !included.has(node.id)) rows.push({ fromFunction: node.id.slice(2), toFunction: '', controlAction: '' });
  const groups = nodes.filter(node => node.group).map((node, index) => ({ ...node, parentNode: node.parentId,
    elementType: nodes.some(child => child.group && child.parentId === node.id) ? 'system' : 'subsystem',
    brandColor: colors[index % colors.length] }));
  const oldRouting = diagram.presentation?.routing || display.snapshot.routing || {};
  const remapRoutes = values => Object.fromEntries(Object.entries(values || {}).filter(([key]) => routeKeys.has(key)).map(([key, value]) => [routeKeys.get(key), value]));
  const notes = arrangedNodes((display.snapshot.notes || []).map(note => ({ id: note.id, type: 'note', position: positions.get(note.id) || note.position,
    data: { label: note.label, description: note.description, brandColor: '#F3B63F' } })), diagram.presentation?.geometry);
  const storage = {
    '': JSON.stringify(nodes.map(node => [node.id, { position: node.position, parentId: node.parentId || null, groupingIntent: 'explicit' }])),
    ':groups:v1': JSON.stringify(groups),
    ':element-sizes:v1': JSON.stringify(sizes),
    ':edge-aggregation:v1': JSON.stringify({ aggregateAll: false, aggregateBidirectionalAll: false }),
    ':edge-routing:v1': JSON.stringify({ defaultStyle: oldRouting.defaultStyle || 'rectangular', overrides: remapRoutes(oldRouting.overrides), manualRoutes: remapRoutes(oldRouting.manualRoutes) }),
    ':manual:v1': JSON.stringify(notes),
    ':comments:v1': JSON.stringify((diagram.presentation?.comments || display.snapshot.comments || []).map(comment => ({ ...comment,
      targetId: ids.get(comment.targetId) || edgeTargets.get(comment.targetId) || comment.targetId }))),
  };
  const adapted = { ...diagram, presentation: retainSavedHierarchy(diagram.presentation, nodes, groups, sizes, legacySizes),
    snapshot: { nodes, edges, native: { rows, storage, nodeLabels, preserveGeometry: true } } };
  return { diagram: adapted, nodeSources, sourceNodes };
}
