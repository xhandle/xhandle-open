import { currentArchitectureRows } from '../code-architecture-context/codeRelationshipEvidence';
import { buildFunctionalModelRows, functionalModelIsReady } from '../code-architecture-context/functionalModel';

// Shared by the panel and derivation API. Already-projected rows are accepted
// so selecting the source twice never expands a Functional table back to CSU.
export function softwareRequirementSource(rows = []) {
  if (rows.length && rows.every(row => row.functionalModel)) return { type: 'Functional', rows };
  if (functionalModelIsReady(rows)) return { type: 'Functional', rows: buildFunctionalModelRows(rows) };
  return { type: 'CSU', rows: currentArchitectureRows(rows) };
}
