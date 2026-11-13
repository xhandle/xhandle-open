import { describeSafetyIssueFamily } from '../../project-hazard-analysis/safetyIssueConsolidation';
import { projectHazardTrackingFields } from './hazardTrackingFields';
import { genericSafetyIssueTitle } from '../../project-hazard-analysis/safetyIssueGeneration';

// Reconstruct the functional-interface fields retained in HTL's Function cell.
// Both consolidation and its description use the same interpretation.
export function hazardIssueCells(attributes) {
  const cells = projectHazardTrackingFields(attributes);
  const parts = String(cells.Function || '').split(/\s*→\s*/);
  const from = parts[0], action = parts.length > 2 ? parts[1] : '', to = parts.length > 2 ? parts.slice(2).join(' → ') : parts[1] || '';
  return { ...cells, ...(from ? { 'Function (From)': from, 'Control Action': action, 'Function (To)': to } : {}) };
}

// Match the Projects safety-issue title and description. Only prose is derived;
// the source hazards, record membership and risk assessments are unchanged.
export function actionableSafetyIssue(group) {
  if (group.safetyIssue) return { title: group.safetyIssue.title, description: group.safetyIssue.description };
  const rows = (group.rows?.length ? group.rows : [{ attributes: group.attributes }]).map((row, index) => ({ sourceIndex: index + 1, cells: hazardIssueCells(row.attributes) }));
  const interfaces = [...new Set(rows.map(row => row.cells.Function).filter(Boolean))];
  const hazards = new Set(rows.map(row => row.cells.Hazard).filter(Boolean));
  if (!interfaces.length && !hazards.size) return { title: 'Safety concern needs definition', description: 'Record the hazard and affected function before defining an actionable safety issue.' };
  const issue = describeSafetyIssueFamily({ rows });
  if (interfaces.length > 1 || genericSafetyIssueTitle(issue.title) || /^Unsafe(?: system)? behavio[u]?r (?:across|involving)\b/i.test(issue.title)) return { title: 'Safety issue summary pending', description: 'Generate or resume consolidation to finish this issue summary. Completed issues and all associated assessments are retained.' };
  return issue;
}
export function actionableSafetyIssueDescription(group) {
  const issue = actionableSafetyIssue(group);
  return `${issue.title}\n${issue.description}`;
}
