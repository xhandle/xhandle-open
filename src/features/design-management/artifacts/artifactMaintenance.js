import { engineeringDependencyStatus } from './engineeringProjectRepository';
import { loadArtifact } from './artifactRepository';
import { listArtifacts, updateFreshness } from './artifactRepository';
import { captureLiveSourceHash } from './artifactSources';

export async function refreshArtifactSources({ signal } = {}) {
  const captured = new Map();
  for (const meta of await listArtifacts()) {
    if (signal?.aborted) return;
    if (meta.templateId === 'traceability-matrix') continue; // Its pinned source and relationship identities are evaluated explicitly.
    let freshness, error = null;
    try { const key = JSON.stringify(meta.config); if (!captured.has(key)) captured.set(key, captureLiveSourceHash(meta.config, { signal })); freshness = await captured.get(key) === (meta.baseSourceHash || meta.sourceHash) ? 'current' : 'stale'; if (freshness === 'current' && meta.programId && meta.revision) { const { revision } = await loadArtifact(meta.id); freshness = await engineeringDependencyStatus(meta, revision.sources); } }
    catch (e) { if (signal?.aborted) return; freshness = 'unavailable'; error = e.message; }
    if (freshness !== meta.freshness || error !== (meta.freshnessError || null)) await updateFreshness(meta.id, meta.sourceHash, freshness, error);
  }
}
export function startArtifactMaintenance() {
  let stopped = false, running = false, timer;
  const controller = new AbortController();
  const run = async () => {
    if (stopped || running || document.visibilityState === 'hidden') return;
    running = true;
    try { await refreshArtifactSources({ signal: controller.signal }); } catch (e) { console.warn('Design artifact source check failed:', e.message); }
    finally { running = false; }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 2000); };
  const events = ['xhandle:requirements-data-changed', 'xhandle:hazard-analysis-write', 'xhandle:code-architecture-hazard-analysis:changed', 'storage', 'xhandle:data-changed', 'focus', 'xhandle:project-deletions-changed'];
  events.forEach(event => window.addEventListener(event, schedule));
  // Artifact checkpoints/freshness writes are outputs, not source edits. Watching
  // them made every saved section rebuild every large architecture repeatedly.
  // Source events handle edits; a slower fallback covers external IndexedDB writes.
  // Generation and acceptance still independently validate their live sources.
  const interval = setInterval(run, 5 * 60 * 1000);
  run();
  return () => { stopped = true; controller.abort(); clearTimeout(timer); clearInterval(interval); events.forEach(event => window.removeEventListener(event, schedule)); };
}
