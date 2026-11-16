import { HAZARD_TRACKING_COLUMNS, hazardTrackingProjection, projectHazardTrackingFields } from './hazardTrackingFields';

test('projects only the requested fields, including legacy function and verification aliases', () => {
  const source = { 'Function (From)': 'Controller', 'Control Action': 'Send command', 'Function (To)': 'Actuator', Scenario: 'Urban operation', Mode: 'Driving', Conditions: 'Rain', Guideword: 'Not provided', 'Guide Phrase Applicable': 'Yes', UCA: 'Command omitted', Losses: 'Collision', Hazards: 'Missing command', 'Causal Scenario': 'Dropped exchange', 'Safety Requirements/Constraints': 'Retain safe commands', 'Verification Method': 'Fault injection', 'Safety Classification': 'Safety — Direct', 'Debug payload': { toJSON() { throw new Error('Excluded field was inspected'); } } };
  const projected = projectHazardTrackingFields(source);
  expect(Object.keys(projected)).toEqual(HAZARD_TRACKING_COLUMNS);
  expect(projected.Function).toBe('Controller → Send command → Actuator');
  expect(projected.Verification).toBe('Fault injection');
  expect(projected['Safety Constraint']).toBe('Retain safe commands');
});

test('prefers canonical columns and retains stable source identity outside document attributes', () => {
  const project = hazardTrackingProjection(['Raw Analysis Row ID', 'Function', 'Controller', 'Verification', 'Verification Method', 'Internal reason']);
  expect(project(['R-42', 'Direct function', 'Fallback function', 'Direct verification', 'Fallback verification', 'Excluded'])).toEqual({ attributes: { Function: 'Direct function', Verification: 'Direct verification' }, sourceRowId: 'R-42' });
});
test('retains the source functional trace identity as metadata without adding table columns', () => {
  const projected = hazardTrackingProjection(['Raw Analysis Row ID', 'Trace ID', 'Hazard'])(['HA-7', 'functional-4', 'Unintended motion']);
  expect(projected).toEqual({ attributes: { Hazard: 'Unintended motion' }, sourceRowId: 'HA-7', functionalTraceId: 'functional-4' });
});
