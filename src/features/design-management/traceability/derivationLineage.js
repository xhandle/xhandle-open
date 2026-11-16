import { semanticHash } from '../artifacts/artifactModel';
import { referenceKey } from './traceabilityModel';
import { requirementDerivationMode } from '../artifacts/requirementDerivation';

// Software and hardware are parallel allocations of System Requirements.
// Retain legacy safety/subsystem stages when those artifacts are present.
// These are source relationships, not satisfaction or verification claims.
export const LINEAGE_STAGES = [
  { id: 'functional', rank: 0, parents: [], label: 'Functional decomposition', templates: ['architecture'], kinds: ['design', 'architecture-element', 'interface', 'narrative'] },
  { id: 'hazard', rank: 1, parents: ['functional'], label: 'Hazard analysis / HTR', templates: ['hazard-tracking-list'], kinds: ['htr'] },
  { id: 'safety', rank: 2, parents: ['hazard'], label: 'Software safety requirements', templates: ['safety-requirements'], kinds: ['requirement'] },
  { id: 'system', rank: 3, parents: ['functional', 'safety'], label: 'System requirements', templates: ['system-spec'], kinds: ['requirement'] },
  { id: 'software', rank: 4, parents: ['system'], label: 'Software requirements', templates: ['software-spec'], kinds: ['requirement'] },
  { id: 'hardware', rank: 4, parents: ['system'], label: 'Hardware requirements', templates: ['hardware-spec'], kinds: ['requirement'] },
  { id: 'subsystem', rank: 4, parents: ['system'], label: 'Subsystem requirements', templates: ['subsystem-spec'], kinds: ['requirement'] },
  { id: 'design', rank: 5, parents: ['system', 'software', 'hardware', 'subsystem'], label: 'Design details', templates: ['system-design', 'subsystem-design'], kinds: ['design', 'narrative', 'decision', 'interface', 'requirement'] },
];
export const LINEAGE_FLOW = 'Projects: Decomposition → System → Software / Hardware. Code-Based Architecture: Decomposition → Software → System → Hardware.';
const stageParents = node => node.lineageStage === 'system' && node.requirementDerivation === 'code-first' ? ['software', 'functional']
  : node.lineageStage === 'software' && node.requirementDerivation === 'code-first' ? ['functional', 'safety']
    : LINEAGE_STAGES.find(stage => stage.id === node.lineageStage).parents;
const stageRank = (stage, mode) => mode === 'code-first' && stage === 'software' ? 3 : mode === 'code-first' && stage === 'system' ? 3.5 : LINEAGE_STAGES.find(value => value.id === stage).rank;
export const LINEAGE_COLUMNS = [
  { key: 'traceChainId', label: 'Trace Chain ID', width: 160 },
  ...LINEAGE_STAGES.map(stage => ({ key: stage.id, label: stage.label, width: 250, linkType: 'design-lineage', getTokens: value => String(value).split('\n').filter(Boolean) })),
  { key: 'safetyCarryForward', label: 'Safety carry-forward', width: 240 },
  { key: 'traceCompleteness', label: 'Trace Completeness', width: 170 },
  { key: 'openIssues', label: 'Open Issues', width: 390, longText: true },
];
// Profile role IDs cannot contain '@' or ':', so internal stages never collide
// with a user's published role names.
export const lineageRole = stage => `@lineage:${stage.id}`;
export const lineageProfile = { roles: LINEAGE_STAGES.map(stage => ({ ...stage, id: lineageRole(stage) })) };
const functionalAlias = source => `functional:${JSON.stringify([source.workspaceType, source.projectId, source.repoId || '', source.functionalTraceId || source.elementId])}`;

// Keep identity and the recorded functional exchange; never copy code snapshots
// or original hazard inventories into every row of the matrix.
export function lineageCitation(source) {
  const fields = ['id', 'sourceType', 'artifactId', 'objectId', 'recordId', 'revision', 'contentHash', 'diagramId', 'diagramHash', 'elementId', 'elementType', 'workspaceType', 'projectId', 'repoId', 'functionalTraceId', 'sourceTraceId', 'title', 'text'];
  const value = Object.fromEntries(fields.filter(key => source[key] != null).map(key => [key, source[key]]));
  if (source.element) value.element = { id: source.element.id, from: source.element.from, to: source.element.to, label: source.element.label, details: source.element.details };
  return value;
}

export async function buildDerivationLineage(inputNodes, links = [], { signal, onProgress } = {}) {
  const nodes = new Map(), aliases = new Map(), parents = new Map(), children = new Map(), issues = new Map();
  const stageIndex = new Map(LINEAGE_STAGES.map((stage, index) => [stage.id, index]));
  const counters = new Map(), prefixes = { functional: 'FD', hazard: 'HTR', safety: 'SSR', system: 'SYS', software: 'SWR', hardware: 'HWR', subsystem: 'SUB', design: 'DES' };
  const addAlias = (alias, node) => { if (!alias) return; if (!aliases.has(alias)) aliases.set(alias, new Set()); aliases.get(alias).add(node.id); };
  for (const node of inputNodes) {
    const stage = LINEAGE_STAGES.find(stage => node.roles.includes(lineageRole(stage)));
    if (!stage) continue;
    const count = (counters.get(stage.id) || 0) + 1; counters.set(stage.id, count);
    const value = { ...node, requirementDerivation: requirementDerivationMode(node), displayId: node.displayId && node.displayId !== node.objectId ? node.displayId : `${prefixes[stage.id]}-${count}`, lineageStage: stage.id }; nodes.set(node.id, value);
    addAlias(node.id, value);
    for (const alias of node.sourceAliases || []) addAlias(alias, value);
    for (const citation of node.citations || []) if (citation.sourceType === 'architecture-element' && stage.id === 'functional') { addAlias(citation.id, value); if (citation.elementId && citation.projectId) addAlias(functionalAlias(citation), value); }
  }
  const warn = (id, message) => { if (!issues.has(id)) issues.set(id, new Set()); issues.get(id).add(message); };
  const connect = (child, parent, issue) => {
    if (!child || !parent || child.id === parent.id) return;
    if (stageRank(parent.lineageStage, child.requirementDerivation) >= stageRank(child.lineageStage, child.requirementDerivation)) { warn(child.id, 'A saved source link runs outside the displayed derivation order.'); return; }
    if (!parents.has(child.id)) parents.set(child.id, new Set()); parents.get(child.id).add(parent.id);
    if (!children.has(parent.id)) children.set(parent.id, new Set()); children.get(parent.id).add(child.id);
    if (issue) warn(child.id, issue);
  };
  let work = 0;
  const checkpoint = async () => { if (signal?.aborted) throw new DOMException('Assessment cancelled', 'AbortError'); if (++work % 400 === 0) { onProgress?.(work); await new Promise(resolve => setTimeout(resolve, 0)); } };
  for (const child of [...nodes.values()]) for (const citation of child.citations || []) {
    await checkpoint();
    const alias = citation.functionalTraceId ? functionalAlias(citation) : citation.artifactId && citation.objectId ? referenceKey(citation.artifactId, citation.objectId) : citation.id;
    const matches = [...(aliases.get(alias) || [])];
    if (matches.length > 1) { warn(child.id, 'A cited source has ambiguous object identity.'); continue; }
    let parent = nodes.get(matches[0]);
    if (!parent && (citation.sourceType === 'architecture-element' || citation.functionalTraceId)) {
      parent = { id: `source:${alias}`, artifactId: child.artifactId, objectId: child.objectId, navigateId: child.navigateId, displayId: citation.functionalTraceId || citation.elementId || citation.title, title: citation.functionalTraceId ? `FD-${citation.functionalTraceId}` : citation.title || 'Saved functional source', text: citation.text || citation.element?.details || '', revision: citation.revision || child.revision, lineageStage: 'functional', roles: [lineageRole(LINEAGE_STAGES[0])], draft: child.draft, hash: citation.contentHash, sourceSnapshot: true };
      nodes.set(parent.id, parent); addAlias(alias, parent);
    }
    if (!parent) {
      if (['artifact-object', 'hazard-tracking-record'].includes(citation.sourceType)) warn(child.id, 'A cited upstream object is missing from the selected sources.');
      continue;
    }
    const comparable = citation.sourceType === 'artifact-object' && citation.contentHash && parent.sourceContentHash;
    const stale = comparable ? citation.contentHash !== parent.sourceContentHash : citation.revision != null && parent.revision !== citation.revision;
    connect(child, parent, stale ? 'Historical source reference: review against the current source revision.' : '');
  }
  for (const link of links) {
    await checkpoint();
    if (!['derived-from', 'mitigates', 'satisfies'].includes(link.type) || link.state === 'retired' || link.state === 'invalid') continue;
    connect(nodes.get(link.from), nodes.get(link.to), link.state !== 'confirmed' ? `Engineering relationship needs review (${link.state}).` : '');
  }
  // One row per terminal object, with its real ancestors. Do not multiply
  // independent branches into a Cartesian product or invent missing parents.
  const rows = [];
  for (const leaf of nodes.values()) {
    if (children.get(leaf.id)?.size) continue;
    const ancestry = new Set(), pending = [leaf.id], findings = new Set();
    while (pending.length) { await checkpoint(); const id = pending.pop(); if (ancestry.has(id)) continue; ancestry.add(id); pending.push(...(parents.get(id) || [])); for (const issue of issues.get(id) || []) findings.add(issue); }
    const stages = Object.fromEntries(LINEAGE_STAGES.map(stage => [stage.id, [...ancestry].filter(id => nodes.get(id).lineageStage === stage.id)]));
    const required = leaf.lineageStage === 'software' && leaf.requirementDerivation === 'code-first' ? ['functional'] : ['functional', 'system'];
    for (const stage of LINEAGE_STAGES.filter(stage => required.includes(stage.id))) if (!stages[stage.id].length) findings.add(`Missing ${stage.label.toLowerCase()}.`);
    for (const id of ancestry) {
      const node = nodes.get(id), stage = LINEAGE_STAGES[stageIndex.get(node.lineageStage)];
      const expected = stageParents(node);
      if (expected.length && ![...(parents.get(id) || [])].some(parent => expected.includes(nodes.get(parent).lineageStage))) {
        findings.add(`${stage.label}: missing a source link to ${expected.map(parent => LINEAGE_STAGES.find(item => item.id === parent).label.toLowerCase()).join(' or ')}.`);
      }
    }
    if ([...ancestry].some(id => nodes.get(id).draft)) findings.add('Includes draft source objects.');
    if ([...ancestry].some(id => nodes.get(id).unresolved)) findings.add('Includes unresolved source evidence.');
    let carried = false;
    const allocated = [...stages.software, ...stages.hardware];
    if (stages.safety.length && allocated.length) {
      carried = allocated.every(id => {
        const seen = new Set(), pending = [id];
        while (pending.length) { const current = pending.pop(); if (seen.has(current)) continue; seen.add(current); if (stages.safety.includes(current)) return true; pending.push(...(parents.get(current) || [])); }
        return false;
      });
      if (!carried) findings.add('Derived requirements do not retain their safety requirement source.');
    }
    const cellNodes = {}, cells = {};
    for (const stage of LINEAGE_STAGES) {
      cellNodes[stage.id] = Object.fromEntries(stages[stage.id].map(id => { const node = nodes.get(id); return [`${node.artifactTitle || 'Source'} · ${node.displayId || node.objectId}`.replace(/[\r\n]/g, ' '), id]; }));
      cells[stage.id] = Object.keys(cellNodes[stage.id]).join('\n');
    }
    rows.push({ id: `lineage:${semanticHash(leaf.id)}`, traceChainId: `TRACE-${String(rows.length + 1).padStart(4, '0')}`, ...cells, cellNodes, terminalId: leaf.id,
      safetyCarryForward: carried ? `${stages.safety.length} linked safety requirement(s) retained` : stages.safety.length && allocated.length ? 'Missing in allocated requirements' : 'No linked allocated safety requirements',
      traceCompleteness: findings.size ? 'Open' : 'Complete', openIssues: [...findings].join('\n') });
  }
  return { version: 1, rows, nodes: [...nodes.values()], summary: { chains: rows.length, complete: rows.filter(row => row.traceCompleteness === 'Complete').length, open: rows.filter(row => row.traceCompleteness !== 'Complete').length }, stageCounts: Object.fromEntries(LINEAGE_STAGES.map(stage => [stage.id, [...nodes.values()].filter(node => node.lineageStage === stage.id).length])) };
}
