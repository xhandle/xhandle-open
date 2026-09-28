// Content timestamps are independent of unrelated project metadata writes.
let lastVersion = 0;
export function nextDecompositionVersion(previous = 0) {
  lastVersion = Math.max(Date.now(), lastVersion + 1, Number(previous || 0) + 1);
  return lastVersion;
}
export function chooseDecompositionRecovery(primary, recovered) {
  if (!Array.isArray(recovered?.responseRows) || recovered.accepted === false) return null;
  const primaryVersion = Number(primary?.decompositionVersion || 0);
  const recoveryVersion = Number(recovered.decompositionVersion || Date.parse(recovered.updatedAt) || 0);
  if (primaryVersion) return recoveryVersion > primaryVersion ? recovered : null;
  // Existing legacy content (including an intentional empty table) wins when
  // there is no comparable content version. Keep the checkpoint for review.
  return primary ? null : recovered;
}
