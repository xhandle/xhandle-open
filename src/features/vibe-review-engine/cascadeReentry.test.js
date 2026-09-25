/**
 * The sequence that destroyed hazard analyses.
 *
 *   classification parent
 *     -> significance prerequisite
 *     -> significance = Yes
 *     -> resume the SAME classification parent
 *     -> classification accepted
 *     -> return to the original queue
 *
 * Previously the significance decision pushed a SECOND classification review on
 * top of the suspended original, so the pair re-entered itself. Every cycle
 * wrote another full copy of the row into sessions, audit records and review
 * evidence, and the resulting storage pressure is what preceded each loss.
 */

import {
  DECISION_OUTCOME,
  commitHazardReviewDecision,
  recordHazardReviewProposal,
} from "./hazardDecisionEngine";
import {
  classificationProposal,
  createHazardReviewHarness,
  reviewCard,
  significanceProposal,
} from "./testHarness";
import {
  VIBE_REVIEW_STATES,
  createVibeReviewSession,
  loadVibeReviewSession,
  popVibeReviewSession,
  pushVibeReviewSession,
  readVibeReviewStack,
  saveVibeReviewSession,
} from "../project-hazard-analysis/vibeReviewSession";

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    bytes: () => [...store.values()].reduce((total, value) => total + String(value).length, 0),
  };
};

const sessionFor = (queue, overrides = {}) => ({
  ...createVibeReviewSession({ projectId: "P1", threadId: "T1", queue, reviewerName: "Reviewer" }),
  ...overrides,
});

/** Does a review for this row and target already exist further down the stack? */
const alreadySuspended = (storage, session, target, rowId) =>
  readVibeReviewStack("P1", "T1", storage).some((entry) => (
    String(entry?.id || "") !== String(session.id || "")
    && String(entry?.reviewTarget || "") === target
    && (entry?.queue || []).includes(rowId)
    && ![VIBE_REVIEW_STATES.COMPLETED, VIBE_REVIEW_STATES.CANCELLED].includes(entry?.state)
  ));

/**
 * Drive the full sequence the way the Collaborator does, returning what the
 * stack and the artifact looked like at the end.
 */
async function runCascade(harness, storage) {
  // Persist sessions through the real store, so the assertions below describe
  // what a reload would actually find rather than in-memory return values.
  const ports = { ...harness.ports, saveSession: (next) => saveVibeReviewSession(next, storage) };
  const classificationParent = saveVibeReviewSession(
    sessionFor(["RAW-1"], { reviewTarget: "safetyClassification" }), storage,
  );

  // The row has no governed significance yet, so the parent raises a prerequisite.
  const prerequisite = pushVibeReviewSession(
    sessionFor(["RAW-1"], { reviewTarget: "safetySignificant" }), storage,
  );
  const significance = await commitHazardReviewDecision({
    session: prerequisite, card: reviewCard("RAW-1"),
    action: "yes", proposal: significanceProposal("Yes"),
  }, ports);

  // Safety Significant = Yes cascades to a classification review -- which is the
  // review already suspended underneath. It must resume, not be duplicated.
  const wouldDuplicate = alreadySuspended(storage, significance.session, "safetyClassification", "RAW-1");
  if (!wouldDuplicate) {
    pushVibeReviewSession(sessionFor(["RAW-1"], { reviewTarget: "safetyClassification" }), storage);
  }

  // The prerequisite is finished, so it pops back to its parent.
  const resumed = popVibeReviewSession("P1", "T1", storage);

  const proposed = recordHazardReviewProposal({
    session: { ...resumed, state: VIBE_REVIEW_STATES.PROPOSING },
    proposal: classificationProposal("Safety — Direct"),
    currentRowSnapshot: [...significance.record.nextRow],
  }, ports).session;

  const classification = await commitHazardReviewDecision({
    session: proposed, card: reviewCard("RAW-1"),
    action: "classificationDirect", proposal: classificationProposal("Safety — Direct"),
  }, ports);

  return { classificationParent, significance, classification, wouldDuplicate, resumed };
}

describe("the classification / significance cascade", () => {
  it("resumes the suspended classification review instead of duplicating it", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const storage = memoryStorage();

    const run = await runCascade(harness, storage);

    expect(run.wouldDuplicate).toBe(true);
    expect(run.resumed.id).toBe(run.classificationParent.id);
    expect(run.resumed.reviewTarget).toBe("safetyClassification");
  });

  it("never nests more than one level deep", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const storage = memoryStorage();
    let deepest = 0;
    const original = storage.setItem;
    storage.setItem = (key, value) => {
      if (key.includes("hazardVibeReview.sessions")) {
        Object.values(JSON.parse(value)).forEach((stack) => {
          deepest = Math.max(deepest, Array.isArray(stack) ? stack.length : 1);
        });
      }
      return original(key, value);
    };

    await runCascade(harness, storage);

    expect(deepest).toBeLessThanOrEqual(2);
  });

  it("creates no duplicate session for the same row and target", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const storage = memoryStorage();
    await runCascade(harness, storage);

    const stack = readVibeReviewStack("P1", "T1", storage);
    const pairs = stack.map((entry) => `${entry.reviewTarget}:${entry.queue.join(",")}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("commits exactly one significance and one classification decision", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const storage = memoryStorage();
    const run = await runCascade(harness, storage);

    expect(run.significance.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(run.classification.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.state.applyCalls).toBe(2);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
    expect(harness.valueOf("RAW-1", "Safety Classification")).toBe("Safety — Direct");
  });

  it("returns to the original queue with the review finished", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const storage = memoryStorage();
    const run = await runCascade(harness, storage);

    expect(run.classification.session.state).toBe(VIBE_REVIEW_STATES.COMPLETED);
    expect(loadVibeReviewSession("P1", "T1", storage).state).toBe(VIBE_REVIEW_STATES.COMPLETED);
  });

  it("does not grow persisted storage without bound when repeated", async () => {
    const sizes = [];
    for (let run = 0; run < 12; run += 1) {
      const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
      const storage = memoryStorage();
      // eslint-disable-next-line no-await-in-loop
      await runCascade(harness, storage);
      sizes.push(storage.bytes());
    }
    // Each run is independent, so a re-entrant cascade would show up as steadily
    // increasing persisted bytes rather than a flat line.
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(Math.min(...sizes) * 0.5);
  });

  it("keeps audit records free of whole hazard rows", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const storage = memoryStorage();
    await runCascade(harness, storage);

    harness.state.audit.forEach((entry) => {
      expect(entry.previousRow).toBeUndefined();
      expect(entry.nextRow).toBeUndefined();
      expect(entry.headers).toBeUndefined();
      expect(entry.changedFields).toBeDefined();
    });
    const significanceAudit = harness.state.audit[0];
    expect(significanceAudit.changedFields["Safety Significant"]).toEqual({ before: "Needs Review", after: "Yes" });
  });
});
