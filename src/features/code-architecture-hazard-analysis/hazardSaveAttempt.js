// Session-local ownership: surviving workers must not overwrite a newer attempt.
// Reload ends those workers, so this does not require a persisted schema change.
const owners = new Map();
const revoked = new Set();
const key = run => JSON.stringify([run.projectId || '', run.repoId || '', run.id]);
export const hazardSaveAttemptId = run => run?.pendingAttempt?.id || run?.id;
export function claimHazardSaveAttempt(run) {
  if(revoked.has(JSON.stringify([key(run),hazardSaveAttemptId(run)])))return;
  owners.set(key(run), {attemptId:hazardSaveAttemptId(run), metadata:{id:run.id,projectId:run.projectId,repoId:run.repoId,hazardMethod:run.hazardMethod}});
}
export function isCurrentHazardSaveAttempt(run) {
  const owner = owners.get(key(run));
  const attemptId=hazardSaveAttemptId(run);
  if(revoked.has(JSON.stringify([key(run),attemptId])))return false;
  return owner === undefined || owner.attemptId === attemptId;
}

// Keep tombstones rather than removing claims: absence permits legacy saves.
// A genuinely new attempt has a different ID and may claim this scope again.
export function revokeHazardSaveAttempts(filters = {}) {
  for(const [recordKey,owner] of owners){
    const matches=Object.entries(filters).every(([field,value])=>value==null || value==='' || String(owner.metadata[field] || '')===String(value));
    if(matches)revoked.add(JSON.stringify([recordKey,owner.attemptId]));
  }
}
