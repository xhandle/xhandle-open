import { consolidateSafetyIssues } from '../../project-hazard-analysis/safetyIssueGeneration';
import { buildActionableHazardFamilies, outsideSafetyScope } from './actionableHazardFamilies';
import { hazardIssueCells } from './actionableSafetyIssue';
import { semanticHash } from './artifactModel';
import { consolidateHazardRows } from './consolidateHazardRows';
import { hazardIssueEvidenceHash } from './hazardIssueEvidence';

// HTL only adapts saved assessment rows and maps the result back to records.
// Projects owns the shared semantic issue-generation rules and AI request.
export async function generateHazardSafetyIssues({ objects, meta, saved, request, checkpoint, signal, onProgress, onPrepared, onPartial }) {
  const raw = objects.map(object => { const { hazardEquivalence, ...row } = object; return row; });
  const all = buildActionableHazardFamilies(raw);
  await onPrepared?.(all);
  const eligible = all.filter(object => !object.deleted && object.hazardTrackingRow && !outsideSafetyScope(object));
  const safetyRows = eligible.map((object, index) => ({ sourceIndex: index + 1, sourceRowId: object.sourceEvidence?.[0]?.sourceRowId || object.id, cells: hazardIssueCells(object.attributes) }));
  const materialize = issues => {
    const tags = new Map(), descriptions = new Map();
    for (const issue of issues) {
      const members = issue.sourceIndexes.map(index => eligible[index - 1]);
      const families = new Set(members.map(row => row.hazardFamily.id));
      if (families.size === 1) { descriptions.set(`family:${members[0].hazardFamily.id}`, { title: issue.title, description: issue.description }); continue; }
      const groupId = `projects:${semanticHash(members.map(row => [row.id, row.hazardFamily.signature]).sort((a, b) => a[0].localeCompare(b[0])))}`;
      descriptions.set(`equivalent:${groupId}`, { title: issue.title, description: issue.description });
      for (const row of members) tags.set(row.id, groupId);
    }
    const grouped = all.map(row => tags.has(row.id) ? { ...row, hazardEquivalence: { groupId: tags.get(row.id), signature: row.hazardFamily.signature, method: 'projects' } } : row);
    const summaries = Object.fromEntries(consolidateHazardRows(grouped).filter(group => descriptions.has(group.id)).map(group => [group.id, { ...descriptions.get(group.id), evidenceHash: hazardIssueEvidenceHash(group) }]));
    return grouped.map(object => object.kind === 'section' && object.sectionId === 's2' ? { ...object, hazardIssueSummaries: summaries } : object);
  };
  const source = eligible[0]?.sourceEvidence?.[0];
  const issues = await consolidateSafetyIssues(safetyRows, { projectId: meta.config.projectId, projectName: source?.projectName || meta.config.system || meta.title, hazardMethod: source?.hazardMethod || 'Saved hazard analysis', saved, request, checkpoint, signal, onProgress, onPartial: onPartial ? issues => onPartial(materialize(issues)) : undefined });
  return materialize(issues);
}
