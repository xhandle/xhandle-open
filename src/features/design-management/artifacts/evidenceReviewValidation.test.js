import { validateEvidenceReview, validateSection } from './artifactModel';

const section = { id: 'review', title: 'Evidence review' }, allowed = new Set(['source']);
const fact = index => ({ key: `fact-${index}`, title: `Fact ${index}`, kind: 'narrative', text: 'Recorded evidence.', sourceIds: ['source'] });

test('reviews preserve every validated fact while document sections retain their own size bound', () => {
  const response = { objects: Array.from({ length: 121 }, (_, index) => fact(index)) };
  const checked = validateEvidenceReview(response, section, 'artifact', allowed);
  expect(checked).toHaveLength(122);
  expect(checked.filter(object => object.kind === 'section')).toHaveLength(1);
  expect(new Set(checked.map(object => object.id)).size).toBe(122);
  expect(checked.slice(1).every(object => object.parentId === 'artifact:review')).toBe(true);
  expect(() => validateSection(response, section, 'artifact', allowed)).toThrow('too many');
});

test('duplicate keys across review batches and malformed or unsupported facts still fail validation', () => {
  const response = { objects: [...Array.from({ length: 60 }, (_, index) => fact(index)), fact(0)] };
  expect(() => validateEvidenceReview(response, section, 'artifact', allowed)).toThrow('identifiers');
  for (const invalid of [null, { ...fact(0), text: 'x'.repeat(16001) }, { ...fact(0), sourceIds: 'source' }]) {
    expect(() => validateEvidenceReview({ objects: [invalid] }, section, 'artifact', allowed)).toThrow();
  }
  expect(() => validateEvidenceReview({ objects: [{ ...fact(0), sourceIds: ['invented'] }] }, section, 'artifact', allowed)).toThrow('unknown source');
});
