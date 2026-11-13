import { getTemplate } from './artifactModel';
import { CODE_ABSTRACTIONS } from './codeArchitectureAbstraction';

const excerpt = value => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 480 ? `${text.slice(0, 477)}…` : text;
};
const names = nodes => nodes.slice(0, 6).map(node => node.label).join(', ') + (nodes.length > 6 ? ` and ${nodes.length - 6} others` : '');

// A concise, deterministic reading of the saved revision, not new engineering
// claims. Never expand aggregate members or the full functional decomposition.
export function architectureDescription(meta, manifest) {
  const entries = manifest?.entries || [];
  const diagrams = entries.filter(source => source.sourceType === 'architecture-diagram' && source.snapshot);
  const elementSources = new Map(entries.filter(source => source.sourceType === 'architecture-element').map(source => [`${source.diagramId}:${source.elementId}`, source]));
  const sections = [];
  const add = (id, title, paragraphs) => sections.push({ id, title, paragraphs });
  const reference = (diagram, element) => {
    const source = element ? elementSources.get(`${diagram.id}:${element.id}`) : diagram;
    return { sourceId: source?.id || diagram.id, diagramId: diagram.id, elementId: element?.id, title: element?.label || diagram.title };
  };
  add('scope', 'Purpose and scope', [{ text: `This architecture description documents ${meta.config?.system || meta.title || 'the selected system'} using ${diagrams.length} saved architecture ${diagrams.length === 1 ? 'diagram' : 'diagrams'}. It describes the structure and relationships represented in this revision. The Diagram view provides the graphical representation; Outline, Table and Trace provide access to individual objects and their supporting evidence.`, references: [] }]);
  if (!diagrams.length) {
    add('missing', 'Architecture evidence needed', [{ text: 'No saved architecture diagram is available for this document. Capture a source diagram to describe its structure and relationships.', references: [] }]);
    return sections;
  }
  diagrams.forEach((diagram, index) => {
    const nodes = diagram.snapshot.nodes || [], edges = diagram.snapshot.edges || [];
    const components = nodes.filter(node => !node.group), boundaries = nodes.filter(node => node.group);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const code = diagram.workspaceType === 'code-architecture';
    const level = CODE_ABSTRACTIONS[diagram.abstraction] || (diagram.level != null ? `Level ${diagram.level}` : 'the saved diagram level');
    const diagramRef = reference(diagram);
    add(`diagram-${index}-context`, `${diagram.title} — context`, [{ text: `${diagram.title} represents ${code ? 'the code-based implementation' : 'the project architecture'} at ${level}${diagram.focus ? `, scoped to ${diagram.focus}` : ''}. The saved view contains ${components.length} elements, ${boundaries.length} boundaries and ${edges.length} relationships. ${code ? 'Lower-level implementation evidence remains linked to the selected abstraction rather than being reproduced here.' : 'The description follows the boundaries and connections recorded in the source diagram.'}`, references: [diagramRef] }]);
    const groups = new Map();
    for (const node of components) {
      const path = node.displayArchitecture || node.architectures?.[0];
      const label = byId.get(node.parentId)?.label || (code ? path?.subsystem : null) || 'Elements without a recorded boundary';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(node);
    }
    const structure = [...groups].slice(0, 8).map(([label, members]) => ({ text: `${label} contains ${members.length} ${members.length === 1 ? 'element' : 'elements'} in this view: ${names(members)}.`, references: members.slice(0, 6).map(node => reference(diagram, node)) }));
    if (groups.size > 8) structure.push({ text: `${groups.size - 8} additional groupings are available in the Diagram view and object table. This overview summarizes the first eight groupings; it is not an exhaustive element inventory.`, references: [diagramRef] });
    if (!structure.length) structure.push({ text: 'No individual elements are recorded in this snapshot.', references: [diagramRef] });
    // Include recorded responsibilities, bounded at the selected abstraction.
    const described = components.filter(node => node.details);
    described.slice(0, 4).forEach(node => structure.push({ text: `${node.label} — recorded description: ${excerpt(node.details)}`, references: [reference(diagram, node)] }));
    if (described.length > 4) structure.push({ text: `Descriptions for ${described.length - 4} additional elements are available through their supporting evidence.`, references: [diagramRef] });
    add(`diagram-${index}-structure`, 'Structural organization and responsibilities', structure);
    const interactions = edges.slice(0, 8).map(edge => ({ text: `The diagram records a relationship from ${byId.get(edge.from)?.label || 'an unspecified source'} to ${byId.get(edge.to)?.label || 'an unspecified destination'}${edge.label ? `, labeled “${edge.label}”` : ''}.${edge.details ? ` Recorded detail: ${excerpt(edge.details)}` : ''}`, references: [reference(diagram, edge)] }));
    if (edges.length > 8) interactions.push({ text: `These are eight of ${edges.length} saved relationships. The remaining ${edges.length - 8} relationships can be inspected in the Diagram and Trace views; this overview does not enumerate every connection.`, references: [diagramRef] });
    if (!edges.length) interactions.push({ text: 'No relationships are recorded in this snapshot. Interfaces and interactions cannot be described from this diagram alone.', references: [diagramRef] });
    add(`diagram-${index}-interfaces`, 'Interfaces and interactions', interactions);
  });
  add('review', 'Interpretation and open questions', [{ text: 'This description summarizes saved architecture evidence. Relationship labels alone do not define interface contracts, timing budgets, deployment arrangements or verification results. Review the linked element descriptions and supporting documents for those details; information absent from the sources remains unresolved.', references: [] }]);
  return sections;
}

// Derived prose is editable as artifact objects; the source diagram remains immutable.
export function architectureEditableSections(meta, manifest, objects = []) {
  const saved = new Map(objects.map(object => [object.id, object]));
  const sources = new Map((manifest?.entries || []).map(source => [source.id, source]));
  const sectionId = getTemplate('architecture').sections[0].id;
  return architectureDescription(meta, manifest).map(section => {
    const id = `${meta.id}:description:${section.id}`;
    const object = saved.get(id) || { id, sectionId, parentId: null, kind: 'section', title: section.title, text: '', sourceIds: [] };
    return { ...section, object, paragraphs: section.paragraphs.map((paragraph, index) => {
      const paragraphId = `${id}:p:${index}`;
      const edited = saved.get(paragraphId);
      const references = edited ? (edited.sourceIds || []).map(sourceId => {
        const source = sources.get(sourceId);
        return { sourceId, diagramId: source?.diagramId || sourceId, elementId: source?.elementId, title: source?.title || 'Supporting source' };
      }) : paragraph.references;
      return { ...paragraph, references, object: edited || {
        id: paragraphId, sectionId, parentId: id, kind: 'narrative', title: `${section.title} — ${index + 1}`,
        text: paragraph.text, sourceIds: [...new Set(paragraph.references.map(reference => reference.sourceId).filter(Boolean))]
      } };
    }).filter(paragraph => !paragraph.object.deleted) };
  }).filter(section => !section.object.deleted);
}

export function architectureDescriptionObjects(meta, manifest, objects = []) {
  return architectureEditableSections(meta, manifest, objects).flatMap(section => [
    section.object, ...section.paragraphs.map(paragraph => paragraph.object),
  ]);
}
