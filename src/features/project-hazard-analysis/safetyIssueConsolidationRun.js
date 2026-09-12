export function createSafetyIssueConsolidationCoordinator() {
  let activeRun = null;
  let nextRunId = 0;

  return {
    start() {
      if (activeRun && !activeRun.controller.signal.aborted) return null;
      const run = {
        id: ++nextRunId,
        controller: new AbortController(),
      };
      activeRun = run;
      return run;
    },

    cancel(reason = "Safety issue consolidation canceled.") {
      if (!activeRun || activeRun.controller.signal.aborted) return false;
      activeRun.controller.abort(new Error(reason));
      return true;
    },

    isCurrent(runId) {
      return activeRun?.id === runId;
    },

    finish(runId) {
      if (activeRun?.id !== runId) return false;
      activeRun = null;
      return true;
    },

    getActiveRun() {
      return activeRun;
    },
  };
}
