import { openDB } from "idb";
import { normalizeHazardAnalysisResolutionStatus } from "./classificationResolutionStatus";

const DB_NAME = "xhandle-project-hazard-analysis";
const DB_VERSION = 2;
const STORE_NAME = "analyses";
/**
 * Revisions are the recovery story.
 *
 * The analysis used to be one mutable record, so any successful bad write was
 * terminal -- and it is the only durable copy. Keeping a short history means a
 * defect we have not found yet costs a restore rather than the analysis.
 */
const REVISION_STORE_NAME = "analysisRevisions";
const RETAINED_REVISIONS = 5;
const writeQueues = new Map();

const revisionKey = (projectId, revision) => `${projectId}::${String(revision).padStart(10, "0")}`;

/**
 * Revisions this browsing context produced.
 *
 * Compare-and-set exists to stop ANOTHER tab's newer analysis being replaced.
 * It must not fire for this tab's own background writes -- the debounced
 * autosave, regeneration, and the pre-review checkpoint all advance the
 * revision, and treating those as conflicts makes every review decision fail
 * with "this changed in another tab" in a single-tab session.
 *
 * Same-context writes are already serialized by the per-project queue, so
 * rebasing onto one is safe. A revision absent from this set came from
 * somewhere we cannot see, which is a real conflict.
 */
const locallyWrittenRevisions = new Map();

function rememberLocalRevision(projectId, revision) {
  if (!locallyWrittenRevisions.has(projectId)) locallyWrittenRevisions.set(projectId, new Set());
  const seen = locallyWrittenRevisions.get(projectId);
  seen.add(Number(revision));
  // Only recent revisions matter; a stale writer is detected by absence.
  if (seen.size > 64) seen.delete([...seen][0]);
}

function wasWrittenLocally(projectId, revision) {
  return locallyWrittenRevisions.get(projectId)?.has(Number(revision)) === true;
}

/** Testing seam: forget what this context has written. */
export function resetLocalRevisionTracking() {
  locallyWrittenRevisions.clear();
}

const byteSize = (value) => {
  try { return JSON.stringify(value)?.length ?? 0; } catch { return 0; }
};

function reportHazardWrite(detail) {
  try {
    window.dispatchEvent(new CustomEvent("xhandle:hazard-analysis-write", { detail }));
  } catch {}
  if (!detail.ok) {
    console.error("[project-hazard-storage] Hazard analysis write did not land.", detail);
  }
}

const hasAnalysisSummary = (analysisResult) => (
  Array.isArray(analysisResult?.Summary?.[0]) && analysisResult.Summary.length > 1
);

/**
 * One write chain per project.
 *
 * Reviews save from several places at once -- the decision itself, the debounced
 * autosave, regeneration -- and each read-modify-write carries a snapshot taken
 * when it started. Without serialization an older save can finish last and put
 * its stale snapshot back, silently undoing newer decisions.
 */
function enqueueProjectWrite(projectId, operation) {
  const previous = writeQueues.get(projectId) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(projectId, next);
  return next.finally(() => {
    if (writeQueues.get(projectId) === next) writeQueues.delete(projectId);
  });
}

async function openHazardDatabase() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "projectId" });
      if (!db.objectStoreNames.contains(REVISION_STORE_NAME)) db.createObjectStore(REVISION_STORE_NAME, { keyPath: "key" });
    },
  });
}

/**
 * Discriminated outcomes for every hazard persistence operation.
 *
 * The boolean return that callers still use cannot distinguish "there is no
 * backup" from "storage is temporarily unavailable", which is exactly what a
 * recovery interface has to tell a user.
 */
export const HAZARD_WRITE_OUTCOME = Object.freeze({
  OK: "ok",
  UNCHANGED: "unchanged",
  MISSING: "missing",
  STALE: "stale",
  BLOCKED_CLEAR: "blocked-clear",
  QUOTA: "quota",
  UNAVAILABLE: "unavailable",
  WRITE_ERROR: "write-error",
});

const isQuotaError = (error) => (
  error?.name === "QuotaExceededError"
  || /quota/i.test(String(error?.message || ""))
);

/** Plain-language explanation of why a hazard write did not land. */
export function describeHazardWriteFailure(result = {}) {
  switch (result.outcome) {
    case HAZARD_WRITE_OUTCOME.STALE:
      return "This analysis changed somewhere else (another tab or window) after you loaded it. Nothing was overwritten. Reload the project to pick up the newer version, then redo this decision.";
    case HAZARD_WRITE_OUTCOME.QUOTA:
      return "Browser storage is full, so the change could not be saved and the row was restored. Free up space, then try again.";
    case HAZARD_WRITE_OUTCOME.UNAVAILABLE:
      return "Browser storage is unavailable, so the change could not be saved and the row was restored.";
    case HAZARD_WRITE_OUTCOME.BLOCKED_CLEAR:
      return "That change would have emptied a populated hazard analysis, so it was refused.";
    case HAZARD_WRITE_OUTCOME.MISSING:
      return "The hazard analysis could not be located, so nothing was saved.";
    default:
      return `The change could not be saved (${result.outcome || "unknown error"}) and the row was restored.`;
  }
}

function failureOutcome(error) {
  if (isQuotaError(error)) return HAZARD_WRITE_OUTCOME.QUOTA;
  return HAZARD_WRITE_OUTCOME.WRITE_ERROR;
}

/**
 * Run head and revision work inside ONE readwrite transaction.
 *
 * This is what makes the revision check a real compare-and-set. Splitting the
 * head read, the revision insert, and the head update into separate operations
 * lets two tabs both read revision N, both pass the check, and both write N+1 --
 * the later silently replacing the earlier. IndexedDB serializes readwrite
 * transactions whose store scopes overlap, across connections, so holding all
 * three inside one transaction is what actually prevents that.
 */
async function runHazardTransaction(db, work) {
  const tx = db.transaction([STORE_NAME, REVISION_STORE_NAME], "readwrite");
  const heads = tx.objectStore ? tx.objectStore(STORE_NAME) : tx.store;
  const revisions = tx.objectStore ? tx.objectStore(REVISION_STORE_NAME) : tx.store;
  const result = await work({ heads, revisions });
  await tx.done;
  return result;
}

/** Remaining browser storage, where the platform can tell us. */
export async function estimateHazardStorage() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota) return null;
    return { usage, quota, remaining: quota - usage, ratio: usage / quota };
  } catch {
    return null;
  }
}

/** Older-to-newer revisions still held for a project. */
/**
 * Retained revisions for a project, oldest first, with a discriminated status
 * so a caller can tell "no backup exists" from "storage is unavailable".
 */
export async function listHazardAnalysisRevisions(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return { status: HAZARD_WRITE_OUTCOME.MISSING, revisions: [] };
  try {
    const db = await openHazardDatabase();
    if (!db) return { status: HAZARD_WRITE_OUTCOME.UNAVAILABLE, revisions: [] };
    const all = (await db.getAll(REVISION_STORE_NAME)) || [];
    const revisions = all
      .filter((entry) => entry?.projectId === id)
      .sort((a, b) => (a.revision || 0) - (b.revision || 0))
      .map(({ key, analysisResult, draftHazardRowsByIndex, riskRegister, ...meta }) => ({
        ...meta,
        // Metadata only: a recovery list must not pull every full analysis into
        // memory just to show a table of dates.
        rowCount: Array.isArray(analysisResult?.Summary) ? Math.max(analysisResult.Summary.length - 1, 0) : 0,
      }));
    return { status: HAZARD_WRITE_OUTCOME.OK, revisions };
  } catch (error) {
    console.warn("[project-hazard-storage] Unable to list hazard analysis revisions", error);
    return { status: failureOutcome(error), revisions: [], message: error?.message };
  }
}

/** Full content of one retained revision, for preview before restoring. */
export async function readHazardAnalysisRevision(projectId, revision) {
  const id = String(projectId || "").trim();
  if (!id) return { status: HAZARD_WRITE_OUTCOME.MISSING, revision: null };
  try {
    const db = await openHazardDatabase();
    if (!db) return { status: HAZARD_WRITE_OUTCOME.UNAVAILABLE, revision: null };
    const stored = await db.get(REVISION_STORE_NAME, revisionKey(id, revision));
    if (!stored) return { status: HAZARD_WRITE_OUTCOME.MISSING, revision: null };
    return { status: HAZARD_WRITE_OUTCOME.OK, revision: stored };
  } catch (error) {
    return { status: failureOutcome(error), revision: null, message: error?.message };
  }
}

/**
 * Promote a retained revision back to the head.
 *
 * This is what makes a lost analysis recoverable by a user rather than by a
 * developer with a debugger. The restore is itself a new revision, so restoring
 * never discards the state it replaced.
 */
export async function restoreHazardAnalysisRevision(projectId, revision) {
  const id = String(projectId || "").trim();
  if (!id) return { status: HAZARD_WRITE_OUTCOME.MISSING, record: null };
  return enqueueProjectWrite(id, async () => {
    try {
      const db = await openHazardDatabase();
      if (!db) return { status: HAZARD_WRITE_OUTCOME.UNAVAILABLE, record: null };
      return await runHazardTransaction(db, async ({ heads, revisions }) => {
        const stored = await revisions.get(revisionKey(id, revision));
        if (!stored) return { status: HAZARD_WRITE_OUTCOME.MISSING, record: null };
        const head = (await heads.get(id)) || null;
        const nextRevision = Number(head?.revision || 0) + 1;
        const record = {
          projectId: id,
          analysisResult: stored.analysisResult ?? null,
          draftHazardRowsByIndex: stored.draftHazardRowsByIndex || {},
          riskRegister: Array.isArray(stored.riskRegister) ? stored.riskRegister : [],
          revision: nextRevision,
          contentSignature: stored.contentSignature || "",
          restoredFromRevision: Number(revision),
          updatedAt: new Date().toISOString(),
          lastWriteReason: "revision-restore",
        };
        await revisions.put({ ...record, key: revisionKey(id, nextRevision) });
        await heads.put(record);
        rememberLocalRevision(id, nextRevision);
        reportHazardWrite({ ok: true, outcome: HAZARD_WRITE_OUTCOME.OK, projectId: id, revision: nextRevision, reason: "revision-restore" });
        return { status: HAZARD_WRITE_OUTCOME.OK, record };
      });
    } catch (error) {
      console.error("[project-hazard-storage] Unable to restore hazard analysis revision", error);
      return { status: failureOutcome(error), record: null, message: error?.message };
    }
  });
}

/**
 * Pin the current analysis as a recovery point for a review.
 *
 * Awaited by the caller before the first review action becomes available: an
 * un-awaited checkpoint can be overtaken by the first decision and capture
 * already-mutated state. Pinned so ordinary pruning cannot remove it while the
 * review that depends on it is still running.
 */
export async function checkpointHazardAnalysis(projectId, reason = "checkpoint") {
  const id = String(projectId || "").trim();
  if (!id) return { status: HAZARD_WRITE_OUTCOME.MISSING, revision: null };
  try {
    const db = await openHazardDatabase();
    if (!db) return { status: HAZARD_WRITE_OUTCOME.UNAVAILABLE, revision: null };
    const head = await db.get(STORE_NAME, id);
    if (!hasAnalysisSummary(head?.analysisResult)) {
      return { status: HAZARD_WRITE_OUTCOME.MISSING, revision: null };
    }
    const result = await saveHazardAnalysis(id, {
      analysisResult: head.analysisResult,
      draftHazardRowsByIndex: head.draftHazardRowsByIndex,
      riskRegister: head.riskRegister,
      pinned: true,
    }, { reason });
    return { status: result.outcome, revision: result.revision ?? null };
  } catch (error) {
    console.warn("[project-hazard-storage] Unable to checkpoint hazard analysis", error);
    return { status: failureOutcome(error), revision: null, message: error?.message };
  }
}

/** Release a pinned checkpoint once its review is finished or stopped. */
export async function releaseHazardCheckpoint(projectId, revision) {
  const id = String(projectId || "").trim();
  if (!id || revision === null || revision === undefined) return false;
  return enqueueProjectWrite(id, async () => {
    try {
      const db = await openHazardDatabase();
      if (!db) return false;
      return await runHazardTransaction(db, async ({ revisions }) => {
        const key = revisionKey(id, revision);
        const stored = await revisions.get(key);
        if (!stored) return false;
        await revisions.put({ ...stored, pinned: false });
        return true;
      });
    } catch (error) {
      console.warn("[project-hazard-storage] Unable to release hazard checkpoint", error);
      return false;
    }
  });
}

export async function loadProjectHazardAnalysisRecord(projectId) {
  const result = await loadProjectHazardAnalysisRecordState(projectId);
  return result.record;
}

export async function loadProjectHazardAnalysisRecordState(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return { status: "invalid", record: null, error: null };
  try {
    const db = await openHazardDatabase();
    if (!db) return { status: "unavailable", record: null, error: new Error("Hazard-analysis database is unavailable.") };
    const record = (await db.get(STORE_NAME, id)) || null;
    if (!record) return { status: "missing", record: null, error: null };
    return { status: "loaded", error: null, record: {
      ...record,
      analysisResult: normalizeHazardAnalysisResolutionStatus(record.analysisResult),
    } };
  } catch (error) {
    console.warn("[project-hazard-storage] Unable to load hazard analysis artifact", error);
    return { status: "error", record: null, error };
  }
}

/**
 * Persist a project's hazard analysis.
 *
 * Two protections make this the safe boundary for the only durable copy of the
 * analysis:
 *
 * 1. A field the caller omits keeps its stored value. A partial save (updating
 *    only the risk register, say) can never blank the analysis it did not set.
 * 2. A populated analysis is never replaced by an empty or absent one unless
 *    the caller explicitly asks to clear it. Every destructive path looks the
 *    same from here: a caller holding stale or half-initialised state writes an
 *    empty analysis over good data, and it is gone for good.
 *
 * @param {object} [options]
 * @param {boolean} [options.allowAnalysisClear] permit replacing a populated analysis with an empty one
 * @param {string} [options.reason] recorded on the artifact for forensics
 */
/**
 * Persist a project's hazard analysis, returning a discriminated outcome.
 *
 * Protections, all of which exist because each has already cost real data:
 *  - a field the caller omits keeps its stored value, so a partial save cannot
 *    blank an analysis it never set;
 *  - a populated analysis is never replaced by an empty one without an explicit
 *    clear;
 *  - a writer holding a stale revision is rejected rather than overwriting a
 *    newer one;
 *  - byte-identical content creates no new revision, because the history is
 *    stored in the same origin quota it is meant to protect.
 */
export async function saveHazardAnalysis(projectId, data = {}, {
  allowAnalysisClear = false,
  reason = "",
  expectedRevision = null,
} = {}) {
  const id = String(projectId || "").trim();
  if (!id) return { outcome: HAZARD_WRITE_OUTCOME.MISSING, projectId: id };
  const supplied = (field) => Object.prototype.hasOwnProperty.call(data, field);

  return enqueueProjectWrite(id, async () => {
    let db;
    try {
      db = await openHazardDatabase();
    } catch (error) {
      const result = { outcome: HAZARD_WRITE_OUTCOME.UNAVAILABLE, projectId: id, reason, message: error?.message };
      reportHazardWrite({ ok: false, ...result });
      return result;
    }
    if (!db) {
      const result = { outcome: HAZARD_WRITE_OUTCOME.UNAVAILABLE, projectId: id, reason };
      reportHazardWrite({ ok: false, ...result });
      return result;
    }

    try {
      return await runHazardTransaction(db, async ({ heads, revisions }) => {
        const existing = (await heads.get(id)) || null;

        const actualRevision = Number(existing?.revision || 0);
        if (expectedRevision !== null && actualRevision !== Number(expectedRevision)
          && !wasWrittenLocally(id, actualRevision)) {
          const result = {
            outcome: HAZARD_WRITE_OUTCOME.STALE, projectId: id, reason,
            expectedRevision: Number(expectedRevision),
            actualRevision,
          };
          reportHazardWrite({ ok: false, ...result });
          return result;
        }

        const nextAnalysisResult = supplied("analysisResult")
          ? normalizeHazardAnalysisResolutionStatus(data.analysisResult ?? null)
          : (existing?.analysisResult ?? null);

        if (!allowAnalysisClear && !hasAnalysisSummary(nextAnalysisResult) && hasAnalysisSummary(existing?.analysisResult)) {
          const result = {
            outcome: HAZARD_WRITE_OUTCOME.BLOCKED_CLEAR, projectId: id, reason,
            existingRows: existing.analysisResult.Summary.length - 1,
          };
          reportHazardWrite({ ok: false, ...result });
          try {
            window.dispatchEvent(new CustomEvent("xhandle:hazard-analysis-clear-blocked", { detail: { projectId: id, reason } }));
          } catch {}
          return result;
        }

        const nextDraftRows = supplied("draftHazardRowsByIndex")
          ? (data.draftHazardRowsByIndex || {})
          : (existing?.draftHazardRowsByIndex || {});
        const nextRiskRegister = supplied("riskRegister")
          ? (Array.isArray(data.riskRegister) ? data.riskRegister : [])
          : (Array.isArray(existing?.riskRegister) ? existing.riskRegister : []);

        const contentSignature = byteSignature({
          analysisResult: nextAnalysisResult,
          draftHazardRowsByIndex: nextDraftRows,
          riskRegister: nextRiskRegister,
        });

        // Identical content still refreshes the head's metadata, but must not
        // add another full copy to the history.
        const unchanged = existing?.contentSignature === contentSignature;
        const revision = unchanged ? Number(existing.revision || 0) : Number(existing?.revision || 0) + 1;

        const record = {
          projectId: id,
          analysisResult: nextAnalysisResult,
          draftHazardRowsByIndex: nextDraftRows,
          riskRegister: nextRiskRegister,
          revision,
          contentSignature,
          updatedAt: new Date().toISOString(),
          ...(reason ? { lastWriteReason: reason } : {}),
        };

        // Revision first, head second: an interrupted write then leaves the
        // previous head intact AND the new revision reachable -- never a gap.
        if (!unchanged && hasAnalysisSummary(nextAnalysisResult)) {
          await revisions.put({ ...record, key: revisionKey(id, revision), pinned: Boolean(data.pinned) });
        } else if (data.pinned && hasAnalysisSummary(nextAnalysisResult)) {
          // Deduplication must not silently cancel a checkpoint. When the content
          // is already stored, pin the revision that holds it -- otherwise the
          // review believes it has a recovery point that does not exist.
          const existingRevision = await revisions.get(revisionKey(id, revision));
          if (existingRevision) {
            await revisions.put({ ...existingRevision, pinned: true });
          } else {
            await revisions.put({ ...record, key: revisionKey(id, revision), pinned: true });
          }
        }
        await heads.put(record);
        rememberLocalRevision(id, revision);
        if (!unchanged) await prunePinnedAwareRevisions(revisions, id, revision);

        const result = {
          outcome: unchanged ? HAZARD_WRITE_OUTCOME.UNCHANGED : HAZARD_WRITE_OUTCOME.OK,
          projectId: id, revision, reason, bytes: contentSignature.length,
        };
        reportHazardWrite({ ok: true, ...result });
        return result;
      });
    } catch (error) {
      const result = { outcome: failureOutcome(error), projectId: id, reason, message: error?.message };
      reportHazardWrite({ ok: false, ...result });
      console.error("[project-hazard-storage] Unable to persist hazard analysis artifact", error);
      return result;
    }
  });
}

function byteSignature(value) {
  try { return JSON.stringify(value) ?? ""; } catch { return String(Math.random()); }
}

/**
 * Compatibility wrapper.
 *
 * Sixteen call sites test this with `if (!persisted)`. Returning the outcome
 * object instead would be truthy in every case and silently disable all of
 * them, so the boolean contract is kept and new code uses saveHazardAnalysis.
 */
export async function saveProjectHazardAnalysisRecord(projectId, data = {}, options = {}) {
  const result = await saveHazardAnalysis(projectId, data, options);
  return result.outcome === HAZARD_WRITE_OUTCOME.OK || result.outcome === HAZARD_WRITE_OUTCOME.UNCHANGED;
}

/** Prune ordinary revisions while preserving pinned checkpoints. */
async function prunePinnedAwareRevisions(revisions, projectId, currentRevision) {
  try {
    const keys = (await revisions.getAllKeys()) || [];
    const prefix = `${projectId}::`;
    const mine = keys.filter((key) => String(key).startsWith(prefix)).sort();
    const keepKey = revisionKey(projectId, currentRevision);
    const prunable = [];
    for (const key of mine) {
      if (key === keepKey) continue;
      const entry = await revisions.get(key);
      // A pinned checkpoint belongs to a review in progress; dropping it would
      // remove the recovery point the review promised the user.
      if (!entry?.pinned) prunable.push(key);
    }
    const excess = (mine.length - RETAINED_REVISIONS);
    for (let index = 0; index < Math.min(excess, prunable.length); index += 1) {
      await revisions.delete(prunable[index]);
    }
  } catch (error) {
    console.warn("[project-hazard-storage] Unable to prune hazard analysis revisions", error);
  }
}

export async function deleteProjectHazardAnalysisRecord(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return false;
  return enqueueProjectWrite(id, async () => {
    try {
      const db = await openHazardDatabase();
      if (!db) return false;
      // Delete the head AND every revision in one transaction. Leaving history
      // behind contradicts the delete confirmation and holds quota forever.
      await runHazardTransaction(db, async ({ heads, revisions }) => {
        await heads.delete(id);
        const keys = (await revisions.getAllKeys()) || [];
        const prefix = `${id}::`;
        for (const key of keys.filter((entry) => String(entry).startsWith(prefix))) {
          await revisions.delete(key);
        }
      });
      return true;
    } catch (error) {
      console.warn("[project-hazard-storage] Unable to delete hazard analysis artifact", error);
      return false;
    }
  });
}

export const PROJECT_HAZARD_ANALYSIS_DB_CONFIG = { name: DB_NAME, version: DB_VERSION, storeName: STORE_NAME, revisionStoreName: REVISION_STORE_NAME };
