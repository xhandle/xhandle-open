// Repository-scoped ownership survives tab unmounts. Different stages in the
// same repository conflict because completing an upstream stage clears children.
const jobs = new Map();
const listeners = new Set();
const IDLE = Object.freeze({ running: false, message: '' });
export const artifactDerivationScope = (projectId, repoId) => JSON.stringify([projectId, repoId]);
export const getArtifactDerivationJob = scope => jobs.get(scope)?.snapshot || IDLE;
export function subscribeArtifactDerivations(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const notify = () => listeners.forEach(listener => listener());
export function runArtifactDerivation(scope, work) {
  const existing = jobs.get(scope);
  if (existing?.snapshot.running) return existing.promise;
  const job = { snapshot: { running: true, message: 'Deriving results...' }, timer: null, pending: null };
  jobs.set(scope, job);
  const publish = message => {
    job.pending = String(message || '').slice(0, 2048);
    if (job.timer) return;
    job.timer = setTimeout(() => {
      job.timer = null;
      job.snapshot = { running: true, message: job.pending };
      notify();
    }, 100);
  };
  // Install ownership before executing work, including synchronous reentry.
  job.promise = Promise.resolve().then(() => work(publish)).finally(() => {
    clearTimeout(job.timer);
    job.snapshot = { running: false, message: job.pending || '' };
    job.promise = null;
    job.pending = null;
    // Retain only small completion messages, never result rows or source arrays.
    for (const [key, value] of jobs) {
      if (jobs.size <= 64) break;
      if (!value.snapshot.running) jobs.delete(key);
    }
    notify();
  });
  notify();
  return job.promise;
}
