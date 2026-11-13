const COARSE = new Set(['subsystem', 'csci', 'csc']);
const LABELS = { subsystem: 'Subsystem', csci: 'CSCI', csc: 'CSC', csu: 'CSU', functional: 'Functional' };
const excerpt = (value, limit = 1200) => typeof value === 'string' && value.length > limit ? `${value.slice(0, limit)} … [excerpt; full text retained in saved evidence]` : value;

export function architectureDraftingGuidance(config) {
  const levels = [...new Set((config.architectureSources || []).filter(source => source.workspaceType === 'code-architecture').map(source => source.abstraction || 'functional'))];
  if (!levels.length) return null;
  const coarse = levels.every(level => COARSE.has(level));
  return { levels: levels.map(level => LABELS[level]), itemTarget: coarse ? 8 : 12,
    guidance: `Write at each source's selected abstraction: ${levels.map(level => LABELS[level]).join(', ')}. Subsystem describes subsystem responsibilities and external interactions; CSCI describes software configuration items and their interfaces; CSC describes software components and their interfaces; CSU describes software units; Functional describes functional responsibilities and exchanges. Do not expand higher-level sources into a function-by-function, file-by-file or implementation-call inventory. Preserve material constraints explicitly supplied at the selected level and distinct requirements from other documents. Counts and names alone are not evidence of behavior, performance or satisfaction. Detailed implementation evidence remains linked for inspection; do not claim it was exhaustively reviewed or infer omitted details.`,
  };
}

// Keep raw implementation provenance in storage, not repeated inside every AI
// request. A CSC with 10,000 calls is still one component at the selected level.
export function architectureDraftingElement(entry, diagram) {
  const element = entry.element;
  if (!element) return undefined;
  const level = entry.abstraction || element.abstraction;
  const code = entry.workspaceType === 'code-architecture' || !!level;
  if (!code) return null; // Preserve the existing native project projection.
  const coarse = COARSE.has(level);
  const relationships = element.relationships || element.internalRelationships || [];
  const nodeName = id => diagram?.nodes.get(id)?.label;
  const result = { label: excerpt(element.label, 300), withinBoundary: nodeName(element.parentId),
    from: nodeName(element.from), to: nodeName(element.to), details: element.details,
    abstraction: LABELS[level] || 'Functional', implementationElementCount: element.members?.length || 0,
    implementationRelationshipCount: relationships.length,
    detailPolicy: coarse ? 'Selected-level responsibilities and interfaces only. Lower-level member descriptions, files and implementation calls are retained as traceable evidence, not drafting context.'
      : 'Detailed unit or functional context with bounded implementation examples. Examples are not an exhaustive implementation review; full evidence is retained.',
  };
  if (!coarse) {
    result.files = (element.files || []).slice(0, 20);
    result.additionalFileCount = Math.max(0, (element.files?.length || 0) - 20);
    result.memberExamples = (element.members || []).slice(0, 20).map(member => ({ label: excerpt(member.label, 300), details: excerpt(member.details), files: (member.files || []).slice(0, 3) }));
    result.additionalMemberCount = Math.max(0, (element.members?.length || 0) - 20);
    result.relationshipExamples = relationships.slice(0, 20).map(edge => ({ from: excerpt(edge.row?.fromFunction, 300), to: excerpt(edge.row?.toFunction, 300), label: excerpt(edge.label, 300), details: excerpt(edge.details) }));
    result.additionalRelationshipCount = Math.max(0, relationships.length - 20);
    if (element.row) {
      // Functional rows can embed the entire implementation several times in
      // codeEvidence, sourceEvidence and functionalModel. Use their actual
      // functional exchange instead; do not recursively expand that provenance.
      const row = element.row;
      result.relationship = { ...Object.fromEntries(Object.entries(row).filter(([key]) => !/(?:id|hash|lineage|sourceRefs|indices|index|rowRef)$/i.test(key) && !/evidence|^functionalModel$|^functionalAbstraction$/i.test(key))),
        kind: row.functionalModel?.kind, significance: row.functionalModel?.significance };
    }
  }
  return result;
}

export const architectureContextTitle = entry => entry.workspaceType === 'code-architecture' || entry.abstraction ? excerpt(entry.title, 300) : entry.title;
