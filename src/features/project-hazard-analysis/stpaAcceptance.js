import { STPA_COMPLETION_POLICY, STPA_COMPLETION_GUIDANCE, isStpaCompletionPlaceholder, stpaMinimumAssessmentIssues } from '../code-architecture-hazard-analysis/stpaCompletionPolicy';
import { createSafetyModelId, inferCausalFactorCategory, normalizeControlActionType, normalizeNonApplicableHazardRecord, semanticGuidePhrase } from './hazardSafetyModel';
import { applicabilityIsReadOnly } from './applicabilityOwnership';
import { containsAffirmativeHarmPath } from './safetySignificancePolicy';

export { STPA_COMPLETION_POLICY, STPA_COMPLETION_GUIDANCE };
const text = value => typeof value === 'string' ? value.trim() : '';
const notApplicable = value => /^not applicable$/i.test(text(value));
export const unresolvedStpaValue = value => isStpaCompletionPlaceholder(value)
  || /^(?:not assessed|undetermined|indeterminate|uncertain|evidence gap|not evaluated)(?:$|\s*[:—-])/i.test(text(value))
  || /\b(?:needs? review|to be determined|TBD|TBC)\b/i.test(text(value));
export function needsPracticalStpaCompletion(headers = [], row = []) {
  if (headers.includes('Hazardous Event ID')) return false;
  const at = names => row[headers.findIndex(header => names.includes(header))];
  if (!headers.some(header => ['Unsafe Control Action', 'Unsafe Control Actions'].includes(header))) return false;
  const applicable = decision(at(['Guide Phrase Applicable']));
  if (!applicable || unresolvedStpaValue(at(['Guide Phrase Applicability Rationale']))) return true;
  if (applicable === 'No') return false;
  return [['Loss', 'Losses'], ['Hazard', 'Hazards'], ['Unsafe Control Action', 'Unsafe Control Actions'], ['Causal Scenario'],
    ['Causal Factor', 'Causal Factors'], ['Safety Constraint', 'Safety Requirements/Constraints'], ['System Requirement'], ['Verification Method'],
    ['Safety Classification'], ['Safety Significance Rationale']].some(names => unresolvedStpaValue(at(names)) || notApplicable(at(names)));
}
const useful = (value, fallback) => unresolvedStpaValue(value) ? fallback : text(value);
const decision = value => /^yes$/i.test(text(value)) ? 'Yes' : /^(?:no|not applicable)$/i.test(text(value)) ? 'No' : '';
const classifications = ['Safety — Direct', 'Safety — Related', 'Mission/Reliability'];
const lockedApplicability = item => decision(item.guidePhraseApplicable) && (applicabilityIsReadOnly(item) || decision(item.guidePhraseApplicable) === 'No');

// Same minimum-usable bar as Code-Based Architecture, applied to the existing
// Projects fields. This module neither generates analyses nor changes engines.
export function usableProjectStpaAssessment(row = {}, item = {}) {
  if (![item.id, `${item.id}-STPA`].includes(row.id)) return false;
  const applicable = lockedApplicability(item) ? decision(item.guidePhraseApplicable) : decision(row.guidePhraseApplicable);
  const source = { id: item.id, action: item.controlAction,
    reviewedApplicability: lockedApplicability(item) ? applicable : '' };
  const assessment = { id: item.id, assessedAction: item.controlAction, applicable,
    applicabilityRationale: lockedApplicability(item) ? item.guidePhraseApplicabilityRationale || row.guidePhraseApplicabilityRationale : row.guidePhraseApplicabilityRationale,
    classification: applicable === 'No' ? 'Not applicable' : row.safetyClassification,
    classificationRationale: row.safetySignificanceRationale || row.proposedSafetyAssessmentRationale,
    assumptions: item.contextAssumptions || 'No additional assumptions.',
    uca: row.unsafeControlActions, loss: row.losses, hazard: row.hazards,
    causalScenario: row.causalScenario, causalFactor: row.causalFactors,
    safetyConstraint: row.safetyRequirementsConstraints, softwareRequirement: row.systemRequirement, verification: row.verificationMethod };
  return !stpaMinimumAssessmentIssues(assessment, source).length
    && (applicable === 'No' || ['uca', 'loss', 'hazard', 'causalScenario', 'causalFactor', 'safetyConstraint', 'softwareRequirement', 'verification'].every(key => !notApplicable(assessment[key])))
    && Object.entries(assessment).filter(([key]) => applicable !== 'No' || ['applicable', 'applicabilityRationale'].includes(key)).every(([, value]) => !unresolvedStpaValue(value));
}

export function mergeProjectStpaCandidate(previous = {}, next = {}) {
  return { ...previous, ...Object.fromEntries(Object.entries(next).filter(([, value]) => !unresolvedStpaValue(value))) };
}

export function completeProjectStpaAssessment(candidate = {}, item = {}) {
  const row = { ...candidate, id: [item.id, `${item.id}-STPA`].includes(candidate.id) ? candidate.id : `${item.id}-STPA`, completionPolicy: STPA_COMPLETION_POLICY };
  const action = item.controlAction || 'the modeled interaction', from = item.from || 'the controller', to = item.to || 'the receiving function';
  const applicable = (lockedApplicability(item) && decision(item.guidePhraseApplicable)) || decision(row.guidePhraseApplicable) || 'Yes';
  row.guidePhraseApplicable = applicable;
  row.guidePhraseApplicabilityRationale = lockedApplicability(item)
    ? useful(item.guidePhraseApplicabilityRationale, useful(row.guidePhraseApplicabilityRationale, `The supplied decision applies to “${action}” at this interface.`))
    : useful(row.guidePhraseApplicabilityRationale, `The selected deviation can change the interaction result used by ${to}.`);
  if (applicable === 'No') return normalizeNonApplicableHazardRecord(row, row.guidePhraseApplicabilityRationale);

  const type = normalizeControlActionType(row.controlActionType || item.controlActionType, item);
  const deviation = semanticGuidePhrase(type, item.guidePhrase || 'Providing the control action causes a hazard');
  const defaults = {
    unsafeControlActions: `${from}: “${action}” has the selected deviation (${deviation}) when ${to} requires the interaction result.`,
    losses: `The operation supported by ${to} does not achieve its intended outcome.`,
    hazards: `${to} performs its dependent operation using an absent, invalid or obsolete result of “${action}”.`,
    causalScenario: `An input, sequence or result-validity error in “${action}” produces the selected deviation, and ${to} uses the affected result for its dependent operation.`,
    causalFactors: `Incorrect input, sequence or result-validity conditions at the ${from} to ${to} interface.`,
    mitigationStrategy: `${from} and ${to} enforce the interaction's operating preconditions and reject invalid or obsolete results.`,
    safetyRequirementsConstraints: `The ${to} shall use the result of “${action}” only while its operating preconditions and result-validity conditions hold.`,
    systemRequirement: `The ${to} shall reject an absent, invalid or obsolete result of “${action}” before using it for the dependent operation.`,
    verificationMethod: `Simulate the selected deviation of “${action}” under the stated operating conditions and observe the response at ${to}; repeat with a valid interaction result.`,
    acceptanceCriteria: `${to} rejects the deviating result and accepts the expected result when the operating preconditions hold.`,
    requirementParameterSource: 'Functional interaction and operational context',
  };
  for (const [field, fallback] of Object.entries(defaults)) row[field] = notApplicable(row[field]) ? fallback : useful(row[field], fallback);
  for (const field of ['systemRequirement', 'safetyRequirementsConstraints']) if (!/\bshall\b/i.test(row[field])) row[field] = defaults[field];
  let classification = classifications.includes(row.safetyClassification) ? row.safetyClassification
    : containsAffirmativeHarmPath([row.losses, row.hazards, row.causalScenario].join(' ')) ? 'Safety — Related' : 'Mission/Reliability';
  if (/^reviewed$/i.test(item.safetySignificanceReviewStatus || '')) {
    if (decision(item.safetySignificant) === 'No') classification = 'Mission/Reliability';
    else if (decision(item.safetySignificant) === 'Yes' && classification === 'Mission/Reliability') classification = 'Safety — Related';
  }
  row.safetyClassification = classification;
  row.safetySignificant = classification === 'Mission/Reliability' ? 'No' : 'Yes';
  row.safetySignificanceRationale = useful(row.safetySignificanceRationale || row.proposedSafetyAssessmentRationale,
    classification === 'Mission/Reliability' ? `The assessed outcome concerns completion and correctness of the operation supported by ${to}.`
      : `The assessed deviation contributes to the hazardous state described for the operation supported by ${to}.`);
  const rulePattern = classification === 'Safety — Direct' ? /^D[1-3]$/ : classification === 'Safety — Related' ? /^R[1-4]$/ : /^M[1-4]$/;
  if (!rulePattern.test(row.safetyClassificationRule || '')) row.safetyClassificationRule = classification === 'Safety — Direct' ? 'D1' : classification === 'Safety — Related' ? 'R1' : 'M1';
  row.causalPathType = classification === 'Safety — Direct' ? 'Direct' : classification === 'Safety — Related' ? 'Contributory' : 'None';
  row.causalEffect = useful(row.causalEffect, row.causalScenario);
  row.resultingSystemState = useful(row.resultingSystemState, row.hazards);
  row.intermediateSafetyFunction = classification === 'Safety — Related' ? useful(row.intermediateSafetyFunction, to) : 'Not applicable';
  row.intermediateSafetyEffect = classification === 'Safety — Related' ? useful(row.intermediateSafetyEffect, row.causalScenario) : 'Not applicable';
  row.causalFactorCategory = useful(row.causalFactorCategory, inferCausalFactorCategory(row.causalFactors));
  row.rawLossCandidate = useful(row.rawLossCandidate, row.losses);
  row.rawHazardCandidate = useful(row.rawHazardCandidate, row.hazards);
  row.canonicalLossId = useful(row.canonicalLossId, createSafetyModelId('L', row.losses));
  row.canonicalHazardId = useful(row.canonicalHazardId, createSafetyModelId('H', row.hazards));
  // Optional audit evidence is not required for a completed AI assessment.
  // Leave absent evidence blank instead of inventing proof or review statuses.
  for (const field of ['protectionAssessment', 'protectionStatus', 'physicalHarmChainTermination', 'classificationEvidence', 'classificationConfidence']) {
    if (unresolvedStpaValue(row[field])) row[field] = '';
  }
  for (const [field, value] of Object.entries(row)) if (typeof value === 'string' && unresolvedStpaValue(value)) row[field] = '';
  return row;
}
