const KEY = "xhandle.hazardVibeReview.sessions.v1";
const AUDIT_KEY = "xhandle.hazardVibeReview.audit.v1";
const now = () => new Date().toISOString();
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID?.()) || `vr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const defaultStorage = () => typeof localStorage !== "undefined" ? localStorage : null;

export const VIBE_REVIEW_STATES = Object.freeze({
  IDLE: "idle", DEFINING_SCOPE: "defining_scope", PROPOSING: "proposing",
  AWAITING: "awaiting_decision", APPLYING: "applying", ADVANCING: "advancing",
  COMPLETED: "completed", CANCELLED: "cancelled", PAUSED: "paused",
});

export function createVibeReviewSession({ projectId, threadId, queue = [], scopeLabel = "", ai = {} }) {
  const stableQueue = Array.from(new Set(queue.map(String).filter(Boolean)));
  return {
    id: uid(), projectId: String(projectId), threadId: String(threadId), queue: stableQueue,
    scopeLabel, cursor: 0, state: VIBE_REVIEW_STATES.PROPOSING, proposal: null,
    decisions: [], skips: [], failures: [], missingRows: [], ai: { ...ai }, createdAt: now(), updatedAt: now(),
  };
}

export function currentVibeReviewRowId(session) { return session?.queue?.[session?.cursor] || null; }

export function transitionVibeReviewSession(session, event = {}) {
  if (!session) return session;
  const next = { ...session, updatedAt: now() };
  if (event.type === "proposal") return { ...next, state: VIBE_REVIEW_STATES.AWAITING, proposal: event.proposal };
  if (event.type === "applying") return { ...next, state: VIBE_REVIEW_STATES.APPLYING };
  if (event.type === "decision") {
    const decisions = [...session.decisions, event.record];
    const cursor = session.cursor + 1;
    return { ...next, decisions, cursor, proposal: null, state: cursor >= session.queue.length ? VIBE_REVIEW_STATES.COMPLETED : VIBE_REVIEW_STATES.PROPOSING };
  }
  if (event.type === "skip" || event.type === "missing") {
    const cursor = session.cursor + 1;
    const target = event.type === "skip" ? "skips" : "missingRows";
    return { ...next, [target]: [...session[target], event.record], cursor, proposal: null, state: cursor >= session.queue.length ? VIBE_REVIEW_STATES.COMPLETED : VIBE_REVIEW_STATES.PROPOSING };
  }
  if (event.type === "failure") return { ...next, state: VIBE_REVIEW_STATES.AWAITING, failures: [...session.failures, event.record] };
  if (event.type === "stop") return { ...next, state: VIBE_REVIEW_STATES.CANCELLED, proposal: null };
  if (event.type === "pause") return { ...next, state: VIBE_REVIEW_STATES.PAUSED };
  if (event.type === "resume") return { ...next, state: session.proposal ? VIBE_REVIEW_STATES.AWAITING : VIBE_REVIEW_STATES.PROPOSING };
  if (event.type === "undo") {
    const last = session.decisions[session.decisions.length - 1];
    const rowIndex = last ? session.queue.indexOf(last.sourceRowId) : -1;
    return {
      ...next,
      decisions: session.decisions.slice(0, -1),
      cursor: rowIndex >= 0 ? rowIndex : Math.max(0, session.cursor - 1),
      proposal: null,
      state: VIBE_REVIEW_STATES.PROPOSING,
    };
  }
  return session;
}

function loadMap(storage, storageKey) { try { return JSON.parse(storage?.getItem(storageKey) || "{}") || {}; } catch { return {}; } }
export function saveVibeReviewSession(session, storage = defaultStorage()) {
  const map = loadMap(storage, KEY); map[`${session.projectId}:${session.threadId}`] = session; storage?.setItem(KEY, JSON.stringify(map)); return session;
}
export function loadVibeReviewSession(projectId, threadId, storage = defaultStorage()) {
  return loadMap(storage, KEY)[`${projectId}:${threadId}`] || null;
}
export function appendVibeReviewAudit(record, storage = defaultStorage()) {
  const map = loadMap(storage, AUDIT_KEY); const projectId = String(record.projectId || "");
  map[projectId] = [...(map[projectId] || []), record].slice(-1000); storage?.setItem(AUDIT_KEY, JSON.stringify(map)); return record;
}
export function loadVibeReviewAudit(projectId, storage = defaultStorage()) { return loadMap(storage, AUDIT_KEY)[String(projectId)] || []; }

export function summarizeVibeReviewSession(session) {
  const accepted = session.decisions.filter((item) => item.action === "accept").length;
  const yes = session.decisions.filter((item) => item.newSafetySignificant === "Yes").length;
  const no = session.decisions.filter((item) => item.newSafetySignificant === "No").length;
  return { total: session.queue.length, reviewed: session.decisions.length, accepted,
    overriddenToYes: session.decisions.filter((item) => item.action === "yes").length,
    overriddenToNo: session.decisions.filter((item) => item.action === "no").length,
    skipped: session.skips.length, failed: session.failures.length + session.missingRows.length,
    remaining: Math.max(0, session.queue.length - session.cursor), changedToYes: yes, changedToNo: no };
}

export function parseVibeReviewAction(value = "") {
  const text = String(value).trim().toLowerCase().replace(/[.!]+$/g, "");
  if (/^(accept|agree|use (?:the )?proposal)(?:\b|$)/.test(text)) return "accept";
  if (/^(yes|mark (?:it )?yes)(?:\b|$)/.test(text)) return "yes";
  if (/^(no|mark (?:it )?no)(?:\b|$)/.test(text)) return "no";
  if (/^(skip|later|come back to (?:this|it))(?:\b|$)/.test(text)) return "skip";
  if (/^(stop|finish|end (?:the )?review)(?:\b|$)/.test(text)) return "stop";
  if (/^(resume|continue (?:the )?review)(?:\b|$)/.test(text)) return "resume";
  if (/^undo(?: last)?(?: decision)?$/.test(text)) return "undo";
  return null;
}
