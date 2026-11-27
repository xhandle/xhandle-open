import { haraFinalReviewFindings, internalMitigationCredit, invalidHaraTiming, unsafeLateStopRule,
  identifiedHaraFinding, validateHaraFinding, inspectHaraReviewTable, haraReviewBatchContext,
  failureConditionedExposure, haraTimingResponseOverrun, invalidRequirementTiming } from './haraReviewInspection';
import { validateHaraReviewPatch, haraReviewChangeGroups } from './haraFinalReview';

const sound = {
  Severity: 'S3', 'Severity Rationale': 'Impact can fatally injure a pedestrian.',
  Exposure: 'E3', 'Exposure Rationale': 'Occupied curb maneuvers are a routine service phase.',
  Controllability: 'C3', 'Controllability Rationale': 'Pedestrians cannot avoid impact within the available time.',
  'Potential Harm': 'Fatal pedestrian injury.', 'Hazardous Event': 'Vehicle enters the occupied curb zone without stopping.',
  'Safety Goal': 'The vehicle shall prevent unintended motion in the occupied curb zone.',
  'Fault Tolerant Time Interval': 'clearance distance / closing speed',
  'FTTI Rationale': 'Fault-to-hazard time is clearance divided by closing speed; detection and complete response must finish earlier.',
  'Functional Safety Requirements': 'The vehicle shall preserve necessary emergency braking.',
};
const record = row => ({ id: 'synthetic-row', hash: 'snapshot', row, locked: [], findings: haraFinalReviewFindings(row) });

test('controllability cannot credit a required/internal automatic safeguard as implemented human avoidance', () => {
  const bad = 'The system implements automated freshness validation and inhibits motion. This system-level control prevents collision independently of operator detection.';
  expect(internalMitigationCredit(bad)).toBe(true);
  expect(haraFinalReviewFindings({ ...sound, Controllability: 'C1', 'Controllability Rationale': bad }).map(issue => issue.code)).toContain('MITIGATION_CREDIT');
  expect(internalMitigationCredit('Do not credit automatic inhibition; the pedestrian can step clear with ample time.')).toBe(false);
  expect(haraFinalReviewFindings({ ...sound, Controllability: 'C1', 'Controllability Rationale': 'An attentive pedestrian can easily step clear within the available time, without credit for internal braking.' })).toEqual([]);
});

test('limited ability to prevent a fault is not automatically inability to avoid harm or proof of C3', () => {
  const row = { ...sound, Controllability: 'C2', 'Controllability Rationale': 'The operator cannot prevent initial command corruption, but sees the motion and can command braking with enough time for most exposed people to avoid contact.' };
  expect(haraFinalReviewFindings(row)).toEqual([]);
  expect(haraFinalReviewFindings({ ...row, Controllability: 'C0', 'Controllability Rationale': 'Collision has already occurred and cannot be avoided.' }).some(issue => issue.code === 'CONTROLLABILITY')).toBe(true);
});

test('detects no-human-action arguments without erasing independent pedestrian avoidance', () => {
  const bad = 'Operator cannot issue corrective commands; bystanders cannot control vehicle. Operator has no opportunity to intervene; detection and response are automatic system functions.';
  expect(haraFinalReviewFindings({ ...sound, Controllability: 'C1', 'Controllability Rationale': bad }).map(issue => issue.code)).toContain('CONTROLLABILITY');
  expect(haraFinalReviewFindings({ ...sound, Controllability: 'C1', 'Controllability Rationale': 'The operator is incapacitated, but pedestrians can easily step clear with ample time before contact.' })).toEqual([]);
});

test('exposure cannot be conditioned on how often data loss occurs, while explicit exclusions remain sound', () => {
  expect(failureConditionedExposure('Exposure is the frequency of missions during which task-data loss occurs.')).toBe(true);
  expect(failureConditionedExposure('Data unavailability is infrequent, so E2.')).toBe(true);
  expect(failureConditionedExposure('Exposure is the frequency of occupied crossings, independently of data loss.')).toBe(false);
  expect(failureConditionedExposure('Exposure excludes malfunction probability. Occupied crossings are frequent.')).toBe(false);
  const original = record(sound), patch = { id: original.id, hash: original.hash, reason: 'Change exposure.',
    changes: { Exposure: 'E2', 'Exposure Rationale': 'Exposure is the frequency of missions during which task-data loss occurs.' } };
  expect(validateHaraReviewPatch(original, patch)).toContain('Unresolved correction: EXPOSURE.');
});

test('detection cannot consume the full FTTI before a stop is even requested', () => {
  const row = { ...sound, 'Fault Tolerant Time Interval': '250 ms',
    'FTTI Rationale': 'Detection must complete within 250 ms; initiate emergency stop immediately afterwards.' };
  expect(haraTimingResponseOverrun(row)).toBe(true);
  expect(haraTimingResponseOverrun({ ...row, 'FTTI Rationale': 'Detection must complete within 25 ms; communication, actuation and complete braking take 180 ms, inside the 250 ms fault-to-hazard bound.' })).toBe(false);
  expect(haraTimingResponseOverrun({ ...row, 'Fault Tolerant Time Interval': 'clearance distance / closing speed' })).toBe(false);
});

test('requirement comparisons must use the same dimensions', () => {
  expect(invalidRequirementTiming('If the available stopping distance is less than the required lead time, command an emergency stop.')).toBe(true);
  expect(invalidRequirementTiming('If available distance is less than required stopping distance, preserve emergency braking.')).toBe(false);
  expect(invalidRequirementTiming('The complete response time shall be less than the available hazard time.')).toBe(false);
});

test('harm inspection preserves generic source hazards but requires a human injury outcome', () => {
  expect(haraFinalReviewFindings({ ...sound, Loss: 'Operation fails', Hazard: 'Invalid interaction', 'Potential Harm': 'The dependent operation does not achieve its intended outcome.' }).map(issue => issue.code)).toContain('HARM');
  expect(haraFinalReviewFindings({ ...sound, Severity: 'S0', 'Severity Rationale': 'Only property damage; no people exposed.', 'Potential Harm': 'No human injury.' })).toEqual([]);
});

test('checks dimensions and fault-to-hazard semantics, rather than accepting any time-valued response formula', () => {
  for (const input of [
    'FTTI = stopping distance + network latency.',
    'FTTI = distance to obstacle divided by acceleration.',
    'FTTI = (stopping_distance / current_velocity) + network_latency + brake_response_time',
    'FTTI = 30 seconds (session watchdog timeout).',
    'FTTI = Session Health feedback timeout of 500 ms; fault-to-hazard interval follows feedback loss.',
    'FTTI = 200 ms from fault occurrence to initiation of a stop request.',
    'FTTI = 250 ms from input loss to emergency stop initiation; braking follows.',
  ]) expect(invalidHaraTiming(input)).toBe(true);
  expect(invalidHaraTiming('FTTI = clearance distance / closing speed; detection plus the complete braking response must fit inside it.')).toBe(false);
});

test('keeps routine/stale command validation while preventing blanket rejection of required emergency stopping', () => {
  expect(unsafeLateStopRule('Reject any stop request older than 200 ms; do not execute late stop commands.')).toBe(true);
  expect(unsafeLateStopRule('Reject stale non-emergency motion requests; preserve braking while the hazard remains.')).toBe(false);
  expect(unsafeLateStopRule('The vehicle shall never reject late emergency stopping while the hazard remains.')).toBe(false);
});

test('incomplete gear engagement and unknown command state are technical descriptions, not unfinished assessments', () => {
  const original = record(sound);
  for (const text of ['Incomplete gear engagement permits roll-away toward a pedestrian.', 'Unknown command state permits unintended vehicle motion near passengers.']) {
    expect(validateHaraReviewPatch(original, { id: original.id, hash: original.hash, reason: 'Describe the physical hazardous event.', changes: { 'Hazardous Event': text } })).toEqual([]);
  }
  expect(validateHaraReviewPatch(original, { id: original.id, hash: original.hash, reason: 'Withheld decision.', changes: { 'Hazardous Event': 'Incomplete' } }).length).toBeGreaterThan(0);
});

test('issue references must use an actual source quote and a permitted field for their reasoning rule', () => {
  const original = record(sound), finding = { id: original.id, code: 'FTTI', fields: ['FTTI Rationale'], reason: 'Check the timing argument.', evidence: [{ field: 'FTTI Rationale', quote: sound['FTTI Rationale'] }] };
  expect(validateHaraFinding(original, finding)).toBe(true);
  expect(validateHaraFinding(original, { ...finding, fields: ['Controllability'] })).toBe(false);
  expect(validateHaraFinding(original, { ...finding, evidence: [{ field: 'FTTI Rationale', quote: 'Invented measurement.' }] })).toBe(false);
  expect(validateHaraFinding(original, { ...finding, hash: 'stale' })).toBe(false);
  expect(identifiedHaraFinding(original, finding).findingId).toBe(identifiedHaraFinding(original, finding).findingId);
});

test('a failed control correction does not discard a sound emergency-response correction on the same row', () => {
  const row = { ...sound, Controllability: 'C0', 'Functional Safety Requirements': 'The controller shall reject stop requests older than 200 ms.' };
  const original = record(row), result = haraReviewChangeGroups(original, { id: original.id, hash: original.hash, reason: 'Correct control and required stopping.',
    changes: { Controllability: 'C2', 'Controllability Rationale': 'Pedestrians cannot avoid impact within the available time.',
      'Functional Safety Requirements': 'The controller shall preserve emergency braking while the hazard remains present.' } });
  expect(result.groups.map(group => group.group)).toEqual(['response']); expect(result.rejected).toHaveLength(1);
});

test('whole-table inspection covers context, related goals and equivalent exposure groups across detail batches', () => {
  const first = record({ ...sound, 'Safety Goal ID': 'SG-shared', ASIL: 'ASIL B', 'Operational Context ID': 'curb', 'Operational Scenario': 'Occupied curb', 'Operational Situation': 'Approach' });
  const second = { ...record({ ...first.row, Exposure: 'E4', ASIL: 'ASIL D' }), id: 'synthetic-second' };
  const inspection = inspectHaraReviewTable({ Summary: [[], [], []] }, [first, second]);
  const context = haraReviewBatchContext(inspection, [second]);
  expect(context.applicable).toBe(2); expect(context.operationalContexts).toHaveLength(1);
  expect(context.equivalentSituationConflicts[0].exposure).toEqual({ E3: 1, E4: 1 });
  expect(context.relatedGoals[0]).toMatchObject({ id: 'SG-shared', rows: 2, ratings: { 'ASIL B': 1, 'ASIL D': 1 } });
  expect(context.goalCatalog).toHaveLength(1);
});
