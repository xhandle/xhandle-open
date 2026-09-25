/**
 * The functional-decomposition adapter over the shared review commit core.
 *
 * Functional rows are objects rather than spreadsheet arrays, decisions are
 * Keep / Revise / Remove rather than governed column values, and a single
 * accepted revision can atomically rewrite sibling rows (a subsystem
 * reallocation). Everything else -- guard, write, verify, record, advance once
 * -- is the same sequence the hazard review uses, and comes from the core.
 */

import { rowFingerprint } from "../project-hazard-analysis/governedDecisionCommit";
import {
  FUNCTIONAL_VIBE_REVIEW_STATES,
  currentFunctionalVibeReviewRowId,
  transitionFunctionalVibeReviewSession,
} from "../functional-vibe-review/functionalVibeReviewSession";
import {
  DECISION_OUTCOME,
  UNDO_OUTCOME,
  commitReviewDecision,
  pauseReview,
  recordMissingRow,
  recordReviewProposal,
  storedProposalVerdict,
  resumeReview,
  skipReviewItem,
  stopReview,
  undoReviewDecision,
} from "./reviewCommitCore";

export { DECISION_OUTCOME, UNDO_OUTCOME };

export const FUNCTIONAL_DECISIONS = Object.freeze(["Keep", "Revise", "Remove"]);

export const functionalReviewAdapter = {
  states: FUNCTIONAL_VIBE_REVIEW_STATES,
  transition: transitionFunctionalVibeReviewSession,
  currentRowId: (session) => currentFunctionalVibeReviewRowId(session),
  cardRowId: (card) => card?.rowId,
  // Review metadata is stamped onto the row by earlier decisions and is not
  // part of what the reviewer was shown, so it is excluded from the comparison.
  rowFingerprint: (row) => rowFingerprint(row, { ignoreKeys: ["_functionalVibeReview"] }),

  committable: ({ context }) => {
    const decision = context?.decision;
    if (!FUNCTIONAL_DECISIONS.includes(decision)) {
      return { ok: false, error: "A complete Keep, Revise, or Remove proposal is unavailable for this row." };
    }
    if (decision === "Revise" && !context?.proposal?.proposedRow) {
      return { ok: false, error: "The selected model did not provide a complete revised row. Keep, remove, or skip this item instead." };
    }
    return { ok: true };
  },

  applyArgs: ({ session, card, action, context, expectedRowFingerprint }) => ({
    projectId: session.projectId,
    rowId: card.rowId,
    expectedRowFingerprint,
    recoveryRows: context.recoveryRows || [],
    decision: context.decision,
    proposedRow: context.proposal?.proposedRow,
    rationale: context.userFeedback || context.proposal?.rationale || context.proposal?.explanation,
    reviewMeta: {
      provider: session.ai?.provider,
      model: session.ai?.model,
      effort: session.ai?.effort,
      source: action === "accept" ? "accepted-ai-proposal" : "human-override",
    },
    workspaceType: session.workspaceType,
    repoId: session.repoId,
  }),

  missingRecord: (card) => ({
    rowId: card.rowId,
    label: card.label,
    reason: "The row was deleted or replaced after this review began.",
  }),

  validateResult: (result) => (
    result && Number.isInteger(result.rowIndex) && result.previousRow && Array.isArray(result.nextRows)
      ? { ok: true }
      : { ok: false, error: "The functional review decision returned incomplete row evidence. The review was not advanced." }
  ),

  buildRecord: ({ card, action, context, result, now }) => {
    const { decision, proposal, userFeedback = "" } = context;
    // A removed row is gone from nextRows, so it has no post-decision state.
    const nextRow = decision === "Remove" ? null : result.nextRows?.[result.rowIndex];
    return {
      rowId: card.rowId,
      rowIndex: result.rowIndex,
      label: card.label,
      action,
      decision,
      previousRow: result.previousRow,
      affectedRows: result.affectedRows || [],
      nextRow,
      columns: Object.keys({ ...(result.previousRow || {}), ...(nextRow || {}) }),
      proposedRow: proposal?.proposedRow,
      rationale: userFeedback || proposal?.rationale,
      timestamp: now(),
    };
  },

  // The session carries a full row snapshot so a transiently rehydrated project
  // can be rebuilt; it must move forward with each decision and back on undo.
  decisionEventExtras: ({ result }) => ({ rowSnapshot: result.state?.rows }),
  undoEventExtras: ({ undoResult }) => ({ rowSnapshot: undoResult?.state?.rows }),

  auditRecord: ({ session, record }) => ({
    ...record,
    sessionId: session.id,
    projectId: session.projectId,
    threadId: session.threadId,
    provider: session.ai?.provider,
    model: session.ai?.model,
    effort: session.ai?.effort,
  }),

  undoArgs: ({ session, last }) => ({
    projectId: session.projectId,
    record: last,
    workspaceType: session.workspaceType,
    repoId: session.repoId,
  }),

  undoAuditRecord: ({ session, last, now }) => ({
    ...last,
    action: "undo",
    sessionId: session.id,
    projectId: session.projectId,
    threadId: session.threadId,
    timestamp: now(),
  }),

  skipRecord: ({ card, reason }) => ({
    rowId: card?.rowId,
    label: card?.label,
    reason: reason || "Deferred by user.",
  }),
};

export function commitFunctionalReviewDecision(
  { session, card, action, decision, proposal, userFeedback = "", recoveryRows = [] },
  ports = {},
) {
  return commitReviewDecision(
    { session, card, action, context: { decision, proposal, userFeedback, recoveryRows } },
    functionalReviewAdapter,
    ports,
  );
}

export function undoFunctionalReviewDecision({ session }, ports = {}) {
  return undoReviewDecision({ session }, functionalReviewAdapter, ports);
}

export function skipFunctionalReviewItem({ session, card, reason = "" }, ports = {}) {
  return skipReviewItem({ session, card, reason }, functionalReviewAdapter, ports);
}

export function stopFunctionalReview({ session }, ports = {}) {
  return stopReview({ session }, functionalReviewAdapter, ports);
}

export function pauseFunctionalReview({ session }, ports = {}) {
  return pauseReview({ session }, functionalReviewAdapter, ports);
}

export function resumeFunctionalReview({ session, currentRowSnapshot = null }, ports = {}) {
  return resumeReview({ session, currentRowSnapshot }, functionalReviewAdapter, ports);
}

export function recordFunctionalReviewProposal(input, ports = {}) {
  return recordReviewProposal(input, functionalReviewAdapter, ports);
}

export { storedProposalVerdict };

export function recordFunctionalMissingRow({ session, card, reason = "" }, ports = {}) {
  return recordMissingRow({ session, card, reason }, functionalReviewAdapter, ports);
}
