import { collectSafetyCaseEvidence } from "./safetyCaseEvidenceSources";
import { reconcileSafetyCaseEvidence } from "./safetyCaseEvidenceAutomation";
import { loadSafetyCases, updateSafetyCaseAutomation } from "./safetyCaseStore";

export const EVIDENCE_SYNC_EVENT = "xhandle:safety-case-evidence-sync";

// Mount once at application level, not inside SafetyCaseView. The interval is
// catch-up for legacy writers without events. No work continues after cleanup.
export function startSafetyCaseEvidenceRuntime({ target = window, collect = collectSafetyCaseEvidence, list = loadSafetyCases, update = updateSafetyCaseAutomation, intervalMs = 30000, debounceMs = 300 } = {}) {
  let stopped = false;
  let running = false;
  let pending = false;
  let timer;
  const run = async () => {
    if (stopped) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      const cases = await list();
      const snapshots = new Map();
      for (const safetyCase of cases) {
        if (stopped) break;
        const projectId = safetyCase.sourceProjectId ?? safetyCase.projectId;
        if (!projectId || safetyCase.evidenceAutomation?.paused) continue;
        if (!snapshots.has(String(projectId))) snapshots.set(String(projectId), await collect(projectId));
        if (stopped) break;
        await update(safetyCase.id, (latest) => latest.evidenceAutomation?.paused ? latest.evidenceAutomation
          : reconcileSafetyCaseEvidence(latest, snapshots.get(String(projectId))));
      }
    } catch (error) {
      if (!stopped) target.dispatchEvent(new CustomEvent(EVIDENCE_SYNC_EVENT, { detail: { error: error.message || "Evidence synchronization failed." } }));
    } finally {
      running = false;
      if (pending && !stopped) { pending = false; schedule(); }
    }
  };
  const schedule = (event) => {
    // Traceability emits backup changes after every commit. Ignore our own
    // SafetyCases transactions; author saves are observed by the event below.
    if (event?.type === "xhandle:backup-data-changed" && event.detail?.db === "TraceabilityDB"
      && Array.isArray(event.detail.stores) && event.detail.stores.every((name) => name === "SafetyCases")) return;
    if (event?.type === "storage" && event.key && !["xhandle:requirements", "xhandle:vnv-test-case-documents", "xhandle.projectData"].includes(event.key)) return;
    clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };
  // Reconcile authored node/role/exclusion changes once. Automatic writes retain
  // updatedAt, so they cannot trigger their own follow-up synchronization.
  const authoredRevisions = new Map();
  const caseChanged = (event) => {
    const item = event.detail;
    if (authoredRevisions.get(item?.id) === item?.updatedAt) return;
    authoredRevisions.set(item?.id, item?.updatedAt);
    schedule();
  };
  const events = ["storage", "focus", "xhandle:vnv-documents-updated", "xhandle:backup-data-changed", "xhandle:data-changed"];
  events.forEach((name) => target.addEventListener(name, schedule));
  target.addEventListener("xhandle:safety-case-updated", caseChanged);
  const interval = setInterval(schedule, intervalMs);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(interval);
    events.forEach((name) => target.removeEventListener(name, schedule));
    target.removeEventListener("xhandle:safety-case-updated", caseChanged);
  };
}
