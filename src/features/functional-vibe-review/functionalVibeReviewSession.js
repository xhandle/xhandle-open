const KEY = "xhandle.functionalVibeReview.sessions.v1";
const AUDIT_KEY = "xhandle.functionalVibeReview.audit.v1";
const now = () => new Date().toISOString();
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID?.()) || `fvr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const defaultStorage = () => typeof localStorage !== "undefined" ? localStorage : null;
const volatileMapsByStorage = new WeakMap();
const nullStorageMaps = {};

function volatileMaps(storage) {
  if (!storage || (typeof storage !== "object" && typeof storage !== "function")) return nullStorageMaps;
  if (!volatileMapsByStorage.has(storage)) volatileMapsByStorage.set(storage, {});
  return volatileMapsByStorage.get(storage);
}

function browserSessionStorage(storage) {
  try {
    return typeof localStorage !== "undefined" && storage === localStorage && typeof sessionStorage !== "undefined"
      ? sessionStorage
      : null;
  } catch {
    return null;
  }
}

export const FUNCTIONAL_VIBE_REVIEW_STATES = Object.freeze({
  PROPOSING: "proposing",
  AWAITING: "awaiting_decision",
  APPLYING: "applying",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  PAUSED: "paused",
});

function parseMap(storage, storageKey) {
  try { return JSON.parse(storage?.getItem(storageKey) || "{}") || {}; } catch { return {}; }
}

function loadMap(storage, storageKey) {
  const persistent = parseMap(storage, storageKey);
  const tabFallback = parseMap(browserSessionStorage(storage), storageKey);
  return { ...persistent, ...tabFallback, ...(volatileMaps(storage)[storageKey] || {}) };
}

function persistMap(storage, storageKey, map) {
  volatileMaps(storage)[storageKey] = map;
  try {
    storage?.setItem(storageKey, JSON.stringify(map));
    try { browserSessionStorage(storage)?.removeItem(storageKey); } catch {}
    return "persistent";
  } catch {
    try {
      browserSessionStorage(storage)?.setItem(storageKey, JSON.stringify(map));
      return "session";
    } catch {
      // The volatile copy keeps the active review usable when browser storage is
      // full or unavailable. Applied row decisions persist in the project store.
      return "memory";
    }
  }
}

function normalizeRowSnapshot(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((entry, index) => {
    const row = entry?.row && typeof entry.row === "object" ? entry.row : entry;
    const rowId = String(entry?.rowId || row?._functionalVibeReviewId || "").trim();
    if (!rowId || !row || typeof row !== "object") return null;
    return {
      rowId,
      rowIndex: Number.isInteger(entry?.rowIndex) ? entry.rowIndex : index,
      row: { ...row, _functionalVibeReviewId: rowId },
    };
  }).filter(Boolean);
}

export function createFunctionalVibeReviewSession({ projectId, threadId, queue = [], rowSnapshot = [], scopeLabel = "", reviewFields = [], reviewInstructions = "", ai = {}, workspaceType = "functional-project", repoId = "" }) {
  const stableQueue = Array.from(new Set(queue.map(String).filter(Boolean)));
  return {
    id: uid(), projectId: String(projectId), threadId: String(threadId), queue: stableQueue,
    rowSnapshot: normalizeRowSnapshot(rowSnapshot),
    scopeLabel, cursor: 0, state: FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING, proposal: null,
    reviewFields: Array.from(new Set((reviewFields || []).map(String).filter(Boolean))),
    reviewInstructions: String(reviewInstructions || "").trim(),
    workspaceType, repoId,
    decisions: [], skips: [], failures: [], missingRows: [], ai: { ...ai }, createdAt: now(), updatedAt: now(),
  };
}

export function currentFunctionalVibeReviewRowId(session) {
  return session?.queue?.[session?.cursor] || null;
}

export function transitionFunctionalVibeReviewSession(session, event = {}) {
  if (!session) return session;
  const next = { ...session, updatedAt: now() };
  if (event.type === "proposal") return { ...next, state: FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING, proposal: event.proposal };
  if (event.type === "applying") return { ...next, state: FUNCTIONAL_VIBE_REVIEW_STATES.APPLYING };
  if (event.type === "decision") {
    const cursor = session.cursor + 1;
    return { ...next, decisions: [...session.decisions, event.record], cursor, proposal: null,
      rowSnapshot: event.rowSnapshot ? normalizeRowSnapshot(event.rowSnapshot) : session.rowSnapshot,
      state: cursor >= session.queue.length ? FUNCTIONAL_VIBE_REVIEW_STATES.COMPLETED : FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING };
  }
  if (event.type === "skip" || event.type === "missing") {
    const target = event.type === "skip" ? "skips" : "missingRows";
    const cursor = session.cursor + 1;
    return { ...next, [target]: [...session[target], event.record], cursor, proposal: null,
      state: cursor >= session.queue.length ? FUNCTIONAL_VIBE_REVIEW_STATES.COMPLETED : FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING };
  }
  if (event.type === "failure") return { ...next, state: FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING, failures: [...session.failures, event.record] };
  if (event.type === "stop") return { ...next, state: FUNCTIONAL_VIBE_REVIEW_STATES.CANCELLED, proposal: null };
  if (event.type === "pause") return { ...next, state: FUNCTIONAL_VIBE_REVIEW_STATES.PAUSED };
  if (event.type === "resume") return { ...next, state: session.proposal ? FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING : FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING };
  if (event.type === "undo") {
    const last = session.decisions[session.decisions.length - 1];
    const rowIndex = last ? session.queue.indexOf(last.rowId) : -1;
    return { ...next, decisions: session.decisions.slice(0, -1), cursor: rowIndex >= 0 ? rowIndex : Math.max(0, session.cursor - 1),
      rowSnapshot: event.rowSnapshot ? normalizeRowSnapshot(event.rowSnapshot) : session.rowSnapshot,
      proposal: null, state: FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING };
  }
  return session;
}

/**
 * Rebuild the last known decomposition if the project view is transiently
 * rehydrated without its rows. New sessions carry a complete snapshot. For
 * sessions created before that safeguard existed, callers may provide rows
 * parsed from the earlier Collaborator proposal; recorded decisions are then
 * replayed by stable row ID.
 */
export function recoverFunctionalVibeReviewRows(session, fallbackRows = []) {
  if (!session?.queue?.length) return [];
  let snapshot = normalizeRowSnapshot(session.rowSnapshot);
  if (!snapshot.length && Array.isArray(fallbackRows) && fallbackRows.length === session.queue.length) {
    snapshot = fallbackRows.map((row, index) => ({
      rowId: session.queue[index],
      rowIndex: index,
      row: { ...row, _functionalVibeReviewId: session.queue[index] },
    }));
  }
  if (!snapshot.length) return [];

  let rows = snapshot
    .slice()
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map((entry) => ({ ...entry.row, _functionalVibeReviewId: entry.rowId }));
  (session.decisions || []).forEach((decision) => {
    if (decision?.decision === "Remove") {
      rows = rows.filter((row) => String(row?._functionalVibeReviewId || "") !== String(decision.rowId || ""));
      return;
    }
    const updates = Array.isArray(decision?.affectedRows) && decision.affectedRows.length
      ? decision.affectedRows
      : [{ rowId: decision?.rowId, nextRow: decision?.nextRow || decision?.proposedRow }];
    const byId = new Map(updates
      .filter((entry) => entry?.rowId && entry?.nextRow)
      .map((entry) => [String(entry.rowId), entry.nextRow]));
    rows = rows.map((row) => {
      const rowId = String(row?._functionalVibeReviewId || "");
      const updated = byId.get(rowId);
      return updated ? { ...updated, _functionalVibeReviewId: rowId } : row;
    });
  });
  return rows;
}

export function saveFunctionalVibeReviewSession(session, storage = defaultStorage()) {
  const map = loadMap(storage, KEY);
  map[`${session.projectId}:${session.threadId}`] = session;
  const retained = Object.fromEntries(Object.entries(map)
    .sort(([, a], [, b]) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
    .slice(0, 16));
  persistMap(storage, KEY, retained);
  return session;
}

export function loadFunctionalVibeReviewSession(projectId, threadId, storage = defaultStorage()) {
  const session = loadMap(storage, KEY)[`${projectId}:${threadId}`] || null;
  // APPLYING represents a foreground UI request, not a durable background job.
  // If the component reloads or the request fails mid-transition, make the
  // existing proposal retryable instead of stranding the review indefinitely.
  return session?.state === FUNCTIONAL_VIBE_REVIEW_STATES.APPLYING
    ? { ...session, state: FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING }
    : session;
}

export function appendFunctionalVibeReviewAudit(record, storage = defaultStorage()) {
  const map = loadMap(storage, AUDIT_KEY);
  const projectId = String(record.projectId || "");
  map[projectId] = [...(map[projectId] || []), record].slice(-250);
  persistMap(storage, AUDIT_KEY, map);
  return record;
}

export function loadFunctionalVibeReviewAudit(projectId, storage = defaultStorage()) {
  return loadMap(storage, AUDIT_KEY)[String(projectId)] || [];
}

export function summarizeFunctionalVibeReviewSession(session) {
  const decisions = session?.decisions || [];
  return {
    total: session?.queue?.length || 0,
    reviewed: decisions.length,
    kept: decisions.filter((item) => item.decision === "Keep").length,
    revised: decisions.filter((item) => item.decision === "Revise").length,
    removed: decisions.filter((item) => item.decision === "Remove").length,
    skipped: session?.skips?.length || 0,
    failed: (session?.failures?.length || 0) + (session?.missingRows?.length || 0),
    remaining: Math.max(0, (session?.queue?.length || 0) - (session?.cursor || 0)),
  };
}

export function parseFunctionalVibeReviewAction(value = "") {
  const text = String(value).trim().toLowerCase().replace(/[.!]+$/g, "");
  if (/^(accept|agree|use (?:the )?proposal)(?:\b|$)/.test(text)) return "accept";
  if (/^(keep|keep as is|keep (?:it|row)(?: as is)?|sound|mark (?:it )?sound)(?:\b|$)/.test(text)) return "keep";
  if (/^(revise|apply (?:the )?revision|update (?:it|row))(?:\b|$)/.test(text)) return "revise";
  if (/^(remove|delete (?:it|row)|drop (?:it|row))(?:\b|$)/.test(text)) return "remove";
  if (/^(skip|later|come back to (?:this|it))(?:\b|$)/.test(text)) return "skip";
  if (/^(stop|finish|end (?:the )?review)(?:\b|$)/.test(text)) return "stop";
  if (/^(resume|continue (?:the )?review)(?:\b|$)/.test(text)) return "resume";
  if (/^undo(?: last)?(?: decision)?$/.test(text)) return "undo";
  return null;
}
