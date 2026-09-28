export function createProjectRunGuard(projectId, activeProjectRef, navigationEpochRef) {
  const epoch = navigationEpochRef.current;
  return () => activeProjectRef.current === projectId && navigationEpochRef.current === epoch;
}
