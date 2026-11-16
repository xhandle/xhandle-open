import { assessMatrix, assessConfiguration, traceLegacyObjects, traceModels } from './traceabilityRepository';
import { readArtifactStorage } from '../artifacts/artifactRepository';
import { requestArtifactWorker } from '../artifacts/requestArtifactWorker';

export async function requestTraceAssessment(id, { signal, onProgress, config } = {}) {
  if (typeof Worker === 'undefined') return config ? assessConfiguration(config, { signal, onProgress }) : assessMatrix(id, { signal, onProgress });
  const scope = config || (await readArtifactStorage(db => db.get('metadata', id)))?.config;
  if (!scope) throw Error('This traceability scope is unavailable.');
  const bindings = Object.values(scope.bindings || {}).flat(), modules = new Set(bindings.filter(id => id.startsWith('module:'))), modelIds = new Set(bindings.filter(id => id.startsWith('sysml:')).map(id => id.slice(6)));
  const legacy = modules.size ? traceLegacyObjects().filter(row => modules.has(`module:${JSON.stringify([row.folderId || row.projectId, row.moduleId])}`)) : [];
  return requestArtifactWorker(config ? 'trace-config' : 'trace-matrix', { id, config, legacy, models: traceModels(modelIds) }, { signal, onProgress });
}
