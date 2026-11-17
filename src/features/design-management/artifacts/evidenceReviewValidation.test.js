import { validateEvidenceReview, validateSection } from './artifactModel';
import { DRAFT_ITEM_KINDS, normalizeSectionResponse } from './sectionResponse';

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

test('evidence facts and constraints retain their content and citations under canonical kinds', () => {
  const original = { objects: [
    { ...fact(0), kind: ' Fact ' },
    { ...fact(1), kind: 'CONSTRAINT', text: 'The controller shall reject corrupted audio frames.' },
  ] };
  const checked = validateEvidenceReview(original, section, 'artifact', allowed);
  expect(checked.slice(1).map(object => object.kind)).toEqual(['narrative', 'requirement']);
  original.objects.forEach((object, index) => expect(checked[index + 1]).toMatchObject({ key: object.key, title: object.title, text: object.text, sourceIds: object.sourceIds }));
  expect(original.objects.map(object => object.kind)).toEqual([' Fact ', 'CONSTRAINT']);
  // Semantic aliases belong only to the intermediate evidence review.
  for (const object of original.objects) expect(() => validateSection({ objects: [object] }, section, 'artifact', allowed)).toThrow('unsupported type');
});

test.each(DRAFT_ITEM_KINDS)('canonical %s labels tolerate case and whitespace without changing evidence', kind => {
  const object = { ...fact(0), kind: ` ${kind.toUpperCase()} ` };
  expect(validateSection([object], section, 'artifact', allowed)[1]).toMatchObject({ kind, text: object.text, sourceIds: ['source'] });
});

test('normalizing review labels does not bypass citation, size, identity or evidence checks', () => {
  for (const patch of [{ sourceIds: ['invented'] }, { sourceIds: 'source' }, { text: 'x'.repeat(16001) }, { key: '../bad' }]) {
    expect(() => validateEvidenceReview({ objects: [{ ...fact(0), kind: 'constraint', ...patch }] }, section, 'artifact', allowed)).toThrow();
  }
  expect(validateEvidenceReview({ objects: [{ ...fact(0), kind: 'constraint', sourceIds: [] }] }, section, 'artifact', allowed)[1]).toMatchObject({ kind: 'gap', proposedKind: 'requirement', evidenceIssue: 'missing-citation' });
  for (const kind of ['approved', 'section', 'safety-goal', 'assumption', 'narrative|requirement|decision|gap|interface', null, 5, {}]) {
    const response = { objects: [{ ...fact(0), kind }] };
    expect(normalizeSectionResponse(response, { evidenceReview: true }).objects[0].kind).toEqual(kind);
    try { validateEvidenceReview(response, section, 'artifact', allowed); throw new Error('Validation should fail'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_SECTION_RESPONSE', responseIssue: 'kind' });
      expect(error.retryInstruction).toContain('objects[0].kind was');
      expect(error.retryInstruction).toContain('Never drop items');
    }
  }
});

test('kind correction identifies the original position in reviews containing more than 60 items', () => {
  const objects = Array.from({ length: 61 }, (_, index) => fact(index));
  objects[60].kind = 'unsupported';
  try { validateEvidenceReview({ objects }, section, 'artifact', allowed); throw new Error('Validation should fail'); }
  catch (error) {
    expect(error).toMatchObject({ code: 'INVALID_SECTION_RESPONSE', responseIssue: 'kind' });
    expect(error.retryInstruction).toContain('objects[60].kind was "unsupported"');
  }
});
