import { HAZARD_TRACKING_COLUMNS, hazardTrackingProjection, hazardEquivalenceSignature } from './hazardTrackingFields';
import { validHazardFamily, outsideSafetyScope, actionableHazardTitle } from './actionableHazardFamilies';
import { actionableSafetyIssue } from './actionableSafetyIssue';
import { hazardIssueEvidenceHash } from './hazardIssueEvidence';

const hazardKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const missing = value => !value || /^(?:n\/?a|none|not applicable|not specified|unknown|tbd|—|-)\.?$/i.test(value);
const recordNumber = row => Number.isSafeInteger(row.hazardTrackingRecordNumber) && row.hazardTrackingRecordNumber > 0 ? row.hazardTrackingRecordNumber : 0;
const nextRecordNumber = rows => rows.reduce((next, row) => Math.max(next, recordNumber(row) + 1, Number.isSafeInteger(row.hazardTrackingNextRecordNumber) ? row.hazardTrackingNextRecordNumber : 1), 1);

// Consolidation is a presentation of saved assessments, never a replacement for
// them. Keep each original row and its source identity so different scenarios,
// constraints, classifications and verification methods remain inspectable.
export function consolidateHazardRows(rows, { startNumber = 1, includeExcluded = false } = {}) {
  const summaries = rows.find(row => row.kind === 'section' && row.sectionId === 's2')?.hazardIssueSummaries || {};
  const groups = new Map();
  const projections = new Map();
  for (const row of rows) {
    if (row.deleted || !(row.hazardTrackingRow || (row.sectionId === 's2' && row.kind !== 'section'))) continue;
    if (!includeExcluded && outsideSafetyScope(row)) continue;
    const headers = Object.keys(row.attributes || {}), headerKey = JSON.stringify(headers);
    if (!projections.has(headerKey)) projections.set(headerKey, hazardTrackingProjection(headers));
    const attributes = projections.get(headerKey)(Object.values(row.attributes || {})).attributes;
    const hazard = hazardKey(attributes.Hazard);
    const reviewed = typeof row.hazardEquivalence?.groupId === 'string' && (row.hazardEquivalence.method === 'projects'
      ? validHazardFamily(row) && row.hazardEquivalence.signature === row.hazardFamily.signature
      : row.hazardEquivalence.signature === hazardEquivalenceSignature(attributes) && (row.hazardEquivalence.method !== 'actionable' || validHazardFamily(row)));
    const family = validHazardFamily(row) && !row.hazardFamily.excluded ? row.hazardFamily : null;
    const key = reviewed ? `equivalent:${row.hazardEquivalence.groupId}` : family ? `family:${family.id}` : missing(hazard) ? `assessment:${row.id}` : `hazard:${hazard}`;
    if (!groups.has(key)) { groups.set(key, { id: key, rows: [row], attributes, ...(family ? { actionable: true } : {}) }); continue; }
    const group = groups.get(key);
    if (!group.values) group.values = Object.fromEntries(HAZARD_TRACKING_COLUMNS.map(column => [column, new Set([group.attributes[column] || ''])]));
    group.rows.push(row);
    for (const column of HAZARD_TRACKING_COLUMNS) group.values[column].add(attributes[column] || '');
  }
  let next = Math.max(startNumber, nextRecordNumber(rows));
  const claimed = new Set();
  return [...groups.values()].map(group => {
    const existing = [...new Set(group.rows.map(recordNumber).filter(Boolean))].sort((a, b) => a - b);
    const number = existing.find(number => !claimed.has(number)) || next++;
    existing.forEach(number => claimed.add(number)); claimed.add(number);
    const functions = group.values ? [...group.values.Function] : [group.attributes.Function];
    const values = group.values ? Object.fromEntries(HAZARD_TRACKING_COLUMNS.map(column => [column, [...group.values[column]]])) : undefined;
    const saved = summaries[group.id];
    const safetyIssue = typeof saved?.title === 'string' && typeof saved?.description === 'string' && saved.evidenceHash === hazardIssueEvidenceHash(group) ? saved : undefined;
    const issue = actionableSafetyIssue({ ...group, values, safetyIssue });
    // Keep the combined search text while displaying and filtering each field independently.
    return { ...group, ...(safetyIssue ? { safetyIssue } : {}), issueTitle: issue.title, issueBody: issue.description, issueDescription: `${issue.title}\n${issue.description}`, ...(group.actionable && functions.some(Boolean) ? { summary: actionableHazardTitle(functions) } : {}), recordNumber: number, recordId: `HTR-${number}`,
      ...(group.values ? { values: Object.fromEntries(HAZARD_TRACKING_COLUMNS.map(column => [column, [...group.values[column]]])) } : {}),
    };
  });
}
export const hazardGroupValues = (group, column) => column === 'HTR' ? [group.recordId]
  : column === 'Actionable Safety Issue Title' ? [group.issueTitle ?? actionableSafetyIssue(group).title]
  : column === 'Actionable Safety Issue Description' ? [group.issueBody ?? actionableSafetyIssue(group).description]
  : group.values?.[column] || [group.attributes[column] || ''];

// Persist numbers with assessment identity. Earlier revisions seed existing
// identifiers; the section's high-water mark prevents reuse after deletions.
// Original assessment fields and semantic-review inputs remain unchanged.
export function assignHazardTrackingRecordNumbers(objects, previous = []) {
  const known = new Map();
  for (const group of consolidateHazardRows(previous)) for (const row of group.rows) known.set(row.id, recordNumber(row) || group.recordNumber);
  const inherited = objects.map(row => !recordNumber(row) && known.has(row.id) ? { ...row, hazardTrackingRecordNumber: known.get(row.id) } : row);
  let next = Math.max(nextRecordNumber(previous), nextRecordNumber(inherited));
  const numbers = new Map();
  for (const group of consolidateHazardRows(inherited, { startNumber: next })) {
    next = Math.max(next, group.recordNumber + 1);
    for (const row of group.rows) numbers.set(row.id, Math.max(recordNumber(row), group.recordNumber));
  }
  return inherited.map(row => {
    const number = numbers.get(row.id);
    if (number && recordNumber(row) !== number) return { ...row, hazardTrackingRecordNumber: number };
    if (row.kind === 'section' && row.sectionId === 's2' && row.hazardTrackingNextRecordNumber !== next) return { ...row, hazardTrackingNextRecordNumber: next };
    return row;
  });
}
