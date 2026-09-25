import { createReviewSessionStore } from "../vibe-review-engine/reviewSessionStore";

const KEY = "xhandle.functionalVibeReview.sessions.v1";
const AUDIT_KEY = "xhandle.functionalVibeReview.audit.v1";
const now = () => new Date().toISOString();
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID?.()) || `fvr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const runtimeId = `functional-review-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const FUNCTIONAL_VIBE_REVIEW_STATES = Object.freeze({
  PROPOSING: "proposing",
  AWAITING: "awaiting_decision",
  APPLYING: "applying",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  PAUSED: "paused",
});

const store = createReviewSessionStore({
  key: KEY, auditKey: AUDIT_KEY, states: FUNCTIONAL_VIBE_REVIEW_STATES, runtimeId,
  // Functional undo rebuilds the row from previousRow and reverses propagated
  // reallocations from affectedRows, so neither may be trimmed. Only the
  // post-decision detail is shed.
  trimmableDecisionFields: ["nextRow", "proposedRow", "columns"],
  // APPLYING is a foreground UI request, not a durable background job. If the
  // component reloads mid-transition, make the existing proposal retryable
  // instead of stranding the review.
  reviveActive: (session) => (session.state === FUNCTIONAL_VIBE_REVIEW_STATES.APPLYING
    ? { ...session, state: FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING }
    : session),
});






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

export function createFunctionalVibeReviewSession({ projectId, threadId, queue = [], rowSnapshot = [], reviewName = "", scopeLabel = "", reviewFields = [], reviewInstructions = "", reviewerName = "", reviewerId = "", ai = {}, workspaceType = "functional-project", repoId = "" }) {
  const stableQueue = Array.from(new Set(queue.map(String).filter(Boolean)));
  return {
    id: uid(), projectId: String(projectId), threadId: String(threadId), queue: stableQueue,
    rowSnapshot: normalizeRowSnapshot(rowSnapshot),
    reviewName: String(reviewName || "").trim(), scopeLabel, cursor: 0, state: FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING, proposal: null,
    reviewerName: String(reviewerName || "").trim(), reviewerId: String(reviewerId || "").trim(),
    reviewFields: Array.from(new Set((reviewFields || []).map(String).filter(Boolean))),
    reviewInstructions: String(reviewInstructions || "").trim(),
    workspaceType, repoId,
    decisions: [], skips: [], failures: [], missingRows: [], ai: { ...ai }, runtimeId, createdAt: now(), updatedAt: now(),
  };
}

export function currentFunctionalVibeReviewRowId(session) {
  return session?.queue?.[session?.cursor] || null;
}

export function transitionFunctionalVibeReviewSession(session, event = {}) {
  if (!session) return session;
  const next = { ...session, updatedAt: now() };
  if (event.type === "proposal") return { ...next, state: FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING, proposal: event.proposal, currentRowSnapshot: event.currentRowSnapshot || session.currentRowSnapshot || null };
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
  if (event.type === "resume") return { ...next, runtimeId, state: session.proposal ? FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING : FUNCTIONAL_VIBE_REVIEW_STATES.PROPOSING };
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

export const readFunctionalVibeReviewStack = store.readStack;
export const saveFunctionalVibeReviewSession = store.saveSession;
export const pushFunctionalVibeReviewSession = store.pushSession;
export const popFunctionalVibeReviewSession = store.popSession;
export const loadFunctionalVibeReviewSession = store.loadSession;
export const findFunctionalVibeReviewSessionById = store.findSessionById;

export const appendFunctionalVibeReviewAudit = store.appendAudit;

export const loadFunctionalVibeReviewAudit = store.loadAudit;

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
