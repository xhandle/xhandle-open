import { captureLiveSourcesInline, configOwners } from './artifactSourceCapture';
import { PROJECT_DELETION_PREFIX } from '../../../lib/projectDeletionRegistry';
import { requestArtifactWorker } from './requestArtifactWorker';
export * from './artifactSourceCapture';

// Workers read code repositories directly from IndexedDB. Only the selected
// localStorage inputs cross threads, never the full code repository or workspace.
export function artifactStorageSnapshot(config, storage) {
  const keys = new Set(['xhandle.projects', 'xhandle.codeArchitectureProjects', 'xhandle:req-projects']);
  if (config.sources?.length) keys.add('xhandle:requirements');
  if (config.templateId === 'hazard-tracking-list') {
    if (configOwners(config).some(owner => owner.workspaceType === 'functional')) keys.add('xhandle.projectData');
    if (configOwners(config).some(owner => owner.workspaceType === 'code-architecture')) keys.add('xhandle:code-architecture-hazard-analysis:v1');
  }
  for (const owner of configOwners(config)) keys.add(`${PROJECT_DELETION_PREFIX}${encodeURIComponent(owner.workspaceType)}:${encodeURIComponent(String(owner.id))}`);
  for (const source of config.architectureSources || []) {
    if (source.workspaceType === 'code-architecture') {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if ((key?.startsWith('diagram:github:repo:main:') || key?.startsWith(`functional-v4:[${JSON.stringify(source.projectId)},`)) && /:(notes:v1|comments:v1|csu-edge-routing)$/.test(key)) keys.add(key);
      }
    }
    if (source.workspaceType !== 'functional') continue;
    keys.add('xhandle.projectData');
    const prefix = `diagram:positions:${source.projectId}`;
    for (const suffix of ['', ':groups:v1', ':manual:v1', ':comments:v1', ':deleted-auto-groups:v1', ':ungrouped-auto-nodes:v1', ':edge-aggregation:v1', ':edge-routing:v1', ':auto-categories:v1']) keys.add(prefix + suffix);
  }
  return Object.fromEntries([...keys].map(key => [key, storage.getItem(key)]));
}
const capturedInputs = new WeakMap();
export function checkedCapturedSources(config, sources, storage = localStorage) {
  const saved = capturedInputs.get(sources);
  if (!saved || JSON.stringify(config) !== saved.config || Object.entries(saved.inputs).some(([key, value]) => storage.getItem(key) !== value)) throw new Error('Source inputs changed while the snapshot was being prepared. Retry with the current sources.');
  return sources;
}
export async function captureLiveSources(config, storage = localStorage, options = {}) {
  const inputs = artifactStorageSnapshot(config, storage), configKey = JSON.stringify(config);
  const result = typeof Worker === 'undefined' ? await captureLiveSourcesInline(config, storage, options)
    : await requestArtifactWorker('sources', { config, storage: inputs }, options);
  capturedInputs.set(result, { inputs, config: configKey });
  return checkedCapturedSources(config, result, storage);
}
export async function captureLiveSourceHash(config, { storage = localStorage, ...options } = {}) {
  if (typeof Worker === 'undefined') return (await captureLiveSourcesInline(config, storage, options)).hash;
  const inputs = artifactStorageSnapshot(config, storage);
  const hash = await requestArtifactWorker('source-hash', { config, storage: inputs }, options);
  if (Object.entries(inputs).some(([key, value]) => storage.getItem(key) !== value)) throw new Error('Source inputs changed during the source check. Retry with the current sources.');
  return hash;
}
