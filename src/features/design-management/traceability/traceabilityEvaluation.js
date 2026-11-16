import { checkRelationship, matchingRules, STAGES, RELATIONSHIPS, profileKey } from './traceabilityModel';
import { semanticHash } from '../artifacts/artifactModel';

export async function evaluateTraceability({ profile, nodes, availability, links = [], exclusions = [], stage = 'definition' }, { signal, onProgress, yieldEvery = 400 } = {}) {
  if (!STAGES.includes(stage)) throw Error('Select a valid traceability assessment stage.');
  const byId = new Map(nodes.map(node => [node.id, node])), byRole = new Map(profile.roles.map(role => [role.id, []]));
  for (const node of nodes) for (const role of node.roles) byRole.get(role)?.push(node);
  const edges = [], index = new Map(), findings = [], rows = [], totals = {};
  let work = 0;
  const checkpoint = async () => {
    if (signal?.aborted) throw new DOMException('Assessment cancelled', 'AbortError');
    if (++work % yieldEvery === 0) { onProgress?.(work); await new Promise(resolve => setTimeout(resolve, 0)); }
  };
  for (const link of links) {
    await checkpoint(); if (link.state === 'retired') continue;
    let state = link.state, error = '';
    try {
      if (!['proposed', 'confirmed'].includes(state)) throw Error('The stored relationship has an invalid review state.');
      const { source, target, rules } = checkRelationship(profile, byId, link);
      if (state === 'confirmed' && (source.hash !== link.sourceHash || target.hash !== link.targetHash || profileKey(link.profile || {}) !== profileKey(profile) || source.draft || target.draft || source.unresolved || target.unresolved)) state = 'suspect';
      for (const rule of rules.filter(rule => rule.allowed)) {
        for (const id of [link.from, link.to]) {
          const key = JSON.stringify([rule.id, id]); if (!index.has(key)) index.set(key, []); index.get(key).push({ ...link, state });
        }
      }
    } catch (cause) { state = 'invalid'; error = cause.message; findings.push({ id: link.id, status: state, message: error }); }
    edges.push({ ...link, state, error });
  }
  const excluded = new Map(exclusions.filter(item => item.reviewed && item.rationale?.trim()).map(item => [JSON.stringify([item.ruleId, item.nodeId, item.side]), item]));
  for (const rule of profile.rules.filter(rule => rule.allowed && STAGES.indexOf(rule.stage) <= STAGES.indexOf(stage))) {
    const counts = { Covered: 0, Missing: 0, Suspect: 0, Proposed: 0, Invalid: 0, Excluded: 0, 'Not assessed': 0 };
    for (const [side, roles, minimum, maximum] of [['source', [rule.from], rule.minSource, rule.maxSource], ['target', rule.to, rule.minTarget, rule.maxTarget]]) {
      if (!minimum && maximum === null) continue;
      const subjects = [...new Map(roles.flatMap(role => byRole.get(role) || []).map(node => [node.id, node])).values()];
      const counterpartRoles = side === 'source' ? rule.to : [rule.from];
      const unavailable = counterpartRoles.every(role => !availability[role]?.ready);
      for (const node of subjects) {
        await checkpoint();
        const related = (index.get(JSON.stringify([rule.id, node.id])) || []).filter(link => side === 'source' ? link.from === node.id : link.to === node.id);
        const confirmed = related.filter(link => link.state === 'confirmed').length;
        const exclusion = excluded.get(JSON.stringify([rule.id, node.id, side]));
        const validExclusion = exclusion && exclusion.hash === node.hash && exclusion.ruleHash === semanticHash(rule);
        let status = validExclusion ? 'Excluded' : maximum !== null && related.length > maximum ? 'Invalid' : node.draft || node.unresolved || unavailable ? 'Not assessed' : confirmed >= minimum ? 'Covered' : related.some(link => link.state === 'suspect') ? 'Suspect' : related.some(link => link.state === 'proposed') ? 'Proposed' : 'Missing';
        counts[status]++;
        rows.push({ id: JSON.stringify([rule.id, node.id, side]), nodeId: node.id, objectId: node.objectId, artifactId: node.artifactId,
          ID: node.displayId || node.objectId, Title: node.title, Description: node.text, Artifact: node.artifactTitle, Rule: rule.id,
          Relationship: RELATIONSHIPS[rule.type][side === 'source' ? 0 : 1], Targets: related.map(link => byId.get(side === 'source' ? link.to : link.from)?.title || 'Unavailable object').join('\n'),
          Status: status, Finding: validExclusion ? exclusion.rationale : exclusion ? 'Exclusion needs review against changed content.' : unavailable ? `Bind available ${counterpartRoles.join(' or ')} evidence.` : node.draft ? 'Draft evidence does not establish confirmed coverage.' : node.unresolved ? 'This object has unresolved evidence.' : status === 'Covered' ? `${confirmed} reviewed current relationship(s).` : `Expected ${minimum}–${maximum ?? 'many'} reviewed relationship(s); ${confirmed} current.`,
          severity: rule.severity, side, ruleId: rule.id, hash: node.hash });
      }
      if (!subjects.length) {
        counts['Not assessed']++;
        rows.push({ id: `${rule.id}:${side}:unavailable`, ID: '—', Title: roles.map(id => profile.roles.find(role => role.id === id)?.label).join(' / '), Rule: rule.id, Relationship: RELATIONSHIPS[rule.type][side === 'source' ? 0 : 1], Status: 'Not assessed', Finding: 'No applicable saved objects are available in the bound scope.', severity: rule.severity, side, ruleId: rule.id });
      }
    }
    totals[rule.id] = counts;
  }
  const summary = rows.reduce((result, row) => ({ ...result, [row.Status]: (result[row.Status] || 0) + 1 }), {});
  return { rows, edges, findings, totals, summary, nodes, availability, stage, assessedAt: new Date().toISOString() };
}

export const relationshipApplies = (profile, source, target, type) => matchingRules(profile, source, target, type).some(rule => rule.allowed);
