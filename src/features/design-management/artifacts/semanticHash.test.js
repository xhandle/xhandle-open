import { createHash } from 'crypto';
import { semanticHash, stableJSON } from './artifactModel';

jest.mock('hash.js', () => {
  const actual = jest.requireActual('hash.js');
  return { ...actual, sha256: () => {
    const hash = actual.sha256(), update = hash.update;
    hash.update = function (input, encoding) {
      // Model the browser failure for a monolithic hashing allocation.
      if (typeof input === 'string' && input.length > 65536) throw new RangeError('Invalid array length');
      return update.call(this, input, encoding);
    };
    return hash;
  } };
});

test.each([
  { b: [1, null, true, undefined, ...Array(1), 'Text'], a: { z: 'é', a: '😀', skip: undefined } },
  null, undefined, {}, [], Array(3), new Date('2026-11-10T12:00:00Z'),
  ...[16380, 16381, 16382, 16383, 16384, 32766].map(size => ({ text: 'x'.repeat(size) + '😀\ud800é漢字', next: '💡' })),
])('streamed hashes preserve canonical JSON identities and Unicode boundaries (%#)', value => {
  const legacy = jest.requireActual('hash.js').sha256().update(stableJSON(value)).digest('hex');
  expect(semanticHash(value)).toBe(legacy);
});

test('hashes a large evidence snapshot without a whole-snapshot byte array', () => {
  const value = { nodes: Array.from({length:1000}, (_,index) => ({ id:index, text:'Evidence 😀 '.repeat(400) })) };
  const canonical = stableJSON(value);
  expect(canonical.length).toBeGreaterThan(4000000);
  expect(semanticHash(value)).toBe(createHash('sha256').update(canonical).digest('hex'));
});
