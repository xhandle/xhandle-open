import { sourceManifestSize, DOCUMENT_EVIDENCE_LIMIT, sizeDescription } from './artifactSize';
import { artifactObjectText, getTemplate, mergeProposal, newId, semanticHash, validateConfig } from './artifactModel';
import { assertOwner, captureSources, ownerKey } from './artifactSources';
import { orderedObjects } from './artifactExport';
import { isSafetyArtifact } from './safetyArtifactTypes';
import { consolidatedHazardSources } from './hazardTrackingSources';
import { organizeAtomicSafetyRequirements } from './atomicSafetyRequirements';
import { usesAtomicRequirements } from './requirementArtifactTypes';
import { requirementSourceEntries } from './requirementDerivationSources';
import { requirementDerivationMode, requirementPrerequisites, requirementDiagramSources, upstreamRequirementTemplate } from './requirementDerivation';

export const ENGINEERING_PROJECT_TYPE = 'systems-engineering-project';
const rank = ['architecture', 'conops', 'hazard-tracking-list', 'safety-requirements', 'system-spec', 'software-spec', 'hardware-spec', 'subsystem-spec', 'system-design', 'subsystem-design', 'interface-spec'];
const derivedConfig = config => ({ ...config, architectureSources: requirementDiagramSources(config), sources: [], notes: '', projectNotes: {} });
const isSpecification = config => ['system-spec', 'software-spec', 'hardware-spec'].includes(config.templateId);
const documentOrder = (templateId, mode) => {
  const ordered = mode === 'code-first' ? rank.map(id => id === 'system-spec' ? 'software-spec' : id === 'software-spec' ? 'system-spec' : id) : rank;
  return ordered.includes(templateId) ? ordered.indexOf(templateId) : ordered.length;
};
export function planEngineeringProject(input) {
  if (input.artifacts?.some(item => item.templateId === 'traceability-matrix')) throw new Error('Create a traceability matrix from the project after its source documents exist.');
  if (!input.name?.trim() || input.name.length > 200) throw new Error('Enter a project name (up to 200 characters).');
  if (!Array.isArray(input.owners) || !input.owners.length || input.owners.length > 20) throw new Error('Select 1–20 owning projects.');
  const owners = input.owners.map(owner => ({ id: String(owner.id), workspaceType: owner.workspaceType }));
  if (new Set(owners.map(ownerKey)).size !== owners.length) throw new Error('Owning projects must be unique.');
  if (!Array.isArray(input.artifacts) || !input.artifacts.length || input.artifacts.length > 24) throw new Error('Select 1–24 artifacts.');
  for (const notes of Object.values(input.projectNotes || {})) if (typeof notes !== 'string' || notes.length > 20000) throw new Error('Limit each project’s source notes to 20,000 characters.');
  const id = `se-project:${newId()}`;
  let selectedArtifacts = input.artifacts.some(item => item.templateId === 'safety-requirements') && !input.artifacts.some(item => item.templateId === 'hazard-tracking-list')
    ? [{ templateId: 'hazard-tracking-list' }, ...input.artifacts] : input.artifacts;
  const mode = requirementDerivationMode(input);
  selectedArtifacts = requirementPrerequisites(selectedArtifacts, { requirementDerivation: mode });
  if (selectedArtifacts.length > 24) throw new Error('Select up to 24 artifacts including required upstream specifications.');
  const configs = selectedArtifacts.map(item => ({
    ...item, title: item.title?.trim() || getTemplate(item.templateId).name,
    projectId: owners[0].id, workspaceType: owners[0].workspaceType, ownerProjects: owners,
    architectureSources: isSafetyArtifact(item.templateId) ? [] : (input.architectureSources || []).filter(source => item.templateId !== 'architecture' || (source.workspaceType === 'code-architecture') === (item.architectureKind === 'code-based')),
    programId: id, system: input.system, folderId: input.folderId, requirementDerivation: mode,
    notes: isSafetyArtifact(item.templateId) ? '' : input.notes || '', projectNotes: isSafetyArtifact(item.templateId) ? {} : Object.fromEntries(owners.map(owner => [ownerKey(owner), input.projectNotes?.[ownerKey(owner)] || ''])), sources: isSafetyArtifact(item.templateId) ? [] : input.sources || [],
  })).sort((a, b) => documentOrder(a.templateId, mode) - documentOrder(b.templateId, mode));
  const documents = configs.map(config => {
    const effective = upstreamRequirementTemplate(config) ? derivedConfig(config) : { ...config, architectureSources: requirementDiagramSources(config) };
    validateConfig(effective); assertOwner(effective);
    const sources = captureSources(effective);
    if (!isSafetyArtifact(effective.templateId) && !upstreamRequirementTemplate(effective) && !effective.architectureSources.length && !sources.entries.some(entry => entry.sourceType !== 'project')) throw new Error('Provide source content for the selected owning projects.');
    return { id: newId(), config: effective };
  });
  // Earlier selected documents are explicit drafting inputs, not inferred compliance claims.
  // A deterministic order makes resume and joint publication reproducible.
  const members = documents.map((doc, index) => {
    const parent = upstreamRequirementTemplate(doc.config);
    return { ...doc, dependsOn: parent ? documents.filter(previous => previous.config.templateId === parent).map(previous => previous.id)
      : doc.config.templateId === 'hazard-tracking-list' ? [] : documents.slice(0, index).filter(previous => doc.config.templateId === 'safety-requirements' ? previous.config.templateId === 'hazard-tracking-list' : previous.config.templateId !== 'hazard-tracking-list').map(previous => previous.id) };
  });
  return { id, projectId: id, workspaceType: 'systems-engineering', recordType: ENGINEERING_PROJECT_TYPE,
    title: input.name.trim(), folderId: input.folderId, ownerProjects: owners, config: { ...configs[0], architectureSources: input.architectureSources || [] },
    requirementDerivation: mode, members, traceabilityProfile: input.traceabilityProfile || { id: 'xhandle-systems-engineering', version: 1 }, state: 'draft', version: 0, runToken: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
// Apply the corrected dependency order only when starting a fresh generation.
// Accepted revisions and their original evidence are never rewritten.
export function systemRequirementDerivation(program) {
  if (!program.members.some(member => isSpecification(member.config))) return program;
  const diagrams = [...new Map([...(program.config.architectureSources || []), ...program.members.flatMap(member => member.config.architectureSources || [])].map(source => [semanticHash(source), source])).values()];
  const mode = program.requirementDerivation || requirementDerivationMode({ architectureSources: diagrams, ownerProjects: program.ownerProjects });
  const shared = { ...program.config, architectureSources: diagrams, requirementDerivation: mode };
  let members = [...program.members];
  for (const config of requirementPrerequisites(members.map(member => member.config), shared)) {
    if (!members.some(member => member.config.templateId === config.templateId)) {
      members.push({ id: newId(), config: { ...shared, templateId: config.templateId, title: getTemplate(config.templateId).name }, dependsOn: [] });
    }
  }
  if (members.length > 24) throw new Error('The project needs room for its required upstream specifications (24 artifacts maximum).');
  members = members.map(member => {
    if (!isSpecification(member.config)) return member;
    let config = { ...member.config, programId: program.id, architectureSources: diagrams, requirementDerivation: mode };
    const parent = upstreamRequirementTemplate(config);
    if (!parent && upstreamRequirementTemplate(member.config)) config = { ...config, sources: shared.sources || [], notes: shared.notes || '', projectNotes: shared.projectNotes || {} };
    return { ...member, config: parent ? derivedConfig(config) : { ...config, architectureSources: requirementDiagramSources(config) },
      dependsOn: parent ? members.filter(other => other.config.templateId === parent).map(other => other.id)
        : (member.dependsOn || []).filter(id => !isSpecification(members.find(other => other.id === id)?.config || {})) };
  });
  members.sort((a, b) => documentOrder(a.config.templateId, mode) - documentOrder(b.config.templateId, mode));
  return { ...program, config: shared, requirementDerivation: mode, members };
}
export function proposedRevision(data) {
  if (data.job?.state !== 'ready') throw new Error(`Finish generating ${data.meta.title} first.`);
  const sections = getTemplate(data.meta.templateId).sections;
  if (sections.some(section => !data.job.sections[section.id])) throw new Error('An input proposal is incomplete.');
  const objects = mergeProposal(data.revision?.objects || [], sections.flatMap(section => data.job.sections[section.id]));
  return { number: data.meta.revision + 1, objects: usesAtomicRequirements(data.meta.templateId) ? organizeAtomicSafetyRequirements(objects) : objects };
}
export function projectInputSources(config, upstream, base = captureSources(config)) {
  const parentTemplate = upstreamRequirementTemplate(config);
  const dependencies = (config.templateId === 'hazard-tracking-list' ? [] : upstream).filter(data => parentTemplate
    ? data?.meta.templateId === parentTemplate : config.templateId !== 'safety-requirements' || data?.meta.templateId === 'hazard-tracking-list').map(data => {
    const revision = proposedRevision(data);
    return { artifactId: data.meta.id, title: data.meta.title, meta: data.meta, revision: revision.number,
      contentHash: semanticHash(orderedObjects(revision.objects)), objects: revision.objects };
  });
  if (config.templateId === 'safety-requirements' && !dependencies.some(dependency => dependency.meta.templateId === 'hazard-tracking-list')) throw new Error('Include and consolidate a Hazard Tracking List before generating Safety Requirements.');
  if (parentTemplate && !dependencies.length) throw new Error(`Generate the project’s ${getTemplate(parentTemplate).name} before deriving this specification.`);
  const entries = [...(parentTemplate ? base.entries.filter(entry => entry.sourceType === 'project' || entry.sourceType === 'hazard-derived-requirement' || (config.templateId === 'system-spec' && entry.workspaceType === 'functional' && entry.sourceType.startsWith('architecture-'))) : base.entries), ...dependencies.flatMap(dependency => parentTemplate
    ? requirementSourceEntries(dependency.meta, dependency.objects, dependency.revision)
    : config.templateId === 'safety-requirements'
    ? consolidatedHazardSources(dependency.meta, dependency.objects, dependency.revision)
    : orderedObjects(dependency.objects).filter(object => object.kind !== 'section').map(object => ({
    id: `artifact-object:${dependency.artifactId}:${object.id}`, sourceType: 'artifact-object',
    artifactId: dependency.artifactId, artifactTitle: dependency.title, objectId: object.id,
    revision: dependency.revision, contentHash: semanticHash(object), title: object.title,
    text: artifactObjectText(object), attributes: object.attributes || {}, content: object.content || null, status: object.status || null, kind: object.kind, evidenceIssue: object.evidenceIssue || null,
    ownerProjects: [...new Map((object.sourceEvidence || []).flatMap(e => e.ownerProjects || []).map(owner => [ownerKey(owner), owner])).values()],
    upstreamSourceIds: object.sourceIds || [],
    architectureEvidence: [...new Map((object.sourceEvidence || []).flatMap(source => source.sourceType?.startsWith('architecture-') ? [source] : source.architectureEvidence || []).map(({ snapshot, ...source }) => [semanticHash(source), source])).values()],
  })))];
  const manifest = { ...base, baseHash: base.hash, entries, dependencies: dependencies.map(({ objects, meta, ...reference }) => reference) };
  delete manifest.hash;
  const size = ['architecture', 'hazard-tracking-list'].includes(config.templateId) ? 0 : sourceManifestSize(manifest);
  if (size > DOCUMENT_EVIDENCE_LIMIT) throw new Error(`${config.title || 'This document'} needs ${sizeDescription(size)} of distinct project evidence, above the evidence limit of ${sizeDescription(DOCUMENT_EVIDENCE_LIMIT)}. Saved work is retained; no selected sources have been discarded.`);
  return { ...manifest, hash: semanticHash(manifest) };
}
// Renaming a document does not change the content cited by saved proposals.
// Keep the saved manifest (and its original labels) intact when comparing inputs.
export function sameProjectInputs(left, right) {
  if (left.hash === right.hash) return true;
  const content = ({ hash, ...manifest }) => ({ ...manifest,
    entries: manifest.entries.map(entry => {
      if (!['artifact-object', 'hazard-tracking-record'].includes(entry.sourceType)) return entry;
      const { artifactTitle, ...evidence } = entry;
      return evidence;
    }),
    dependencies: (manifest.dependencies || []).map(({ title, ...dependency }) => dependency),
  });
  return semanticHash(content(left)) === semanticHash(content(right));
}
export function engineeringProjectTrace(program, records, draft = false) {
  const nodes = new Map(), links = new Map(), gaps = [];
  const addNode = node => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const link = (from, to, type) => { const id = `${type}:${from}:${to}`; links.set(id, { id, from, to, type }); };
  const revisions = new Map(records.map(data => [data.meta.id, draft && data.job?.state === 'ready' ? proposedRevision(data) : data.revision]));
  const sourceObjects = new Map([...revisions].map(([id, revision]) => [id, new Map(orderedObjects(revision?.objects || []).map(object => [object.id, object]))]));
  // Only hash objects actually cited across documents. Architecture objects can
  // contain large evidence snapshots that most graph nodes never need to hash.
  const hashes = new WeakMap();
  const trackingRecords = new Map();
  const objectHash = object => {
    if (!object) return undefined;
    if (!hashes.has(object)) hashes.set(object, semanticHash(object));
    return hashes.get(object);
  };
  addNode({ id: program.id, type: 'systems-engineering-project', title: program.title });
  for (const owner of program.ownerProjects) {
    const id = `project:${ownerKey(owner)}`;
    addNode({ id, type: 'owning-project', title: ownerKey(owner), owner }); link(program.id, id, 'derived-from-project');
  }
  for (const data of records) {
    const revision = revisions.get(data.meta.id);
    addNode({ id: data.meta.id, type: 'artifact', title: data.meta.title, revision: revision?.number || null });
    link(program.id, data.meta.id, 'contains');
    for (const owner of data.meta.config.ownerProjects || []) link(data.meta.id, `project:${ownerKey(owner)}`, 'derived-from-project');
    for (const dependency of data.meta.dependsOn || []) link(data.meta.id, dependency, 'uses-drafting-input');
    for (const object of orderedObjects(revision?.objects || [])) {
      addNode({ id: object.id, type: object.kind, title: object.title, ...(!object.title ? { description: String(object.text || object.attributes?.Hazard || '').slice(0, 180) } : {}), artifactId: data.meta.id, objectId: object.id, revision: revision.number }); link(data.meta.id, object.id, 'contains');
      if (object.kind === 'section') continue;
      if (!object.sourceIds?.length || object.kind === 'gap') gaps.push({ artifactId: data.meta.id, objectId: object.id, message: `${object.title}: unresolved evidence` });
      for (const source of object.sourceEvidence || []) {
        let sourceNode;
        if (source.sourceType === 'hazard-tracking-record') {
          const upstream = revisions.get(source.artifactId);
          if (!trackingRecords.has(source.artifactId)) {
            const upstreamMeta = records.find(record => record.meta.id === source.artifactId)?.meta;
            let captured = [];
            try { if (upstreamMeta && upstream) captured = consolidatedHazardSources(upstreamMeta, upstream.objects, upstream.number); } catch {}
            trackingRecords.set(source.artifactId, new Map(captured.map(record => [record.id, record])));
          }
          const current = upstream?.number === source.revision && trackingRecords.get(source.artifactId).get(source.id)?.contentHash === source.contentHash;
          sourceNode = current ? source.id : `snapshot:${source.id}:${source.revision}:${source.contentHash}`;
          addNode({ id: sourceNode, title: source.title, type: current ? 'hazard-tracking-record' : 'source-snapshot', artifactId: source.artifactId, revision: source.revision, historical: !current, evidence: source });
          link(source.artifactId, sourceNode, 'contains');
          if (!current) gaps.push({ artifactId: data.meta.id, objectId: object.id, message: `${object.title}: cited ${source.recordId} revision ${source.revision}; review against its current consolidation` });
        } else if (source.sourceType === 'artifact-object') {
          const upstream = revisions.get(source.artifactId);
          const current = upstream?.number === source.revision && objectHash(sourceObjects.get(source.artifactId)?.get(source.objectId)) === source.contentHash;
          sourceNode = current ? source.objectId : `snapshot:${source.artifactId}:${source.revision}:${source.objectId}:${source.contentHash}`;
          if (!current) {
            addNode({ id: sourceNode, title: `${source.title} (revision ${source.revision} snapshot)`, type: 'source-snapshot', artifactId: source.artifactId, objectId: source.objectId, revision: source.revision, historical: true, evidence: source });
            gaps.push({ artifactId: data.meta.id, objectId: object.id, message: `${object.title}: cited ${source.artifactTitle} revision ${source.revision}; review against its current revision` });
          }
        } else {
          sourceNode = `source:${source.id}:${semanticHash(source)}`;
          addNode({ id: sourceNode, title: source.title, type: source.sourceType || 'source', evidence: source });
        }
        link(object.id, sourceNode, 'refines');
        for (const owner of source.ownerProjects || []) link(sourceNode, `project:${ownerKey(owner)}`, 'originates-in-project');
        for (const evidence of [source, ...(source.architectureEvidence || [])].filter(e => e.diagramId)) {
          const diagramNode = `diagram-snapshot:${evidence.diagramId}:${evidence.diagramHash}`;
          addNode({ id: diagramNode, type: 'architecture-diagram', title: evidence.diagramTitle, evidence });
          link(sourceNode, diagramNode, evidence.elementId ? 'element-of-diagram' : 'derived-from-diagram');
          link(object.id, diagramNode, 'derived-from-diagram');
          for (const owner of evidence.ownerProjects || []) link(diagramNode, `project:${ownerKey(owner)}`, 'originates-in-project');
        }
      }
    }
    if (revision) {
      const citedDocuments = new Set(orderedObjects(revision.objects).flatMap(o => (o.sourceEvidence || []).filter(s => ['artifact-object', 'hazard-tracking-record'].includes(s.sourceType)).map(s => s.artifactId)));
      for (const dependency of data.meta.dependsOn || []) if (!citedDocuments.has(dependency)) gaps.push({ artifactId: data.meta.id, dependency, message: `${data.meta.title}: drafting input has no object-level citation` });
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()], gaps };
}

// Computed matrix assessments belong to the project but are not drafting inputs.
export const generationMembers = program => program.members.filter(member => member.config.templateId !== 'traceability-matrix');
