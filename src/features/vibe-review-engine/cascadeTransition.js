/**
 * What happens after a hazard review decision commits.
 *
 * This decision used to live inline in `handleVibeReviewAction`, inside a file
 * that cannot be imported by a test (it pulls in ESM `react-markdown`). The
 * cascade test therefore reimplemented the logic and could pass while
 * production diverged -- which is how the re-entrant classification/significance
 * loop survived a green suite.
 *
 * Everything here is pure: given the session, its stack, and the planned
 * cascade, decide what the orchestrator should do next. The orchestrator owns
 * the side effects.
 */

import { VIBE_REVIEW_STATES } from "../project-hazard-analysis/vibeReviewSession";

export const CASCADE_ACTION = Object.freeze({
  /** Start a prerequisite or follow-up review for the same row. */
  START_FOLLOW_UP: "start-follow-up",
  /** A review for this row and target is already suspended below; let it resume. */
  RESUME_SUSPENDED: "resume-suspended",
  /** Offer the reviewer a choice of downstream column reviews. */
  OFFER_DOWNSTREAM: "offer-downstream",
  /** Nothing further; continue the current queue. */
  CONTINUE: "continue",
});

/** Which review target a cascade step corresponds to, if it is an immediate one. */
const FOLLOW_UP_TARGET_BY_STEP = {
  "hazard-safety-significance": "safetySignificant",
  "hazard-safety-classification": "safetyClassification",
};

export function followUpTargetForStep(step) {
  return FOLLOW_UP_TARGET_BY_STEP[step?.type] || "";
}

/** The column a review target is responsible for adjudicating. */
export const COMMITTED_FIELD_BY_TARGET = Object.freeze({
  guidePhraseApplicable: "Guide Phrase Applicable",
  safetySignificant: "Safety Significant",
  safetyClassification: "Safety Classification",
  classificationResolution: "Safety Classification",
});

export function committedFieldFor(reviewTarget) {
  return COMMITTED_FIELD_BY_TARGET[reviewTarget] || COMMITTED_FIELD_BY_TARGET.safetySignificant;
}

const ACTIVE = (state) => ![VIBE_REVIEW_STATES.COMPLETED, VIBE_REVIEW_STATES.CANCELLED].includes(state);

/**
 * Is a review for this row and target already suspended further down the stack?
 *
 * Accepting a significance prerequisite raised FROM a classification review
 * would otherwise push a second classification review on top of the suspended
 * original. The pair then re-enters itself, the stack grows every cycle, and
 * each cycle writes another full copy of the row into sessions, audit records,
 * and review evidence.
 */
export function findSuspendedReview(stack, { sessionId, reviewTarget, rowId }) {
  if (!reviewTarget) return null;
  return (stack || []).find((entry) => (
    String(entry?.id || "") !== String(sessionId || "")
    && String(entry?.reviewTarget || "") === reviewTarget
    && (entry?.queue || []).includes(rowId)
    && ACTIVE(entry?.state)
  )) || null;
}

const DOWNSTREAM_ELIGIBLE = [
  "guidePhraseApplicable", "safetySignificant", "safetyClassification", "classificationResolution",
];

/**
 * Decide what follows a committed decision.
 *
 * @param {object} input
 * @param {object} input.session   the session that just committed
 * @param {Array}  input.stack     every session on this thread, oldest first
 * @param {string} input.rowId     the row that was decided
 * @param {object} input.cascade   the planned cascade
 * @param {object} input.cascadeStep the current step of that cascade
 * @returns {{action: string, followUpTarget: string, suspendedReview: object|null,
 *            committedField: string, step: object|null}}
 */
export function planCascadeTransition({ session, stack = [], rowId, cascade, cascadeStep } = {}) {
  const reviewTarget = session?.reviewTarget || "safetySignificant";
  const followUpTarget = followUpTargetForStep(cascadeStep);
  const committedField = committedFieldFor(reviewTarget);

  if (followUpTarget) {
    const suspendedReview = findSuspendedReview(stack, {
      sessionId: session?.id, reviewTarget: followUpTarget, rowId,
    });
    if (suspendedReview) {
      return {
        action: CASCADE_ACTION.RESUME_SUSPENDED,
        followUpTarget, suspendedReview, committedField, step: cascadeStep,
      };
    }
    return {
      action: CASCADE_ACTION.START_FOLLOW_UP,
      followUpTarget, suspendedReview: null, committedField, step: cascadeStep,
    };
  }

  const hasDownstreamChoice = DOWNSTREAM_ELIGIBLE.includes(reviewTarget)
    && (cascade?.steps?.length || 0) > 0;

  return {
    action: hasDownstreamChoice ? CASCADE_ACTION.OFFER_DOWNSTREAM : CASCADE_ACTION.CONTINUE,
    followUpTarget: "", suspendedReview: null, committedField, step: cascadeStep || null,
  };
}
