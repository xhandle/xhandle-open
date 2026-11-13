import { assertRemovedProject, permanentlyDeleteStoredProject } from './permanentlyDeleteStoredProject';
import { listProjectDeletions, readProjectDeletion, writeProjectDeletion, notifyProjectDeletionsChanged, PROJECT_DELETION_PREFIX } from '../lib/projectDeletionRegistry';
import { blockDeletedProjectArtifactWrites } from '../features/code-architecture-assurance/artifactUtils';
import { blockDeletedProjectArchitectureWrites } from '../features/code-architecture-assurance/codeArchitectureStorage';
import { notifyBackupDataChanged } from '../lib/localBackupEvents';

let running = null;
let scheduled;
const scheduleCleanup = () => {
  clearTimeout(scheduled);
  // Let React publish the deletion and paint before starting storage work.
  scheduled = setTimeout(() => { runPendingProjectDeletions().catch(() => {}); }, 0);
};

export function enqueueProjectDeletions(projects) {
  // Validate the whole request before accepting any deletion.
  projects.forEach(project => {
    assertRemovedProject(project);
    if (project.storageOwnershipConflict) throw new Error('This project belongs to another workspace. Deletion was cancelled.');
  });
  const accepted = [];
  let error;
  for (const project of projects) {
    try {
      const previous = readProjectDeletion(project);
      writeProjectDeletion({ id: project.id, workspaceType: project.workspaceType,
        name: project.name || 'Unnamed project', requestedAt: previous?.requestedAt || new Date().toISOString(),
        status: 'queued', attempts: previous?.attempts || 0 });
      blockDeletedProjectArchitectureWrites(String(project.id));
      blockDeletedProjectArtifactWrites(String(project.id));
      accepted.push(project);
    } catch (failure) { error = failure; break; }
  }
  if (accepted.length) {
    notifyProjectDeletionsChanged();
    notifyBackupDataChanged('storage-project-delete');
    scheduleCleanup();
  }
  return { accepted, error };
}

async function drain() {
  // Read afresh each turn: another deletion can arrive during cleanup.
  for (;;) {
    const job = listProjectDeletions().find(record => record.status === 'queued');
    if (!job) return;
    let result;
    try {
      assertRemovedProject(job);
      await permanentlyDeleteStoredProject(job);
      result = { ...job, status: 'complete', attempts: job.attempts + 1, error: undefined };
    } catch (error) {
      result = { ...job, status: 'failed', attempts: job.attempts + 1, error: error.message || String(error) };
    }
    // If persistence fails, keep the old queued job for the next startup.
    writeProjectDeletion(result);
    notifyProjectDeletionsChanged();
    // Yield between projects so clicks/navigation can be handled.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export function runPendingProjectDeletions() {
  if (running) return running;
  const operation = () => drain();
  running = (typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('xhandle-project-deletion-queue', { ifAvailable: true }, lock => lock ? operation() : undefined)
    : operation()).finally(() => { running = null; });
  return running;
}

export function retryProjectDeletionCleanup() {
  for (const job of listProjectDeletions()) {
    if (job.status === 'failed') writeProjectDeletion({ ...job, status: 'queued', error: undefined });
  }
  notifyProjectDeletionsChanged();
  scheduleCleanup();
}

export function startProjectDeletionQueue() {
  const changed = event => {
    if (!event.key || event.key.startsWith(PROJECT_DELETION_PREFIX)) {
      notifyProjectDeletionsChanged();
      scheduleCleanup();
    }
  };
  window.addEventListener('storage', changed);
  // A queued job survives closing the app at any point in cleanup. Failed jobs
  // get one fresh attempt per startup; persistent failures stay actionable.
  try { retryProjectDeletionCleanup(); }
  catch { notifyProjectDeletionsChanged(); }
  return () => window.removeEventListener('storage', changed);
}
