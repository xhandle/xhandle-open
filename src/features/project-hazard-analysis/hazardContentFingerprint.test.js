import { hazardContentFingerprint } from './hazardContentFingerprint';

test('shared and independently restored workbook sheets compare equally', () => {
  const sheet = [['Hazard', 'Safety Goal'], ['Loss of braking', 'Prevent uncontrolled motion.']];
  const shared = { Summary: sheet, HARA: sheet };
  const restored = JSON.parse(JSON.stringify(shared));
  expect(hazardContentFingerprint(shared)).toEqual(hazardContentFingerprint(restored));
  expect(hazardContentFingerprint(shared).characters).toBe(JSON.stringify(shared).length);
  expect(hazardContentFingerprint(shared).signature).toHaveLength(79);
  restored.HARA[1][1] = 'Different safety goal';
  expect(hazardContentFingerprint(shared).signature).not.toBe(hazardContentFingerprint(restored).signature);
});

test('fingerprint respects values, order, unicode, JSON omissions and structural boundaries', () => {
  const hash = value => hazardContentFingerprint(value).signature;
  expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
  expect(hash([1, 2])).not.toBe(hash([2, 1]));
  expect(hash({ note: undefined, a: [undefined, NaN, '\uD800', '🙂'] })).toBe(hash({ a: [null, null, '\uD800', '🙂'] }));
  expect(hash(['ab', 'c'])).not.toBe(hash(['a', 'bc']));
  expect(hash(['@abc'])).not.toBe(hash([['abc']]));
  const cyclic = {}; cyclic.self = cyclic;
  expect(() => hash(cyclic)).toThrow('circular');
});
