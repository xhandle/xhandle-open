/**
 * Lifecycle tests for the hazard review commit-and-advance path.
 *
 * These are the tests that could not exist while the state machine lived inside
 * the chat component: each one drives a real artifact write through the real
 * commit verification and then asserts on the artifact and the cursor together.
 */

import {
  DECISION_OUTCOME,
  UNDO_OUTCOME,
  commitHazardReviewDecision,
  pauseHazardReview,
  recordHazardReviewProposal,
  storedProposalVerdict,
  resumeHazardReview,
  skipHazardReviewItem,
  stopHazardReview,
  undoHazardReviewDecision,
} from "./hazardDecisionEngine";
import {
  HARNESS_HEADERS,
  classificationProposal,
  createHazardReviewHarness,
  reviewCard,
  significanceProposal,
} from "./testHarness";
import { VIBE_REVIEW_STATES, createVibeReviewSession } from "../project-hazard-analysis/vibeReviewSession";

const sessionFor = (queue, overrides = {}) => ({
  ...createVibeReviewSession({
    projectId: "P1",
    threadId: "T1",
    queue,
    reviewTarget: "safetySignificant",
    reviewerName: "Reviewer",
  }),
  ...overrides,
});

describe("committing a decision", () => {
  it("writes the decision, records it, and advances the cursor exactly once", async () => {
    const harness = createHazardReviewHarness();
    const session = sessionFor(["RAW-1", "RAW-2"]);

    const outcome = await commitHazardReviewDecision({
      session,
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(outcome.committed).toBe(true);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.decisions).toHaveLength(1);
    expect(harness.state.audit).toHaveLength(1);
    expect(harness.state.audit[0].validationOutcome).toBe("applied");
    expect(harness.state.applyCalls).toBe(1);
  });

  it("completes the review when the last queued item is decided", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1"]),
      card: reviewCard("RAW-1"),
      action: "yes",
      proposal: significanceProposal("Yes"),
    }, harness.ports);

    expect(outcome.completed).toBe(true);
    expect(outcome.session.state).toBe(VIBE_REVIEW_STATES.COMPLETED);
  });

  it("captures the pre-decision values needed to undo it", async () => {
    const harness = createHazardReviewHarness({
      rowOverrides: { "RAW-1": { "Safety Significant": "Yes", "Safety Significance Rationale": "Original basis." } },
    });
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.record.previousGovernedFields).toMatchObject({
      "Safety Significant": "Yes",
      "Safety Significance Rationale": "Original basis.",
    });
  });

  it("reports the committed row, not the proposal, as evidence", async () => {
    const harness = createHazardReviewHarness();
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1"]),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    const storedRow = harness.state.summary[1];
    expect(outcome.record.nextRow).toEqual(storedRow);
  });
});

describe("failure before the write", () => {
  it("leaves the artifact and the cursor untouched when the write throws", async () => {
    const harness = createHazardReviewHarness();
    harness.state.faults.write = new Error("IndexedDB is unavailable");
    const session = sessionFor(["RAW-1", "RAW-2"]);

    const outcome = await commitHazardReviewDecision({
      session,
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(outcome.committed).toBe(false);
    expect(outcome.error).toContain("IndexedDB is unavailable");
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Needs Review");
    expect(outcome.session.cursor).toBe(0);
    expect(outcome.session.decisions).toHaveLength(0);
  });

  it("rejects the commit when the write is silently dropped", async () => {
    const harness = createHazardReviewHarness();
    harness.state.faults.dropWrite = true;

    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    // This is the case that previously reported success and advanced.
    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(outcome.error).toContain("was not stored");
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Needs Review");
    expect(outcome.session.cursor).toBe(0);
    expect(harness.state.audit).toHaveLength(0);
  });

  it("refuses a decision with no governed proposal", async () => {
    const harness = createHazardReviewHarness();
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1"]),
      card: reviewCard("RAW-1"),
      action: "accept",
      proposal: { normalizedDecision: "Needs Review" },
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(outcome.committable).toBe(false);
    expect(harness.state.applyCalls).toBe(0);
  });

  it("refuses to act on a card the review has already moved past", async () => {
    const harness = createHazardReviewHarness();
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"], { cursor: 1 }),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(outcome.stale).toBe(true);
    expect(harness.state.applyCalls).toBe(0);
  });
});

describe("failure after the write", () => {
  it.each([
    ["audit", "the audit log is full"],
    ["capture", "evidence capture failed"],
  ])("keeps a committed decision when %s fails", async (seam, message) => {
    const harness = createHazardReviewHarness();
    harness.state.faults[seam] = new Error(message);

    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    // The decision stands and the cursor advances: re-presenting this row would
    // let the same decision be applied twice and destroy the undo baseline.
    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(outcome.committed).toBe(true);
    expect(outcome.bookkeepingComplete).toBe(false);
    expect(outcome.session.cursor).toBe(1);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
    expect(harness.state.bookkeepingErrors).toHaveLength(1);
  });

  it("does not re-apply a decision when the same card is submitted twice", async () => {
    const harness = createHazardReviewHarness();
    const card = reviewCard("RAW-1");
    const first = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]), card, action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    const second = await commitHazardReviewDecision({
      session: first.session, card, action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(second.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(second.stale).toBe(true);
    expect(harness.state.applyCalls).toBe(1);
    expect(first.session.decisions).toHaveLength(1);
  });
});

describe("a row that vanished mid-review", () => {
  it("advances past it without recording a decision", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-2"] });

    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.SOURCE_ROW_MISSING);
    expect(outcome.committed).toBe(false);
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.decisions).toHaveLength(0);
    expect(outcome.session.missingRows).toHaveLength(1);
  });
});

describe("an unresolved policy gap", () => {
  const unresolvedRow = {
    "Guide Phrase Applicable": "Yes",
    "Safety Significant": "Yes",
    "Safety Classification": "Safety — Related",
    "Causal Path Type": "Contributory",
    // A Related classification with no intermediate safety function fails policy.
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
  };

  it("holds position instead of advancing", async () => {
    const harness = createHazardReviewHarness({ rowOverrides: { "RAW-1": unresolvedRow } });
    const session = sessionFor(["RAW-1", "RAW-2"], { reviewTarget: "classificationResolution" });

    const outcome = await commitHazardReviewDecision({
      session,
      card: reviewCard("RAW-1"),
      action: "classificationRelated",
      proposal: classificationProposal("Safety — Related"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.UNRESOLVED);
    expect(outcome.committed).toBe(true);
    expect(outcome.session.cursor).toBe(0);
    expect(outcome.session.decisions).toHaveLength(0);
    expect(outcome.session.state).toBe(VIBE_REVIEW_STATES.AWAITING);
  });

  it("records the attempt as applied_unresolved rather than applied", async () => {
    const harness = createHazardReviewHarness({ rowOverrides: { "RAW-1": unresolvedRow } });
    await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"], { reviewTarget: "classificationResolution" }),
      card: reviewCard("RAW-1"),
      action: "classificationRelated",
      proposal: classificationProposal("Safety — Related"),
    }, harness.ports);

    expect(harness.state.audit[0].validationOutcome).toBe("applied_unresolved");
  });

  it("advances once a supported classification resolves the gap", async () => {
    const harness = createHazardReviewHarness({ rowOverrides: { "RAW-1": unresolvedRow } });
    const session = sessionFor(["RAW-1", "RAW-2"], { reviewTarget: "classificationResolution" });

    const first = await commitHazardReviewDecision({
      session, card: reviewCard("RAW-1"), action: "classificationRelated",
      proposal: classificationProposal("Safety — Related"),
    }, harness.ports);
    expect(first.session.cursor).toBe(0);

    // Safety — Direct implies Yes, which agrees with the row's governed
    // Safety Significant = Yes, and the row carries the causal effect and
    // resulting state a Direct classification requires.
    const second = await commitHazardReviewDecision({
      session: first.session, card: reviewCard("RAW-1"), action: "classificationDirect",
      proposal: classificationProposal("Safety — Direct"),
    }, harness.ports);

    expect(second.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(second.session.cursor).toBe(1);
    expect(harness.valueOf("RAW-1", "Safety Classification")).toBe("Safety — Direct");
  });

  it("will not let a classification that contradicts the governed decision close the gap", async () => {
    const harness = createHazardReviewHarness({ rowOverrides: { "RAW-1": unresolvedRow } });

    // Not Applicable implies Safety Significant = No, but the row's governed
    // decision is Yes. Under reviewer-governed significance that disagreement
    // is the reviewer's to settle, so the gap stays open and the review holds
    // its position rather than quietly changing the decision to match.
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"], { reviewTarget: "classificationResolution" }),
      card: reviewCard("RAW-1"),
      action: "classificationNotApplicable",
      proposal: classificationProposal("Not Applicable"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.UNRESOLVED);
    expect(outcome.session.cursor).toBe(0);
    expect(outcome.result.classificationResolutionFindings.join(" ")).toContain("governed review decision");
    // The governed decision is untouched by the attempt.
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
  });
});

describe("governed ownership across a whole review", () => {
  it("never lets a later classification decision rewrite an earlier significance decision", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });

    // The reviewer first adjudicates significance as No.
    const first = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1"]),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");

    // A later classification review marks the row Safety — Direct, which would
    // previously have flipped the stored significance back to Yes on save.
    const classificationSession = sessionFor(["RAW-1"], { reviewTarget: "safetyClassification" });
    await commitHazardReviewDecision({
      session: classificationSession,
      card: reviewCard("RAW-1"),
      action: "classificationDirect",
      proposal: classificationProposal("Safety — Direct"),
    }, harness.ports);

    expect(harness.valueOf("RAW-1", "Safety Classification")).toBe("Safety — Direct");
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
    expect(first.session.decisions[0].newReviewValue).toBe("No");
  });
});

describe("undoing a decision", () => {
  const withPriorDecision = async (harness, overrides = {}) => {
    const applied = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"], overrides),
      card: reviewCard("RAW-1"),
      action: "no",
      proposal: significanceProposal("No"),
    }, harness.ports);
    return applied.session;
  };

  it("restores the values that existed before the decision", async () => {
    const harness = createHazardReviewHarness({
      rowOverrides: { "RAW-1": { "Safety Significant": "Yes", "Safety Significance Rationale": "Original basis." } },
    });
    const session = await withPriorDecision(harness);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");

    const outcome = await undoHazardReviewDecision({ session }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.RESTORED);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
    expect(harness.valueOf("RAW-1", "Safety Significance Rationale")).toBe("Original basis.");
  });

  it("returns the cursor to the undone row and drops the decision", async () => {
    const harness = createHazardReviewHarness();
    const session = await withPriorDecision(harness);
    expect(session.cursor).toBe(1);

    const outcome = await undoHazardReviewDecision({ session }, harness.ports);

    expect(outcome.session.cursor).toBe(0);
    expect(outcome.session.decisions).toHaveLength(0);
  });

  it("adds a compensating audit record instead of deleting the original", async () => {
    const harness = createHazardReviewHarness();
    const session = await withPriorDecision(harness);
    await undoHazardReviewDecision({ session }, harness.ports);

    expect(harness.state.audit).toHaveLength(2);
    expect(harness.state.audit[0].validationOutcome).toBe("applied");
    expect(harness.state.audit[1]).toMatchObject({ action: "undo", validationOutcome: "restored" });
  });

  it("refuses when there is nothing to undo", async () => {
    const harness = createHazardReviewHarness();
    const outcome = await undoHazardReviewDecision({ session: sessionFor(["RAW-1"]) }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.NOTHING_TO_UNDO);
    expect(harness.state.undoCalls).toBe(0);
  });

  it("keeps the decision intact when the restore itself fails", async () => {
    const harness = createHazardReviewHarness();
    const session = await withPriorDecision(harness);
    harness.state.faults.undo = new Error("the artifact is read-only");

    const outcome = await undoHazardReviewDecision({ session }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.RESTORE_FAILED);
    expect(outcome.restored).toBe(false);
    // Neither the row nor the cursor moved, so the reviewer can retry.
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.decisions).toHaveLength(1);
  });

  it("can re-decide a row after undoing it", async () => {
    const harness = createHazardReviewHarness();
    const session = await withPriorDecision(harness);
    const undone = await undoHazardReviewDecision({ session }, harness.ports);

    const redecided = await commitHazardReviewDecision({
      session: undone.session,
      card: reviewCard("RAW-1"),
      action: "yes",
      proposal: significanceProposal("Yes"),
    }, harness.ports);

    expect(redecided.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
    expect(redecided.session.cursor).toBe(1);
    expect(redecided.session.decisions).toHaveLength(1);
  });

  it("undoes only the most recent decision when several rows were reviewed", async () => {
    const harness = createHazardReviewHarness({
      rowOverrides: {
        "RAW-1": { "Safety Significant": "Yes" },
        "RAW-2": { "Safety Significant": "Yes" },
      },
    });
    const first = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]), card: reviewCard("RAW-1"),
      action: "no", proposal: significanceProposal("No"),
    }, harness.ports);
    const second = await commitHazardReviewDecision({
      session: first.session, card: reviewCard("RAW-2"),
      action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    const outcome = await undoHazardReviewDecision({ session: second.session }, harness.ports);

    expect(harness.valueOf("RAW-2", "Safety Significant")).toBe("Yes");
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.decisions).toHaveLength(1);
  });
});

describe("skipping and stopping", () => {
  it("advances past a skipped item without touching the artifact", () => {
    const harness = createHazardReviewHarness();
    const outcome = skipHazardReviewItem({
      session: sessionFor(["RAW-1", "RAW-2"]),
      card: reviewCard("RAW-1"),
      reason: "Needs the interface contract first.",
    }, harness.ports);

    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.skips).toHaveLength(1);
    expect(outcome.session.skips[0].reason).toBe("Needs the interface contract first.");
    expect(outcome.session.decisions).toHaveLength(0);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Needs Review");
    expect(harness.state.applyCalls).toBe(0);
  });

  it("completes the review when the last item is skipped", () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const outcome = skipHazardReviewItem({
      session: sessionFor(["RAW-1"]), card: reviewCard("RAW-1"),
    }, harness.ports);

    expect(outcome.completed).toBe(true);
    expect(outcome.session.state).toBe(VIBE_REVIEW_STATES.COMPLETED);
  });

  it("keeps decisions already applied when the review is stopped early", async () => {
    const harness = createHazardReviewHarness();
    const applied = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]), card: reviewCard("RAW-1"),
      action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    const outcome = stopHazardReview({ session: applied.session }, harness.ports);

    expect(outcome.session.state).toBe(VIBE_REVIEW_STATES.CANCELLED);
    expect(outcome.session.decisions).toHaveLength(1);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
  });
});

describe("replay and interrupted attempts", () => {
  const commit = (harness, session, card = reviewCard("RAW-1")) => commitHazardReviewDecision({
    session, card, action: "no", proposal: significanceProposal("No"),
  }, harness.ports);

  it("stamps every decision with a stable key for its queue position", async () => {
    const harness = createHazardReviewHarness();
    const session = sessionFor(["RAW-1", "RAW-2"]);
    const outcome = await commit(harness, session);

    expect(outcome.record.decisionKey).toBe(`${session.id}:RAW-1:0`);
    expect(harness.state.audit[0].decisionKey).toBe(outcome.record.decisionKey);
  });

  it("refuses a decision already recorded under the same key", async () => {
    const harness = createHazardReviewHarness();
    const applied = await commit(harness, sessionFor(["RAW-1", "RAW-2"]));

    // Rewind only the cursor, as a restored-but-stale session would look.
    const rewound = { ...applied.session, cursor: 0 };
    const replay = await commit(harness, rewound);

    expect(replay.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(replay.replay).toBe(true);
    expect(harness.state.applyCalls).toBe(1);
  });

  it("clears the pending marker once the decision is recorded", async () => {
    const harness = createHazardReviewHarness();
    const outcome = await commit(harness, sessionFor(["RAW-1", "RAW-2"]));
    expect(outcome.session.pendingCommit).toBeNull();
    // The marker was set before the write, so an interruption is detectable.
    expect(harness.savedSessions().some((entry) => entry.pendingCommit?.rowId === "RAW-1")).toBe(true);
  });

  it("leaves the pending marker set when the write fails midway", async () => {
    const harness = createHazardReviewHarness();
    harness.state.faults.write = new Error("interrupted");
    await commit(harness, sessionFor(["RAW-1", "RAW-2"]));

    const persisted = harness.lastSavedSession();
    expect(persisted.pendingCommit).toMatchObject({ rowId: "RAW-1" });
  });

  it("flags a decision re-applied after an interrupted attempt", async () => {
    const harness = createHazardReviewHarness();
    const session = sessionFor(["RAW-1", "RAW-2"]);
    // Simulate a reload that found the previous attempt still pending.
    const resumed = {
      ...session,
      pendingCommit: { decisionKey: `${session.id}:RAW-1:0`, rowId: "RAW-1", startedAt: "2026-09-20T00:00:00.000Z" },
    };

    const outcome = await commit(harness, resumed);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(outcome.record.replayedAfterInterruption).toBe(true);
    expect(outcome.record.baselineUncertain).toBe(true);
  });

  it("refuses to undo a decision whose restore baseline cannot be trusted", async () => {
    const harness = createHazardReviewHarness();
    const session = sessionFor(["RAW-1", "RAW-2"]);
    const resumed = {
      ...session,
      pendingCommit: { decisionKey: `${session.id}:RAW-1:0`, rowId: "RAW-1", startedAt: "2026-09-20T00:00:00.000Z" },
    };
    const applied = await commit(harness, resumed);

    const outcome = await undoHazardReviewDecision({ session: applied.session }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.RESTORE_FAILED);
    expect(outcome.baselineUncertain).toBe(true);
    expect(outcome.error).toContain("review the row directly");
    // Refusing means the artifact is left exactly as the decision left it.
    expect(harness.state.undoCalls).toBe(0);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
  });

  it("still undoes normally when the attempt was not interrupted", async () => {
    const harness = createHazardReviewHarness({
      rowOverrides: { "RAW-1": { "Safety Significant": "Yes" } },
    });
    const applied = await commit(harness, sessionFor(["RAW-1", "RAW-2"]));
    const outcome = await undoHazardReviewDecision({ session: applied.session }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.RESTORED);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
  });
});

describe("pausing and resuming", () => {
  it("pauses without touching the artifact or the cursor", async () => {
    const harness = createHazardReviewHarness();
    const paused = pauseHazardReview({ session: sessionFor(["RAW-1", "RAW-2"]) }, harness.ports);

    expect(paused.session.state).toBe(VIBE_REVIEW_STATES.PAUSED);
    expect(paused.session.cursor).toBe(0);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Needs Review");
    expect(harness.state.applyCalls).toBe(0);
  });

  it("resumes at the saved position with decisions intact", async () => {
    const harness = createHazardReviewHarness();
    const applied = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]), card: reviewCard("RAW-1"),
      action: "no", proposal: significanceProposal("No"),
    }, harness.ports);
    const paused = pauseHazardReview({ session: applied.session }, harness.ports);

    const resumed = resumeHazardReview({ session: paused.session }, harness.ports);

    expect(resumed.resumed).toBe(true);
    expect(resumed.session.cursor).toBe(1);
    expect(resumed.session.decisions).toHaveLength(1);
  });

  it("refuses to resume a finished review", () => {
    const harness = createHazardReviewHarness();
    const resumed = resumeHazardReview({
      session: sessionFor(["RAW-1"], { state: VIBE_REVIEW_STATES.COMPLETED }),
    }, harness.ports);

    expect(resumed.resumed).toBe(false);
    expect(resumed.error).toContain("finished and cannot be resumed");
  });

  it("refuses to resume a review whose queue is exhausted", () => {
    const harness = createHazardReviewHarness();
    const resumed = resumeHazardReview({
      session: sessionFor(["RAW-1"], { cursor: 1, state: VIBE_REVIEW_STATES.PAUSED }),
    }, harness.ports);

    expect(resumed.resumed).toBe(false);
    expect(resumed.error).toContain("no current row");
  });

  it("refuses to resume when the saved current row changed underneath it", () => {
    const harness = createHazardReviewHarness();
    const session = sessionFor(["RAW-1", "RAW-2"], {
      state: VIBE_REVIEW_STATES.PAUSED,
      currentRowSnapshot: ["RAW-1", "as paused"],
    });

    const resumed = resumeHazardReview({ session, currentRowSnapshot: ["RAW-1", "changed since"] }, harness.ports);

    expect(resumed.resumed).toBe(false);
    expect(resumed.rowChanged).toBe(true);
    expect(resumed.error).toContain("No data was changed");
  });

  it("returns straight to an awaiting decision when one was already proposed", () => {
    const harness = createHazardReviewHarness();
    const session = sessionFor(["RAW-1", "RAW-2"], {
      state: VIBE_REVIEW_STATES.PAUSED,
      proposal: significanceProposal("No"),
    });

    const resumed = resumeHazardReview({ session }, harness.ports);

    expect(resumed.awaitingDecision).toBe(true);
    expect(resumed.session.state).toBe(VIBE_REVIEW_STATES.AWAITING);
  });

  it("can still commit the current item after a pause and resume", async () => {
    const harness = createHazardReviewHarness();
    const paused = pauseHazardReview({ session: sessionFor(["RAW-1", "RAW-2"]) }, harness.ports);
    const resumed = resumeHazardReview({ session: paused.session }, harness.ports);

    const outcome = await commitHazardReviewDecision({
      session: resumed.session, card: reviewCard("RAW-1"),
      action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
  });
});

describe("a row that changed under an open proposal", () => {
  const proposedOn = (harness, session, rowId = "RAW-1") => {
    // Record the proposal, capturing the row as the reviewer was shown it.
    const summaryIndex = harness.state.summary.findIndex((row) => row[0] === rowId);
    return recordHazardReviewProposal({
      session,
      proposal: significanceProposal("No"),
      currentRowSnapshot: [...harness.state.summary[summaryIndex]],
    }, harness.ports).session;
  };

  it("refuses the decision and writes nothing", async () => {
    const harness = createHazardReviewHarness();
    const proposed = proposedOn(harness, sessionFor(["RAW-1", "RAW-2"]));

    // Someone edits the row after the proposal was prepared.
    const rowIndex = harness.state.summary.findIndex((row) => row[0] === "RAW-1");
    harness.state.summary[rowIndex] = harness.state.summary[rowIndex].map((value, index) => (
      index === HARNESS_HEADERS.indexOf("Causal Effect") ? "Edited by someone else" : value
    ));

    const outcome = await commitHazardReviewDecision({
      session: proposed, card: reviewCard("RAW-1"), action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.CONFLICT);
    expect(outcome.committed).toBe(false);
    expect(outcome.error).toContain("changed after the proposal was prepared");
    // The edit survives and the decision was not applied over it.
    expect(harness.valueOf("RAW-1", "Causal Effect")).toBe("Edited by someone else");
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Needs Review");
    expect(outcome.session.cursor).toBe(0);
    expect(harness.state.audit).toHaveLength(0);
  });

  it("clears the pending marker so a later retry is not treated as interrupted", async () => {
    const harness = createHazardReviewHarness();
    const proposed = proposedOn(harness, sessionFor(["RAW-1", "RAW-2"]));
    const rowIndex = harness.state.summary.findIndex((row) => row[0] === "RAW-1");
    harness.state.summary[rowIndex] = harness.state.summary[rowIndex].map((value, index) => (
      index === HARNESS_HEADERS.indexOf("Causal Effect") ? "Edited by someone else" : value
    ));

    await commitHazardReviewDecision({
      session: proposed, card: reviewCard("RAW-1"), action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(harness.lastSavedSession().pendingCommit).toBeNull();

    // Re-deciding against the row as it now stands succeeds cleanly.
    const reproposed = proposedOn(harness, sessionFor(["RAW-1", "RAW-2"]));
    const retry = await commitHazardReviewDecision({
      session: reproposed, card: reviewCard("RAW-1"), action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(retry.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(retry.record.baselineUncertain).toBeUndefined();
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
  });

  it("applies normally when the row is untouched", async () => {
    const harness = createHazardReviewHarness();
    const proposed = proposedOn(harness, sessionFor(["RAW-1", "RAW-2"]));

    const outcome = await commitHazardReviewDecision({
      session: proposed, card: reviewCard("RAW-1"), action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("No");
  });

  it("still applies when no proposal snapshot was captured", async () => {
    const harness = createHazardReviewHarness();
    const outcome = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1", "RAW-2"]), card: reviewCard("RAW-1"),
      action: "no", proposal: significanceProposal("No"),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
  });
});

describe("a significance decision followed immediately by its classification follow-up", () => {
  /**
   * This is the cascade sequence that looped in the app: marking Yes commits a
   * safety-significance decision and then starts a safety-classification review
   * for the same row, inside one handler. If the second commit reads the row as
   * it was BEFORE the first, the classification proposal is fingerprinted
   * against one row and applied against another -- so the conflict guard
   * refuses it, the row still reads "Needs Review", the prerequisite check
   * re-fires, and the pair repeats forever.
   */
  it("commits the classification against the row the significance decision produced", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });

    const significance = await commitHazardReviewDecision({
      session: sessionFor(["RAW-1"]),
      card: reviewCard("RAW-1"),
      action: "yes",
      proposal: significanceProposal("Yes"),
    }, harness.ports);
    expect(significance.outcome).toBe(DECISION_OUTCOME.APPLIED);

    // The follow-up starts from the committed row, exactly as the cascade does.
    const followUp = recordHazardReviewProposal({
      session: sessionFor(["RAW-1"], { reviewTarget: "safetyClassification" }),
      proposal: classificationProposal("Safety — Direct"),
      currentRowSnapshot: [...significance.record.nextRow],
    }, harness.ports).session;

    const classification = await commitHazardReviewDecision({
      session: followUp,
      card: reviewCard("RAW-1"),
      action: "classificationDirect",
      proposal: classificationProposal("Safety — Direct"),
    }, harness.ports);

    expect(classification.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.valueOf("RAW-1", "Safety Classification")).toBe("Safety — Direct");
    // The significance decision it was built on is still standing.
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
  });

  it("refuses the classification when it was prepared against the pre-decision row", async () => {
    const harness = createHazardReviewHarness({ rows: ["RAW-1"] });
    const staleSnapshot = [...harness.state.summary[1]];

    await commitHazardReviewDecision({
      session: sessionFor(["RAW-1"]), card: reviewCard("RAW-1"),
      action: "yes", proposal: significanceProposal("Yes"),
    }, harness.ports);

    // A follow-up built from the workspace's stale copy rather than the commit.
    const followUp = recordHazardReviewProposal({
      session: sessionFor(["RAW-1"], { reviewTarget: "safetyClassification" }),
      proposal: classificationProposal("Safety — Direct"),
      currentRowSnapshot: staleSnapshot,
    }, harness.ports).session;

    const classification = await commitHazardReviewDecision({
      session: followUp, card: reviewCard("RAW-1"),
      action: "classificationDirect", proposal: classificationProposal("Safety — Direct"),
    }, harness.ports);

    // Refusing is correct: applying it would have written over the significance
    // decision. The guard is what turned a silent revert into a visible stop.
    expect(classification.outcome).toBe(DECISION_OUTCOME.CONFLICT);
    expect(harness.valueOf("RAW-1", "Safety Significant")).toBe("Yes");
  });
});

describe("a proposal that failed validation", () => {
  const failed = {
    valid: false,
    evidenceGap: "Provider update omitted the required normalizedDecision.",
    errors: ["Provider update omitted the required normalizedDecision"],
    proposal: { normalizedDecision: "Needs Review", governedDecision: null },
  };

  it("is stored with its verdict, not as a passing one", () => {
    const harness = createHazardReviewHarness();
    const recorded = recordHazardReviewProposal({
      session: sessionFor(["RAW-1"]),
      proposal: failed.proposal,
      currentRowSnapshot: [...harness.state.summary[1]],
      valid: failed.valid,
      evidenceGap: failed.evidenceGap,
      errors: failed.errors,
    }, harness.ports).session;

    expect(recorded.proposalValidation).toMatchObject({ valid: false, evidenceGap: failed.evidenceGap });
  });

  it("comes back from a resume still marked as failed", () => {
    const harness = createHazardReviewHarness();
    const recorded = recordHazardReviewProposal({
      session: sessionFor(["RAW-1"]),
      proposal: failed.proposal,
      currentRowSnapshot: [...harness.state.summary[1]],
      valid: false,
      evidenceGap: failed.evidenceGap,
      errors: failed.errors,
    }, harness.ports).session;

    // Resume used to assert `{ valid: true }`, so a failed safety assessment
    // was presented as having passed the configured checks.
    const verdict = storedProposalVerdict(recorded);

    expect(verdict.valid).toBe(false);
    expect(verdict.evidenceGap).toBe(failed.evidenceGap);
    expect(verdict.proposal).toBe(failed.proposal);
  });

  it("still reports a passing proposal as valid", () => {
    const harness = createHazardReviewHarness();
    const recorded = recordHazardReviewProposal({
      session: sessionFor(["RAW-1"]),
      proposal: significanceProposal("No"),
      currentRowSnapshot: [...harness.state.summary[1]],
      valid: true,
      evidenceGap: "",
      errors: [],
    }, harness.ports).session;

    expect(storedProposalVerdict(recorded).valid).toBe(true);
  });

  it("treats a session with no recorded verdict as valid, for sessions saved before this", () => {
    expect(storedProposalVerdict({ proposal: significanceProposal("Yes") }).valid).toBe(true);
  });
});
