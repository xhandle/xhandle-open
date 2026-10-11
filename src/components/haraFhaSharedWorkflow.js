import { auditSafetyClassificationRecord } from '../features/project-hazard-analysis/safetySignificancePolicy';
// Shared CBA presentation/workflow fields. Risk ratings remain method-owned.
export const HARA_FHA_SHARED_FIELDS = [
  ['guidePhrase', 'Guide Phrase'],
  ['guidePhraseApplicable', 'Guide Phrase Applicable'],
  ['guidePhraseApplicabilityRationale', 'Guide Phrase Applicability Rationale'],
  ['guidePhraseApplicabilityReviewStatus', 'Guide Phrase Applicability Review Status'],
  ['controlActionType', 'Control Action Type'],
  ['causalFactors', 'Causal Factors'],
  ['causalFactorCategory', 'Causal Factor Category'],
  ['mitigationStrategy', 'Mitigation Strategy'],
  ['systemRequirement', 'System Requirement'],
  ['verification', 'Verification Method'],
  ['acceptanceCriteria', 'Acceptance Criteria'],
  ['safetyClassification', 'Safety Classification'],
  ...['causalPathType','causalEffect','resultingSystemState','intermediateSafetyFunction','intermediateSafetyEffect','protectionAssessment','protectionStatus','physicalHarmChainTermination','safetyClassificationRule','classificationEvidence'].map(key => [key, key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())]),
];
export const HARA_FHA_GENERATED_FIELDS = ['controlActionType', 'causalFactors', 'causalFactorCategory', 'mitigationStrategy', 'systemRequirement', 'acceptanceCriteria'];
export const HARA_FHA_WORKFLOW_PROMPT = `
For Code-Based Architecture, also return controlActionType, causalFactors, causalFactorCategory,
mitigationStrategy, systemRequirement, acceptanceCriteria, guidePhraseApplicable, and guidePhraseApplicabilityRationale.
Assess applicability to the exact supplied guidePhrase in its operating context, independently for each input id.
There are seven separate deviations per relationship/context: omission, provision, early, late,
wrong order, stopped too soon, and applied too long. Never merge these rows or substitute a generic failure assessment.
For HARA, connect that specific deviation to malfunction, hazardous event, S/E/C, ASIL and safety goal.
For FHA, connect that specific deviation to functional degradation/loss, mishap, severity, SCC and SwCI.
If the particular deviation has no meaningful semantics for this interface/context, mark No with a reason.
Do not assume all seven apply, and do not copy a single decision or hazard across the group.
Do not apply STPA command-only screening: information and supporting functions can have meaningful HARA/FHA failures.
Applicability is Yes, No, or Needs Review (only when applicability itself is unresolved).
Input Yes/No decisions and their rationale are governed inputs: copy them unchanged.
If No, do not generate a hazard, risk rating, goal, or requirement; use Not applicable for those fields.
For unresolved applicability do not assert a resolved risk rating or actionable safety requirement; use Needs review with reasons.
Identify the concrete causal category and mitigation. Keep systemRequirement separate from safetyGoal
and safetyRequirement (the software allocation). Provide a testable acceptanceCriteria without invented numerical thresholds;
use Needs review with a reason when evidence is insufficient. controlActionType describes the actual interface,
including data/information or support; do not invent command authority.
`;
export function sharedWorkflowFields(row, item) {
  if (!item.operationalContext) return {};
  const result = Object.fromEntries(HARA_FHA_SHARED_FIELDS.map(([key]) => [key, String(row[key] || '').trim()]));
  result.guidePhrase = item.guidePhrase || row.guidePhrase || '';
  if (/^(Yes|No)$/i.test(item.guidePhraseApplicable || '')) {
    result.guidePhraseApplicable = /^yes$/i.test(item.guidePhraseApplicable) ? 'Yes' : 'No';
    result.guidePhraseApplicabilityRationale = item.guidePhraseApplicabilityRationale || '';
    result.guidePhraseApplicabilityReviewStatus = item.guidePhraseApplicabilityReviewStatus || '';
  }
  return result;
}
export function appendSharedWorkflowFields(additions, rows) {
  return Object.fromEntries(Object.entries(additions).map(([name, sheet]) => {
    const missing = HARA_FHA_SHARED_FIELDS.filter(([, label]) => !sheet[0].includes(label));
    return [name, [[...sheet[0], ...missing.map(([, label]) => label)], ...sheet.slice(1).map((cells, i) => [...cells, ...missing.map(([key]) => rows[i]?.[key] || '')])]];
  }));
}
export function getCbaMethodDraftHeaders(method, fallback) {
  const fields = method === 'HARA'
    ? ['Item / Function', 'Malfunction', 'Hazard', 'Hazardous Event', 'Severity', 'Exposure', 'Controllability', 'ASIL', 'Safety Goal']
    : method === 'FHA' ? ['Function', 'Functional Degradation / Loss', 'Hazard', 'Mishap', 'Effect', 'Severity Category', 'Software Control Category', 'Software Criticality Index', 'LOR Tasks'] : [];
  return fields.length ? [...new Set([...fallback, ...fields, 'Software Safety Requirement', 'Verification', ...HARA_FHA_SHARED_FIELDS.map(([, label]) => label)])] : fallback;
}

export function validateMethodClassification(row, tag, item) {
  const audited = auditSafetyClassificationRecord({...row, ...tag, guidePhraseApplicable:row.guidePhraseApplicable}, item);
  if (!String(tag?.safetySignificanceRationale || '').trim() || /needs review|not generated/i.test(tag?.safetySignificanceRationale || '')) {
    audited.validationFindings.push('Classification rationale is missing or unresolved.');
  }
  if (audited.validationFindings.length) {
    audited.safetyClassification='Needs Review'; audited.safetySignificant='Needs Review'; audited.proposedSafetyAssessment='Needs Review';
    audited.safetySignificanceRationale='Needs review: '+audited.validationFindings.join(' ');
  }
  return audited;
}
