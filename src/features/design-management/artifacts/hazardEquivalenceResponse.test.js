import { parseHazardEquivalenceResponse } from './hazardEquivalenceResponse';

test.each([
  '{"groups":[["H1","H2"]]}',
  '```json\n{"groups":[["H1","H2"]]}\n```',
  'The equivalent hazards are:\n```json\n{"groups":[["H1","H2"]]}\n```\nAll other hazards remain separate.',
  '[["H1","H2"]]',
  [{ type: 'text', text: '{"groups":[["H1","H2"]]}' }],
  { groups: [['H1', 'H2']] },
])('reads a complete provider result without changing membership (%j)', content => {
  expect(parseHazardEquivalenceResponse(content)).toEqual({ groups: [['H1', 'H2']] });
});

test.each([
  '{"groups":[["H1","H2"]]',
  'Result: {"groups":[["H1","H2"]]',
  '{"groups":[]}\n{"groups":[["H1","H2"]]}',
  '{"groups":[]}\nPartial retry: {"groups":[',
  "{'groups': [['H1', 'H2']]}",
  '{"groups":[["H1","H2"],]}',
  'No equivalent hazards were found.',
  '',
])('never guesses or repairs membership from malformed or ambiguous results (%j)', content => {
  expect(() => parseHazardEquivalenceResponse(content)).toThrow(expect.objectContaining({ code: 'HAZARD_RESPONSE_FORMAT' }));
});

test('escaped quotes and brackets inside JSON strings cannot confuse result boundaries', () => {
  const value = { groups: [['H1', 'H2']], note: 'A literal brace } and an escaped quote " remain text.' };
  expect(parseHazardEquivalenceResponse(`Result:\n${JSON.stringify(value)}\nEnd.`)).toEqual(value);
});
