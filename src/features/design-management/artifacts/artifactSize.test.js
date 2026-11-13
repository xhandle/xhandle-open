import { orderedObjects } from './artifactExport';
import { artifactDocumentSize, sourceManifestSize, DOCUMENT_CONTENT_LIMIT, DOCUMENT_EVIDENCE_LIMIT } from './artifactSize';
import { validateArtifactObjects } from './artifactRepository';

const object = { id: 'a:item', title: 'Item', text: 'Draft', parentId: null };
test('nested architecture evidence is counted once across different upstream objects without mutation', () => {
  const shared = { id: 'diagram-element', element: { details: 'Evidence '.repeat(2000) } };
  const sources = Array.from({ length: 100 }, (_, i) => ({ id: `upstream-${i}`, text: `Statement ${i}`, architectureEvidence: [JSON.parse(JSON.stringify(shared))] }));
  const objects = [{ ...object, sourceEvidence: sources }];
  const before = JSON.stringify(objects);
  expect(before.length).toBeGreaterThan(1500000);
  expect(artifactDocumentSize(objects).evidence).toBeLessThan(100000);
  expect(sourceManifestSize({ entries: sources })).toBeLessThan(100000);
  expect(JSON.stringify(objects)).toBe(before);
  sources[0].architectureEvidence[0].element.details = 'Different historical evidence. '.repeat(1000);
  expect(artifactDocumentSize(objects).evidence).toBeGreaterThan(45000);
});

test('content and evidence have separate saved-document limits and readable failure details', () => {
  expect(() => validateArtifactObjects({ id: 'a', title: 'System specification' }, [{ ...object, attributes: { attachment: 'x'.repeat(DOCUMENT_CONTENT_LIMIT) } }])).toThrow('System specification contains 20.0 million characters of document content');
  expect(() => validateArtifactObjects({ id: 'a', title: 'System specification' }, [{ ...object, sourceEvidence: [{ id: 'large', text: 'x'.repeat(DOCUMENT_EVIDENCE_LIMIT) }] }])).toThrow('System specification contains 32.0 million characters of distinct supporting evidence');
});


test('large hierarchies validate and export iteratively while still rejecting cycles', () => {
  const objects = Array.from({ length: 12000 }, (_, index) => ({ ...object, id: `a:${index}`, parentId: index ? `a:${index - 1}` : null }));
  expect(() => validateArtifactObjects({ id: 'a' }, objects)).not.toThrow();
  expect(orderedObjects(objects)).toEqual(objects);
  objects[0].parentId = objects[objects.length - 1].id;
  expect(() => validateArtifactObjects({ id: 'a' }, objects)).toThrow('cycle');
});
