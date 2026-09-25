/**
 * The production cascade decision, tested directly.
 *
 * The previous cascade test reimplemented this logic and manually popped the
 * stack, so it could pass while `handleVibeReviewAction` diverged. This exercises
 * the module the component actually calls.
 */

import {
  CASCADE_ACTION,
  committedFieldFor,
  findSuspendedReview,
  followUpTargetForStep,
  planCascadeTransition,
} from "./cascadeTransition";
import { VIBE_REVIEW_STATES } from "../project-hazard-analysis/vibeReviewSession";

const session = (overrides = {}) => ({
  id: "s-current", projectId: "P1", threadId: "T1",
  reviewTarget: "safetySignificant", queue: ["RAW-1"], state: VIBE_REVIEW_STATES.PROPOSING,
  ...overrides,
});

const suspended = (overrides = {}) => ({
  id: "s-parent", projectId: "P1", threadId: "T1",
  reviewTarget: "safetyClassification", queue: ["RAW-1"], state: VIBE_REVIEW_STATES.PROPOSING,
  ...overrides,
});

const step = (type, extras = {}) => ({ type, label: "Review Safety Classification", reason: "because", ...extras });
const cascadeWith = (...steps) => ({ steps });

describe("follow-up target mapping", () => {
  it("maps the two immediate cascade step types", () => {
    expect(followUpTargetForStep(step("hazard-safety-significance"))).toBe("safetySignificant");
    expect(followUpTargetForStep(step("hazard-safety-classification"))).toBe("safetyClassification");
  });

  it("treats every other step as not immediate", () => {
    expect(followUpTargetForStep(step("hazard-causal-analysis-review"))).toBe("");
    expect(followUpTargetForStep(step("hazard-derived-classification"))).toBe("");
    expect(followUpTargetForStep(undefined)).toBe("");
  });

  it("maps each review target to the column it adjudicates", () => {
    expect(committedFieldFor("guidePhraseApplicable")).toBe("Guide Phrase Applicable");
    expect(committedFieldFor("safetySignificant")).toBe("Safety Significant");
    expect(committedFieldFor("classificationResolution")).toBe("Safety Classification");
    expect(committedFieldFor("nonsense")).toBe("Safety Significant");
  });
});

describe("finding a suspended review", () => {
  it("matches on row and target", () => {
    expect(findSuspendedReview([suspended()], {
      sessionId: "s-current", reviewTarget: "safetyClassification", rowId: "RAW-1",
    })).toMatchObject({ id: "s-parent" });
  });

  it("ignores a different row", () => {
    expect(findSuspendedReview([suspended({ queue: ["RAW-9"] })], {
      sessionId: "s-current", reviewTarget: "safetyClassification", rowId: "RAW-1",
    })).toBeNull();
  });

  it("ignores a different target", () => {
    expect(findSuspendedReview([suspended({ reviewTarget: "guidePhraseApplicable" })], {
      sessionId: "s-current", reviewTarget: "safetyClassification", rowId: "RAW-1",
    })).toBeNull();
  });

  it("ignores itself", () => {
    expect(findSuspendedReview([suspended({ id: "s-current" })], {
      sessionId: "s-current", reviewTarget: "safetyClassification", rowId: "RAW-1",
    })).toBeNull();
  });

  it.each([VIBE_REVIEW_STATES.COMPLETED, VIBE_REVIEW_STATES.CANCELLED])(
    "ignores a %s review", (state) => {
      expect(findSuspendedReview([suspended({ state })], {
        sessionId: "s-current", reviewTarget: "safetyClassification", rowId: "RAW-1",
      })).toBeNull();
    },
  );
});

describe("planning what follows a committed decision", () => {
  it("starts a follow-up when none is suspended", () => {
    const plan = planCascadeTransition({
      session: session(),
      stack: [session()],
      rowId: "RAW-1",
      cascade: cascadeWith(step("hazard-safety-classification")),
      cascadeStep: step("hazard-safety-classification"),
    });

    expect(plan.action).toBe(CASCADE_ACTION.START_FOLLOW_UP);
    expect(plan.followUpTarget).toBe("safetyClassification");
  });

  it("resumes the suspended parent instead of duplicating it", () => {
    // This is the exact re-entrant case: a significance prerequisite raised FROM
    // a classification review, whose cascade points back at classification.
    const plan = planCascadeTransition({
      session: session({ id: "s-prereq", reviewTarget: "safetySignificant" }),
      stack: [suspended(), session({ id: "s-prereq" })],
      rowId: "RAW-1",
      cascade: cascadeWith(step("hazard-safety-classification")),
      cascadeStep: step("hazard-safety-classification"),
    });

    expect(plan.action).toBe(CASCADE_ACTION.RESUME_SUSPENDED);
    expect(plan.suspendedReview.id).toBe("s-parent");
  });

  it("offers downstream reviews when no immediate follow-up applies", () => {
    const plan = planCascadeTransition({
      session: session(),
      stack: [session()],
      rowId: "RAW-1",
      cascade: cascadeWith(step("hazard-causal-analysis-review")),
      cascadeStep: step("hazard-causal-analysis-review"),
    });

    expect(plan.action).toBe(CASCADE_ACTION.OFFER_DOWNSTREAM);
    expect(plan.followUpTarget).toBe("");
  });

  it("continues the queue when the cascade is empty", () => {
    const plan = planCascadeTransition({
      session: session(),
      stack: [session()],
      rowId: "RAW-1",
      cascade: cascadeWith(),
      cascadeStep: null,
    });

    expect(plan.action).toBe(CASCADE_ACTION.CONTINUE);
  });

  it("continues rather than offering downstream for an unrecognised target", () => {
    const plan = planCascadeTransition({
      session: session({ reviewTarget: "somethingElse" }),
      stack: [],
      rowId: "RAW-1",
      cascade: cascadeWith(step("hazard-causal-analysis-review")),
      cascadeStep: step("hazard-causal-analysis-review"),
    });

    expect(plan.action).toBe(CASCADE_ACTION.CONTINUE);
  });

  it("never plans a follow-up that would exceed one level of nesting", () => {
    // classification (suspended) -> significance (current) -> classification?
    // The third level is the duplicate; the plan must resume instead.
    const stack = [
      suspended({ id: "s-parent", reviewTarget: "safetyClassification" }),
      session({ id: "s-prereq", reviewTarget: "safetySignificant" }),
    ];
    const plan = planCascadeTransition({
      session: stack[1], stack, rowId: "RAW-1",
      cascade: cascadeWith(step("hazard-safety-classification")),
      cascadeStep: step("hazard-safety-classification"),
    });

    expect(plan.action).not.toBe(CASCADE_ACTION.START_FOLLOW_UP);
  });
});
