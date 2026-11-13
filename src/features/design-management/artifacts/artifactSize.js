// Request budgets belong to generationSourceBatches. These are saved-document
// budgets constrain total content rather than an arbitrary object count. Each
// object also retains its text/title limits. Evidence has a separate allowance.
export const DOCUMENT_CONTENT_LIMIT = 20000000;
export const DOCUMENT_EVIDENCE_LIMIT = 32000000;

// Intern exact nested evidence, including architecture evidence repeated inside
// different upstream objects. This is accounting only: stored snapshots and
// hashes remain unchanged, so legacy checkpoints can resume without migration.
export function evidenceBudget() {
  const unique = new Map(), seen = new WeakMap();
  let characters = 2;
  function reference(value) {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const node = Array.isArray(value)
      ? ['array', value.map(reference)]
      : ['object', Object.entries(value).map(([key, child]) => [key, reference(child)])];
    const serialized = JSON.stringify(node);
    if (!unique.has(serialized)) {
      unique.set(serialized, unique.size);
      characters += serialized.length + 1;
    }
    const result = { reference: unique.get(serialized) };
    seen.set(value, result);
    return result;
  }
  return { reference, size: () => characters };
}
export function artifactDocumentSize(objects, { measureEvidence = true } = {}) {
  const evidence = evidenceBudget();
  const content = objects.map(object => !Array.isArray(object.sourceEvidence) ? object
    : { ...object, sourceEvidence: measureEvidence ? object.sourceEvidence.map(evidence.reference) : object.sourceIds || [] });
  return { content: JSON.stringify(content).length, evidence: evidence.size() };
}
export function sourceManifestSize(manifest) {
  const evidence = evidenceBudget();
  evidence.reference(manifest);
  return evidence.size();
}
export const sizeDescription = size => `${(size / 1000000).toFixed(1)} million characters`;
