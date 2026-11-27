import { positiveFailureBasis, diagnosticOnlyTiming, implementationGoal, unsafeBrakingGate } from './haraAssessmentQuality';

export const HARA_DERIVATION_GUIDANCE = `Keep emergency stopping and necessary vehicle control available. Restrict planned-stop sequencing only; position, mission-phase and command-freshness gates must not inhibit emergency braking. Adapt an unsafe inherited STPA requirement in HARA without changing the STPA source.
Identify operationalSituation separately from the malfunction: describe normal use, road/traffic/people and relevant phase, without requiring a fault to occur. Exposure describes that situation's frequency/duration over intended use. A rare malfunction never lowers exposure. Use one class for equivalent situations; different normal sub-situations may differ.
Derive FTTI from fault-to-hazard dynamics, then allocate detection AND response within it. A chosen freshness threshold, timeout, control cycle or warning interval cannot establish the hazard interval. Use distance/speed, stopping behavior or another event-specific hazard argument. A symbolic timing bound is acceptable when numerical dynamics are unavailable; do not invent measurements.
Write a concise item/vehicle-level safety goal describing the hazardous motion, loss of stopping, unintended release or other harm to prevent. Put interface names, validation, timestamps and sequencing mechanisms in functionalSafetyRequirements. Reuse a shared goal only for the same harm-prevention objective. Preserve different outcomes.`;

export function practicalHaraDecisionIssues(row = {}) {
  const issues = [];
  if (positiveFailureBasis(row.exposureRationale)) issues.push('EXPOSURE: derive the class from normal operational-situation frequency, excluding malfunction probability.');
  if (diagnosticOnlyTiming(row.fttiRationale)) issues.push('FTTI: derive a fault-to-hazard bound independently of freshness/detection thresholds; allocate the response inside it.');
  if (unsafeBrakingGate([row.safetyGoal,row.safeState,row.functionalSafetyRequirements].filter(Boolean).join('\n'))) issues.push('BRAKING: replace blanket brake inhibition with planned-stop sequencing that preserves emergency braking and necessary stopping authority.');
  if (implementationGoal(row.safetyGoal)) issues.push('GOAL: express the item/vehicle harm-prevention objective; retain mechanisms in linked functional requirements.');
  return issues;
}

export const emergencyBrakingRequirement = 'The vehicle shall preserve emergency braking and necessary stopping authority regardless of planned-stop position, mission phase or operator-command freshness. Planned-stop sequencing gates shall apply only to non-emergency planned braking and shall yield to a required emergency response.';

/** Applied only during generation, never while viewing or editing user results. */
export function completePracticalHaraQuality(row, defaults) {
  const result = {...row};
  if (positiveFailureBasis(result.exposureRationale)) {
    result.exposure = defaults.exposure;
    result.exposureRationale = defaults.exposureRationale;
    result.decisionBasis = 'Engineering judgment';
  }
  if (diagnosticOnlyTiming(result.fttiRationale)) {
    result.candidateTiming = [result.candidateTiming, result.ftti].filter(Boolean).join('\n');
    result.ftti = defaults.ftti;
    result.fttiRationale = defaults.fttiRationale;
  }
  if (unsafeBrakingGate(result.safetyGoal)) result.safetyGoal = 'The vehicle shall prevent unintended braking while preserving emergency stopping capability.';
  if (unsafeBrakingGate(result.safeState)) {
    result.safeState = defaults.safeState;
    result.safeStateJustification = defaults.safeStateJustification;
  }
  if (unsafeBrakingGate(result.functionalSafetyRequirements)) {
    // Do not keep an affirmative prohibition alongside a contradictory override.
    // The original wording remains in the immutable STPA foundation.
    result.functionalSafetyRequirements = emergencyBrakingRequirement;
  }
  if (implementationGoal(result.safetyGoal)) {
    // Mechanisms remain requirements, rather than being discarded or called a goal.
    result.functionalSafetyRequirements = [...new Set([result.functionalSafetyRequirements,result.safetyGoal].filter(Boolean))].join('\n');
    result.safetyGoal = defaults.safetyGoal;
    result.safetyGoalRationale = defaults.safetyGoalRationale;
  }
  return result;
}
