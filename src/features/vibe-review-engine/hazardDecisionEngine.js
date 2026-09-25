/**
 * The hazard-analysis adapter over the shared review commit core.
 *
 * This module keeps the hazard-specific knowledge -- which column a review
 * target adjudicates, what a hazard decision record carries, and when a written
 * classification is still unresolved against policy -- and delegates the
 * ordering and invariants to reviewCommitCore.
 */

import { CLASSIFICATION_RESOLUTION_STATUS } from "../project-hazard-analysis/classificationResolutionStatus";
import { rowFingerprint } from "../project-hazard-analysis/governedDecisionCommit";
import {
  VIBE_REVIEW_STATES,
  currentVibeReviewRowId,
  transitionVibeReviewSession,
} from "../project-hazard-analysis/vibeReviewSession";
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

/** Statuses that mean the row's classification is settled against policy. */
export const VALIDATED_RESOLUTION_STATUSES = new Set([
  CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED,
  CLASSIFICATION_RESOLUTION_STATUS.HUMAN_POLICY_VALIDATED,
]);

const REVIEW_VALUE_FIELD = {
  guidePhraseApplicable: "Guide Phrase Applicable",
  safetyClassification: "Safety Classification",
  classificationResolution: "Safety Classification",
  safetySignificant: "Safety Significant",
};

function reviewValueFor(reviewTarget, governedDecision = {}) {
  return governedDecision[REVIEW_VALUE_FIELD[reviewTarget] || REVIEW_VALUE_FIELD.safetySignificant];
}

function governedHeadersFor(reviewTarget, { headers, previousRow, nextRow }, governedDecision) {
  // A guide-phrase decision rewrites a set the caller cannot enumerate up front,
  // so its governed columns are whatever actually changed.
  if (reviewTarget === "guidePhraseApplicable") {
    return new Set(headers.filter((header, index) => previousRow[index] !== nextRow[index]));
  }
  return new Set(Object.keys(governedDecision));
}

export const hazardReviewAdapter = {
  states: VIBE_REVIEW_STATES,
  transition: transitionVibeReviewSession,
  currentRowId: (session) => currentVibeReviewRowId(session),
  cardRowId: (card) => card?.sourceRowId,
  rowFingerprint: (row) => rowFingerprint(row),

  committable: ({ context }) => (context?.proposal?.governedDecision
    ? { ok: true }
    : { ok: false, error: "A definitive proposal is unavailable." }),

  applyArgs: ({ session, card, action, context, expectedRowFingerprint }) => {
    const { proposal, userFeedback = "" } = context;
    const governedDecision = proposal.governedDecision;
    return {
      projectId: session.projectId,
      sourceRowId: card.sourceRowId,
      workspaceType: session.workspaceType,
      sourceRunId: session.sourceRunId,
      reviewTarget: session.reviewTarget || "safetySignificant",
      reviewerDisposition: action === "yes" || action === "no",
      expectedRowFingerprint,
      update: {
        ...proposal,
        ...governedDecision,
        "Classification Evidence": `${governedDecision["Classification Evidence"] || proposal["Classification Evidence"] || ""}${
          userFeedback ? ` User-supplied feedback: ${userFeedback}` : ""}`.trim(),
      },
    };
  },

  missingRecord: (card) => ({
    sourceRowId: card.sourceRowId,
    reason: "The source row no longer exists in the active hazard analysis.",
  }),

  validateResult: (result) => (
    Array.isArray(result?.headers) && Array.isArray(result?.previousRow) && Array.isArray(result?.nextRow)
      ? { ok: true }
      : { ok: false, error: "The hazard review decision returned incomplete row evidence. The review was not advanced." }
  ),

  changedColumns: ({ result }) => result.headers.filter(
    (header, index) => result.previousRow[index] !== result.nextRow[index],
  ),

  buildRecord: ({ session, card, action, context, result, now }) => {
    const { proposal, userFeedback = "" } = context;
    const governedDecision = proposal.governedDecision;
    const reviewTarget = session.reviewTarget || "safetySignificant";
    const governedHeaders = governedHeadersFor(reviewTarget, result, governedDecision);
    return {
      sourceRowId: card.sourceRowId,
      rowIndex: result.rowIndex - 1,
      label: `${card.from} → ${card.controlAction} → ${card.to}`,
      action,
      previousRow: result.previousRow,
      nextRow: result.nextRow,
      headers: result.headers,
      previousGovernedFields: Object.fromEntries(
        result.headers
          .map((header, index) => [header, result.previousRow[index]])
          .filter(([header]) => governedHeaders.has(header)),
      ),
      reviewTarget,
      newReviewValue: reviewValueFor(reviewTarget, governedDecision),
      newSafetySignificant: governedDecision["Safety Significant"],
      proposal: {
        normalizedDecision: proposal.normalizedDecision,
        confidence: proposal.applicabilityConfidence || governedDecision["Classification Confidence"],
      },
      rationale: governedDecision["Guide Phrase Applicability Rationale"]
        || governedDecision["Safety Significance Rationale"]
        || governedDecision["Classification Evidence"]
        || proposal.explanation
        || "",
      userFeedback,
      reviewerName: session.reviewerName || "",
      reviewerId: session.reviewerId || "",
      timestamp: now(),
    };
  },

  /**
   * A classification-resolution review writes the row but has not finished its
   * job until policy validation passes, so it holds the item rather than
   * advancing past an unresolved gap.
   */
  holdPosition: ({ session, result }) => {
    const unresolved = (session.reviewTarget || "safetySignificant") === "classificationResolution"
      && !VALIDATED_RESOLUTION_STATUSES.has(result.classificationResolutionStatus);
    return unresolved
      ? { sessionPatch: { state: VIBE_REVIEW_STATES.AWAITING, proposal: null, currentRowSnapshot: [...result.nextRow] } }
      : null;
  },

  auditRecord: ({ session, record, result, holding }) => ({
    // Deliberately omit previousRow/nextRow/headers. The audit map lives in
    // localStorage capped at 250 records per project; carrying two complete
    // hazard rows per decision is what turns a long review into storage
    // exhaustion. The changed values are what an audit actually needs.
    ...Object.fromEntries(Object.entries(record).filter(([key]) => (
      !["previousRow", "nextRow", "headers"].includes(key)
    ))),
    changedFields: Object.fromEntries(
      (result?.headers || [])
        .map((header, index) => [header, result.previousRow?.[index], result.nextRow?.[index]])
        .filter(([, before, after]) => before !== after)
        .map(([header, before, after]) => [header, { before, after }]),
    ),
    sessionId: session.id,
    projectId: session.projectId,
    threadId: session.threadId,
    provider: session.ai?.provider,
    model: session.ai?.model,
    effort: session.ai?.effort,
    validationOutcome: holding ? "applied_unresolved" : "applied",
    newGovernedFields: record.newGovernedFields,
  }),

  undoArgs: ({ session, last }) => ({
    projectId: session.projectId,
    sourceRowId: last.sourceRowId,
    previousGovernedFields: last.previousGovernedFields,
    workspaceType: session.workspaceType,
    sourceRunId: session.sourceRunId,
  }),

  undoAuditRecord: ({ session, last, now }) => ({
    sessionId: session.id,
    projectId: session.projectId,
    threadId: session.threadId,
    sourceRowId: last.sourceRowId,
    action: "undo",
    provider: session.ai?.provider,
    model: session.ai?.model,
    effort: session.ai?.effort,
    timestamp: now(),
    validationOutcome: "restored",
  }),

  skipRecord: ({ card, reason }) => ({
    sourceRowId: card?.sourceRowId,
    reason: reason || "Deferred by user.",
  }),
};

export async function commitHazardReviewDecision({ session, card, action, proposal, userFeedback = "" }, ports = {}) {
  const outcome = await commitReviewDecision(
    { session, card, action, context: { proposal, userFeedback } },
    hazardReviewAdapter,
    {
      ...ports,
      appendAudit: ports.appendAudit
        // The governed fields belong on the audit record but not on the session
        // decision record, so they are attached at the audit boundary.
        ? (audit) => ports.appendAudit({ ...audit, newGovernedFields: proposal?.governedDecision })
        : undefined,
    },
  );
  return outcome;
}

export function undoHazardReviewDecision({ session }, ports = {}) {
  return undoReviewDecision({ session }, hazardReviewAdapter, ports);
}

export function skipHazardReviewItem({ session, card, reason = "" }, ports = {}) {
  return skipReviewItem({ session, card, reason }, hazardReviewAdapter, ports);
}

export function stopHazardReview({ session }, ports = {}) {
  return stopReview({ session }, hazardReviewAdapter, ports);
}

export function pauseHazardReview({ session }, ports = {}) {
  return pauseReview({ session }, hazardReviewAdapter, ports);
}

export function resumeHazardReview({ session, currentRowSnapshot = null }, ports = {}) {
  return resumeReview({ session, currentRowSnapshot }, hazardReviewAdapter, ports);
}

export function recordHazardReviewProposal(input, ports = {}) {
  return recordReviewProposal(input, hazardReviewAdapter, ports);
}

export { storedProposalVerdict };

export function recordHazardMissingRow({ session, card, reason = "" }, ports = {}) {
  return recordMissingRow({ session, card, reason }, hazardReviewAdapter, ports);
}
