import { recordUserPreprocessing, constrainPreprocessedInput, reconcileUserPreprocessing } from './hazardUserPreprocessing';
const headers = ['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Guide Phrase','Guide Phrase Applicable','Guide Phrase Applicability Rationale','Hazard','Safety Significant','Classification Resolution Status'];
const basis = ['RAW-1','Planner','Plan','Executor','Too late','','','','',''];
const assess = (decision = 'Yes') => { const row = [...basis]; row[5] = decision; row[6] = 'Reviewed timing mechanism'; return row; };
const own = row => recordUserPreprocessing(null, headers, row, [headers[5],headers[6]], basis);

test('no preprocessing leaves input and output untouched, including populated AI assessments', () => {
  const input = { fromFunction:'Planner' }; const generated = assess('No');
  expect(constrainPreprocessedInput(input, undefined, headers, basis)).toBe(input);
  expect(reconcileUserPreprocessing(headers, generated, undefined, basis).row).toBe(generated);
});
test('records only changed user assessment fields, not IDs or existing generated values', () => {
  const row = assess(); row[7] = 'AI hazard';
  const result = recordUserPreprocessing(null, headers, row, [headers[0],headers[5]], basis);
  expect(result.values).toEqual({'Guide Phrase Applicable':'Yes'});
  expect(result.pending).toBe(true);
});
test.each(['', 'Needs Review', 'Unknown', 'TBD'])('placeholder %p releases the assessment for generation', value => {
  const row = assess(value);
  expect(recordUserPreprocessing(own(assess()), headers, row, [headers[5]], basis).values['Guide Phrase Applicable']).toBeUndefined();
});
test('Yes and rationale constrain generation and remain intact when AI disagrees', () => {
  const user = own(assess());
  const input = constrainPreprocessedInput({}, user, headers, basis);
  expect(input.guidePhraseApplicable).toBe('Yes');
  expect(input.controlDetails).toContain('Reviewed timing mechanism');
  const generated = assess('No'); generated[7] = 'Newly completed hazard';
  const result = reconcileUserPreprocessing(headers, generated, user, basis);
  expect(result.row[5]).toBe('Yes'); expect(result.row[7]).toBe('Newly completed hazard');
  expect(result.conflicts.length).toBeGreaterThan(0); expect(result.row[9]).toBe('Needs Review');
});
test('No applies existing Not Applicable policy and preserves rationale and ID', () => {
  const generated = assess('Yes'); generated[7] = 'AI hazard';
  const result = reconcileUserPreprocessing(headers, generated, own(assess('No')), basis);
  expect(result.row[0]).toBe('RAW-1'); expect(result.row[5]).toBe('No');
  expect(result.row[6]).toBe('Reviewed timing mechanism'); expect(result.row[7]).toBe('Not Applicable');
});
test('changed architecture flags review rather than accepting the prior decision', () => {
  const changed = [...basis]; changed[2] = 'New command';
  const result = reconcileUserPreprocessing(headers, assess(), own(assess()), changed);
  expect(result.row[5]).toBe('Needs Review'); expect(result.conflicts[0]).toContain('changed');
});
test('clearing the last substantive field removes ownership', () => {
 const first = recordUserPreprocessing(null, headers, assess(), [headers[5]], basis);
 expect(recordUserPreprocessing(first, headers, basis, [headers[5]], basis)).toBeUndefined();
});

test('preprocessed rows match by identity when AI reorders results; ambiguous output is refused', () => {
  const { matchPreprocessedGeneratedRow } = require('./hazardUserPreprocessing');
  const other = [...basis]; other[0] = 'RAW-2'; other[2] = 'Brake';
  expect(matchPreprocessedGeneratedRow(headers, [other, basis], headers, basis)).toBe(basis);
  const blank = [...basis]; blank[0] = '';
  expect(matchPreprocessedGeneratedRow(headers, [blank, blank], headers, basis)).toBeNull();
});

test('a newer governed review supersedes the corresponding preliminary decision', () => {
  const { respectNewerHazardReviews } = require('./hazardUserPreprocessing');
  const preprocessing = { ...own(assess()), updatedAt: '2026-01-01T00:00:00Z' };
  const review = { reviewedAt:'2026-01-02T00:00:00Z', vibeReview:{reviewTarget:'guidePhraseApplicable'} };
  expect(respectNewerHazardReviews(preprocessing, [review])).toBeUndefined();
  expect(respectNewerHazardReviews({...preprocessing,updatedAt:'2026-01-03T00:00:00Z'},[review]).values['Guide Phrase Applicable']).toBe('Yes');
});

test('imports carry user-specified operational context into the remaining analysis', () => {
  const h = [...headers, 'Operational Context ID', 'Operational Scenario'];
  const b = [...basis, 'context-unspecified', 'Unspecified scenario'];
  const imported = [...assess(), 'yard', 'Passenger pickup'];
  const p = recordUserPreprocessing(null, h, imported, ['Guide Phrase Applicable', 'Operational Context ID', 'Operational Scenario'], b);
  const input = constrainPreprocessedInput({}, p, h, b);
  expect(input.operationalContextId).toBe('yard');
  expect(input.hazardContextId).toBe('yard');
  expect(input.operationalScenario).toBe('Passenger pickup');
});
