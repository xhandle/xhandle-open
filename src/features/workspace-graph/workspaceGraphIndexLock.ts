// Serialize migration snapshots with permanent cleanup so an in-flight snapshot
// cannot restore a project after its retained row has been deleted.
let graphStorageMutation: Promise<unknown> = Promise.resolve();
export function withWorkspaceGraphMigrationPaused<T>(operation: () => Promise<T>, waitTimeoutMs?: number): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = waitTimeoutMs ? new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("Workspace graph migration is still busy. Wait for analysis to finish and retry cleanup."));
    }, waitTimeoutMs);
  }) : null;
  const run=()=>{
    clearTimeout(timer);
    if(expired)throw new Error("Workspace cleanup wait expired; no delayed cleanup was started.");
    return operation();
  };
  const result = graphStorageMutation.then(() => {
    if(expired)throw new Error("Workspace cleanup wait expired; no delayed cleanup was started.");
    const locks=typeof navigator!=='undefined'?navigator.locks:null;
    return locks ? locks.request('xhandle-workspace-graph-mutation',run) : run();
  });
  graphStorageMutation = result.then(() => undefined, () => undefined);
  return timeout ? Promise.race([result, timeout]) : result;
}
