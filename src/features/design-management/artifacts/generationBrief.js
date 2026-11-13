import { citationContext } from './artifactCitations';
import { semanticHash } from './artifactModel';
import { hazardEvidenceParts } from './hazardEvidenceParts';

export const BRIEF_VERSION = 2;
export const BRIEF_BUDGET = 60000;

// Review all source groups once per document, then reuse the resulting facts for
// its sections. Original evidence stays in the job's immutable source manifest.
export function briefGroups(sources) {
  const projection = citationContext(sources).sources;
  const entries = sources.entries.filter(entry => entry.sourceType !== 'project');
  const usedIds = new Set(entries.map(entry => entry.id));
  const groups = []; let group = [], size = 2;
  const add = (entry, length) => {
    if (group.length && size + length > 90000) { groups.push(group); group = []; size = 2; }
    group.push(entry); size += length;
  };
  projection.forEach((source, index) => {
    const length = JSON.stringify(source).length + 1;
    if (length > 90000 && entries[index].sourceType === 'hazard-tracking-record') {
      for (const part of hazardEvidenceParts(entries[index], source, usedIds)) {
        add(part, JSON.stringify(citationContext({ entries: [part] }).sources[0]).length + 1);
      }
      return;
    }
    if (length > 90000) throw new Error('A supporting source is too large for one evidence review. Saved work is retained; narrow or split that source before continuing.');
    add(entries[index], length);
  });
  if (group.length) groups.push(group);
  return groups;
}
export const needsBrief = sources => JSON.stringify(citationContext(sources).sources).length > 90000;
export function briefSources(facts) {
  return { entries: facts.map((fact, index) => ({ id: `brief:${index}:${semanticHash(fact).slice(0, 12)}`, sourceType: 'evidence-brief', title: fact.title, text: fact.text, kind: fact.kind, evidenceIssue: fact.evidenceIssue })) };
}
export function briefCitationMap(sources, facts) {
  return new Map(sources.entries.map((source, index) => [source.id, facts[index].sourceIds]));
}
export function resolveBriefCitations(response, citations) {
  if (!citations || !Array.isArray(response?.objects)) return response;
  return { ...response, objects: response.objects.map(object => !Array.isArray(object?.sourceIds) ? object : {
    ...object, sourceIds: [...new Set(object.sourceIds.flatMap(id => citations.has(id) ? citations.get(id) : [id]))],
    // An unresolved brief must remain unresolved, including after consolidation.
    ...(object.sourceIds.some(id => citations.gaps?.has(id)) ? { kind: 'gap' } : {}),
  }) };
}
export function mapBriefSources(sources, facts) {
  const map = briefCitationMap(sources, facts);
  map.gaps = new Set(sources.entries.filter((entry, index) => facts[index].kind === 'gap' || facts[index].evidenceIssue).map(entry => entry.id));
  return map;
}
export function deduplicateFacts(facts) {
  const seen = new Map();
  for (const fact of facts) {
    // Only collapse exact same claims and evidence; distinct requirements survive.
    const key = semanticHash({ kind: fact.kind, title: fact.title, text: fact.text, sourceIds: [...fact.sourceIds].sort(), evidenceIssue: fact.evidenceIssue });
    if (!seen.has(key)) seen.set(key, fact);
  }
  return [...seen.values()];
}
