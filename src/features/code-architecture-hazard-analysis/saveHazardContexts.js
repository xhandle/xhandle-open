import { assignImportedHazardContext } from './codeHazardImportContext';
import { saveCodeArchitectureHazardRun } from './codeArchitectureHazardStore';
import { saveCodeArchitectureHazardContexts } from './codeArchitectureHazardContextStore';

// Hazard runs use the source identity (for example owner/repository), while
// context records use the workspace repository entry ID. Compare against the
// same source identity used by the run loader, never the context storage key.
export function assertHazardContextRunScope(run, { projectId, analysisRepoId }) {
  if (run && (run.projectId !== projectId || run.repoId !== analysisRepoId)) {
    throw new Error("The displayed analysis belongs to a different project or repository. Reopen the current project's hazard analysis before saving context.");
  }
}

// The caller adopts this run directly. Suppress the run-change notification so
// its loader cannot re-align the new run against the old saved contexts.
export async function persistHazardContexts({ run, projectId, repoId, contexts }) {
  const updated = assignImportedHazardContext(run, contexts);
  if (updated !== run) await saveCodeArchitectureHazardRun(updated, { notify: false });
  try {
    saveCodeArchitectureHazardContexts({ projectId, repoId, contexts });
  } catch (error) {
    if (updated !== run) {
      try { await saveCodeArchitectureHazardRun(run, { notify: false }); }
      catch (rollbackError) {
        throw new Error(`Context save failed (${error.message}); restoring the previous analysis also failed (${rollbackError.message}). Reload before continuing.`);
      }
    }
    throw error;
  }
  return updated;
}
