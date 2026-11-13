import { buildSafetyIssueSourceFamilies } from '../../project-hazard-analysis/safetyIssueConsolidation';
import { isSafetyIssueEvidenceRow } from '../../project-hazard-analysis/safetyIssueEvidence';
import { HAZARD_TRACKING_COLUMNS, projectHazardTrackingFields } from './hazardTrackingFields';
import { semanticHash } from './artifactModel';
import { hazardIssueCells } from './actionableSafetyIssue';

const signatures = new WeakMap();
const familySignature = attributes => {
  if (!attributes || typeof attributes !== 'object') return semanticHash({});
  if (!signatures.has(attributes)) signatures.set(attributes, semanticHash(projectHazardTrackingFields(attributes)));
  return signatures.get(attributes);
};
export const actionableHazardTitle = functions => {
  const names = [...new Set(functions.filter(Boolean))];
  return names.length ? `Unsafe behavior involving ${names.slice(0, 3).join('; ')}${names.length > 3 ? ` and ${names.length - 3} related functions` : ''}` : 'Recorded safety concern';
};

// Share Projects' safety-scope and functional-interface consolidation rules.
// The original worksheet remains canonical; family metadata only changes how
// its assessments are presented as actionable tracking records.
export function buildActionableHazardFamilies(objects) {
  const scopes = new Map(), excluded = new Map();
  for (const object of objects) {
    if (object.deleted || !object.hazardTrackingRow) continue;
    const cells = projectHazardTrackingFields(object.attributes);
    if (!isSafetyIssueEvidenceRow(HAZARD_TRACKING_COLUMNS.map(column => cells[column] || ''), HAZARD_TRACKING_COLUMNS)) {
      excluded.set(object.id, { excluded: true, signature: familySignature(object.attributes) }); continue;
    }
    const source = object.sourceEvidence?.[0];
    const scope = JSON.stringify([source?.ownerProjects || [], source?.repoId || '']);
    if (!scopes.has(scope)) scopes.set(scope, []);
    scopes.get(scope).push({ object, cells, sourceIndex: scopes.get(scope).length + 1, familyCells: hazardIssueCells(cells) });
  }
  const membership = new Map(excluded);
  for (const [scope, rows] of scopes) {
    const families = buildSafetyIssueSourceFamilies(rows.map(row => ({ sourceIndex: row.sourceIndex, cells: row.familyCells })));
    for (const family of families) {
      const members = family.sourceIndexes.map(index => rows[index - 1]);
      for (const member of members) {
        const id = semanticHash([scope, family.key === '::' ? member.object.id : family.key]);
        membership.set(member.object.id, { id, signature: familySignature(member.object.attributes), excluded: false });
      }
    }
  }
  return objects.map(object => membership.has(object.id) ? { ...object, hazardFamily: membership.get(object.id) } : object);
}

export const validHazardFamily = object => object.hazardFamily?.signature === familySignature(object.attributes);
export const outsideSafetyScope = object => validHazardFamily(object) && object.hazardFamily.excluded;
