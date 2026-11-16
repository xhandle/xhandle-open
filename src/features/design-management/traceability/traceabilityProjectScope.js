import { semanticHash } from '../artifacts/artifactModel';
import { MATRIX_TYPE } from './traceabilityModel';

export async function requireMatrixProject(storage, id) {
  const program = await (storage.objectStore ? storage.objectStore('metadata').get(id) : storage.get('metadata', id));
  if (!program || program.deleted || program.recordType !== 'systems-engineering-project') throw Error('Create traceability matrices from the artifacts of a Design Management project.');
  return program;
}

export function projectArtifactCatalog(program, records) {
  const members = new Set(program.members.map(member => member.id));
  return records.filter(meta => members.has(meta.id) && meta.programId === program.id && !meta.deleted && meta.templateId && meta.templateId !== MATRIX_TYPE);
}

export function validateProjectSources(config, catalog) {
  const allowed = new Set(catalog.map(meta => meta.id));
  const ids = [...(config.lineageSources || []), ...Object.values(config.bindings || {}).flat()];
  if (ids.some(id => !allowed.has(id))) throw Error('Matrix inputs must be artifacts in this Design Management project. Remove unavailable or external inputs in Select sources.');
}

export function projectScopeIdentity(program, catalog) {
  return { id: program.id, recordType: 'matrix-project-scope', membershipHash: semanticHash(catalog.map(meta => meta.id).sort()) };
}
