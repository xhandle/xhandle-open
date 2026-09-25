import { createReviewSessionStore } from "../vibe-review-engine/reviewSessionStore";
import { HAZARD_REVIEW_CONTRACT } from "./vibeReviewProposal";

const KEY = "xhandle.hazardVibeReview.sessions.v1";
const AUDIT_KEY = "xhandle.hazardVibeReview.audit.v1";
const now = () => new Date().toISOString();
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID?.()) || `vr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const runtimeId = `hazard-review-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const VIBE_REVIEW_STATES = Object.freeze({
  PROPOSING: "proposing", AWAITING: "awaiting_decision", APPLYING: "applying",
  COMPLETED: "completed", CANCELLED: "cancelled", PAUSED: "paused",
});

const store = createReviewSessionStore({
  key: KEY, auditKey: AUDIT_KEY, states: VIBE_REVIEW_STATES, runtimeId,
  // Undo restores from previousGovernedFields, so the full rows are display
  // detail only and can be shed from older decisions.
  trimmableDecisionFields: ["previousRow", "nextRow", "headers"],
});

export function createVibeReviewSession({ projectId, threadId, queue = [], reviewName = "", scopeLabel = "", reviewTarget = "safetySignificant", reviewerName = "", reviewerId = "", ai = {}, workspaceType = "functional-project", sourceRunId = "", repoId = "" }) {
  const stableQueue = Array.from(new Set(queue.map(String).filter(Boolean)));
  return {
    id: uid(), projectId: String(projectId), threadId: String(threadId), queue: stableQueue,
    reviewName: String(reviewName || "").trim(), scopeLabel,
    reviewTarget: ["guidePhraseApplicable", "safetyClassification", "classificationResolution", "safetySignificant"].includes(reviewTarget) ? reviewTarget : "safetySignificant",
    reviewerName: String(reviewerName || "").trim(), reviewerId: String(reviewerId || "").trim(),
    cursor: 0, state: VIBE_REVIEW_STATES.PROPOSING, proposal: null,
    workspaceType: String(workspaceType || "functional-project"),
    sourceRunId: String(sourceRunId || ""),
    repoId: String(repoId || ""),
    decisions: [], skips: [], failures: [], missingRows: [],
    // Recorded so a stored decision can be traced to the contract that produced it.
    ai: { ...ai, ...HAZARD_REVIEW_CONTRACT },
    runtimeId, createdAt: now(), updatedAt: now(),
  };
}

export function currentVibeReviewRowId(session) { return session?.queue?.[session?.cursor] || null; }

export function transitionVibeReviewSession(session, event = {}) {
  if (!session) return session;
  const next = { ...session, updatedAt: now() };
  if (event.type === "proposal") return { ...next, state: VIBE_REVIEW_STATES.AWAITING, proposal: event.proposal, currentRowSnapshot: event.currentRowSnapshot || session.currentRowSnapshot || null };
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
  if (event.type === "resume") return { ...next, runtimeId, state: session.proposal ? VIBE_REVIEW_STATES.AWAITING : VIBE_REVIEW_STATES.PROPOSING };
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

export const readVibeReviewStack = store.readStack;
export const saveVibeReviewSession = store.saveSession;
export const pushVibeReviewSession = store.pushSession;
export const popVibeReviewSession = store.popSession;
export const loadVibeReviewSession = store.loadSession;
export const findVibeReviewSessionById = store.findSessionById;

export const appendVibeReviewAudit = store.appendAudit;
export const loadVibeReviewAudit = store.loadAudit;

export function summarizeVibeReviewSession(session) {
  const accepted = session.decisions.filter((item) => item.action === "accept").length;
  const decisionValue = (item) => item.newReviewValue || item.newSafetySignificant;
  const yes = session.decisions.filter((item) => decisionValue(item) === "Yes").length;
  const no = session.decisions.filter((item) => decisionValue(item) === "No").length;
  const classificationChanges = Object.fromEntries(["Safety — Direct", "Safety — Related", "Mission/Reliability", "Not Applicable"]
    .map((value) => [value, session.decisions.filter((item) => decisionValue(item) === value).length]));
  return { total: session.queue.length, reviewed: session.decisions.length, accepted,
    overriddenToYes: session.decisions.filter((item) => item.action === "yes").length,
    overriddenToNo: session.decisions.filter((item) => item.action === "no").length,
    skipped: session.skips.length, failed: session.failures.length + session.missingRows.length,
    remaining: Math.max(0, session.queue.length - session.cursor), changedToYes: yes, changedToNo: no, classificationChanges };
}

export function parseVibeReviewAction(value = "") {
  const text = String(value).trim().toLowerCase().replace(/[.!]+$/g, "");
  if (/^(accept|agree|use (?:the )?proposal)(?:\b|$)/.test(text)) return "accept";
  if (/^(yes|mark (?:it )?yes)(?:\b|$)/.test(text)) return "yes";
  if (/^(no|mark (?:it )?no)(?:\b|$)/.test(text)) return "no";
  if (/^(?:mark )?safety\s*[\u2014-]\s*direct(?:\b|$)/.test(text)) return "classificationDirect";
  if (/^(?:mark )?safety\s*[\u2014-]\s*related(?:\b|$)/.test(text)) return "classificationRelated";
  if (/^(?:mark )?mission(?:\/| or )reliability(?:\b|$)/.test(text)) return "classificationMission";
  if (/^(?:mark )?not applicable(?:\b|$)/.test(text)) return "classificationNotApplicable";
  if (/^(skip|later|come back to (?:this|it))(?:\b|$)/.test(text)) return "skip";
  if (/^(stop|finish|end (?:the )?review)(?:\b|$)/.test(text)) return "stop";
  if (/^(?:resume|(?:let'?s\s+)?continue(?:\s+(?:the\s+)?review)?)(?:\b|$)/.test(text)) return "resume";
  if (/^undo(?: last)?(?: decision)?$/.test(text)) return "undo";
  return null;
}
