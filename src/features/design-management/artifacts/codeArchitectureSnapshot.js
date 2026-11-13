import { openCbaIndexedDB } from '../../code-architecture-assurance/codeArchitectureStorage';
import { functionalDiagramStorageKey } from '../../../components/functionalDiagramIdentity';

export async function captureCodePresentation(source, repo, rows, storage) {
  const scope = JSON.stringify([source.projectId, repo.sourceType || '', repo.sourceId || repo.repoId || source.repoId, repo.branch || 'main']);
  // FunctionalDecompositionTable currently uses its default repo/branch props
  // for the CSU canvas; Functional has a repository-scoped layout identity.
  const key = source.abstraction === 'functional' ? functionalDiagramStorageKey(scope, rows) : 'diagram:github:repo:main';
  const positionKey = source.abstraction === 'functional' ? `${key}:function-spacing-v3` : key;
  const db = await openCbaIndexedDB();
  let positions = [];
  try {
    if (db.objectStoreNames.contains('diagram_positions')) positions = await new Promise((resolve, reject) => {
      const request = db.transaction('diagram_positions', 'readonly').objectStore('diagram_positions').get(positionKey);
      request.onsuccess = () => resolve(request.result?.value || []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
  const read = (suffix, fallback) => { try { return JSON.parse(storage.getItem(key + suffix) || 'null') || fallback; } catch { return fallback; } };
  return { version: 1, positions, notes: read(':notes:v1', []), comments: read(':comments:v1', []), routing: read(':csu-edge-routing', {}) };
}
