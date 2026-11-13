import { semanticHash } from './artifactModel';
import { projectHazardTrackingFields } from './hazardTrackingFields';

const hashes = new WeakMap();
export function hazardIssueEvidenceHash(group) {
  return semanticHash(group.rows.map(row => {
    const attributes = row.attributes || {};
    if (!hashes.has(attributes)) hashes.set(attributes, semanticHash(projectHazardTrackingFields(attributes)));
    return { id: row.id, hash: hashes.get(attributes) };
  }).sort((a, b) => a.id.localeCompare(b.id)));
}
