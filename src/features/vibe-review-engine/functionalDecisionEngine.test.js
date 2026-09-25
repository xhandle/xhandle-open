/**
 * Lifecycle tests for the functional-decomposition review, mirroring the hazard
 * suite. Both domains now run the same commit core, so these also serve as
 * evidence that the shared skeleton behaves identically for a very different
 * artifact shape.
 */

import {
  DECISION_OUTCOME,
  UNDO_OUTCOME,
  commitFunctionalReviewDecision,
  recordFunctionalReviewProposal,
  skipFunctionalReviewItem,
  stopFunctionalReview,
  undoFunctionalReviewDecision,
} from "./functionalDecisionEngine";
import { createFunctionalReviewHarness, functionalCard } from "./testHarness";
import {
  FUNCTIONAL_VIBE_REVIEW_STATES,
  createFunctionalVibeReviewSession,
} from "../functional-vibe-review/functionalVibeReviewSession";

const sessionFor = (queue, overrides = {}) => ({
  ...createFunctionalVibeReviewSession({
    projectId: "P1",
    threadId: "T1",
    queue,
    reviewerName: "Reviewer",
  }),
  ...overrides,
});

const reviseProposal = (proposedRow, rationale = "Clarified the interface.") => ({
  proposedRow,
  rationale,
});

describe("committing a functional decision", () => {
  it("keeps a row and advances the cursor exactly once", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "keep",
      decision: "Keep",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.decisions).toHaveLength(1);
    expect(harness.rowIds()).toEqual(["FR-1", "FR-2"]);
    expect(harness.state.applyCalls).toBe(1);
  });

  it("applies a revision to the reviewed row", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "accept",
      decision: "Revise",
      proposal: reviseProposal({ controlAction: "Report calibrated speed" }),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.rowOf("FR-1").controlAction).toBe("Report calibrated speed");
    expect(outcome.record.decision).toBe("Revise");
  });

  it("removes a row and records no post-decision state for it", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "remove",
      decision: "Remove",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.rowIds()).toEqual(["FR-2"]);
    expect(outcome.record.nextRow).toBeNull();
    expect(outcome.session.cursor).toBe(1);
  });

  it("propagates a subsystem reallocation atomically to sibling rows", async () => {
    const harness = createFunctionalReviewHarness({
      rows: [
        { _functionalVibeReviewId: "FR-1", subsystem: "Control", fromFunction: "Control traction", controlAction: "Command torque", toFunction: "Drive wheels" },
        { _functionalVibeReviewId: "FR-2", subsystem: "Control", fromFunction: "Control traction", controlAction: "Report status", toFunction: "Log health" },
      ],
    });

    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "accept",
      decision: "Revise",
      proposal: reviseProposal({ subsystem: "Powertrain" }),
    }, harness.ports);

    // One function has one owning subsystem, so both rows move together.
    expect(harness.rowOf("FR-1").subsystem).toBe("Powertrain");
    expect(harness.rowOf("FR-2").subsystem).toBe("Powertrain");
    expect(outcome.record.affectedRows).toHaveLength(1);
    expect(outcome.record.affectedRows[0]).toMatchObject({ rowId: "FR-2", propagated: true });
  });

  it("advances the row snapshot so a rehydrated project can be rebuilt", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "remove",
      decision: "Remove",
      proposal: {},
    }, harness.ports);

    expect(outcome.session.rowSnapshot.map((entry) => entry.rowId)).toEqual(["FR-2"]);
  });

  it("completes the review when the last queued item is decided", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1"]),
      card: functionalCard("FR-1"),
      action: "keep",
      decision: "Keep",
      proposal: {},
    }, harness.ports);

    expect(outcome.completed).toBe(true);
    expect(outcome.session.state).toBe(FUNCTIONAL_VIBE_REVIEW_STATES.COMPLETED);
  });
});

describe("functional failure handling", () => {
  it("leaves the rows and the cursor untouched when the write throws", async () => {
    const harness = createFunctionalReviewHarness();
    harness.state.faults.write = new Error("browser storage is unavailable");

    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "remove",
      decision: "Remove",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(outcome.committed).toBe(false);
    expect(harness.rowIds()).toEqual(["FR-1", "FR-2"]);
    expect(outcome.session.cursor).toBe(0);
  });

  it("refuses a Revise with no proposed row", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1"]),
      card: functionalCard("FR-1"),
      action: "accept",
      decision: "Revise",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(outcome.error).toContain("complete revised row");
    expect(harness.state.applyCalls).toBe(0);
  });

  it("refuses an unrecognised decision", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1"]),
      card: functionalCard("FR-1"),
      action: "accept",
      decision: "Maybe",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(harness.state.applyCalls).toBe(0);
  });

  it("advances past a row that vanished mid-review", async () => {
    const harness = createFunctionalReviewHarness({
      rows: [{ _functionalVibeReviewId: "FR-2", subsystem: "Control", fromFunction: "Control traction" }],
    });

    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "keep",
      decision: "Keep",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.SOURCE_ROW_MISSING);
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.missingRows).toHaveLength(1);
    expect(outcome.session.decisions).toHaveLength(0);
  });

  it.each([
    ["audit", "the audit log is full"],
    ["capture", "evidence capture failed"],
  ])("keeps a committed decision when %s fails", async (seam, message) => {
    const harness = createFunctionalReviewHarness();
    harness.state.faults[seam] = new Error(message);

    const outcome = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      action: "remove",
      decision: "Remove",
      proposal: {},
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(outcome.bookkeepingComplete).toBe(false);
    expect(outcome.session.cursor).toBe(1);
    expect(harness.rowIds()).toEqual(["FR-2"]);
  });

  it("does not re-apply a decision when the same card is submitted twice", async () => {
    const harness = createFunctionalReviewHarness();
    const card = functionalCard("FR-1");
    const first = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]), card, action: "remove", decision: "Remove", proposal: {},
    }, harness.ports);

    const second = await commitFunctionalReviewDecision({
      session: first.session, card, action: "remove", decision: "Remove", proposal: {},
    }, harness.ports);

    expect(second.outcome).toBe(DECISION_OUTCOME.COMMIT_FAILED);
    expect(second.stale).toBe(true);
    expect(harness.state.applyCalls).toBe(1);
    expect(harness.rowIds()).toEqual(["FR-2"]);
  });
});

describe("undoing a functional decision", () => {
  it("restores a removed row at its original position", async () => {
    const harness = createFunctionalReviewHarness();
    const applied = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]), card: functionalCard("FR-1"),
      action: "remove", decision: "Remove", proposal: {},
    }, harness.ports);
    expect(harness.rowIds()).toEqual(["FR-2"]);

    const outcome = await undoFunctionalReviewDecision({ session: applied.session }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.RESTORED);
    expect(harness.rowIds()).toEqual(["FR-1", "FR-2"]);
    expect(outcome.session.cursor).toBe(0);
    expect(outcome.session.decisions).toHaveLength(0);
  });

  it("reverses a propagated subsystem reallocation on every affected row", async () => {
    const harness = createFunctionalReviewHarness({
      rows: [
        { _functionalVibeReviewId: "FR-1", subsystem: "Control", fromFunction: "Control traction", controlAction: "Command torque" },
        { _functionalVibeReviewId: "FR-2", subsystem: "Control", fromFunction: "Control traction", controlAction: "Report status" },
      ],
    });
    const applied = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]), card: functionalCard("FR-1"),
      action: "accept", decision: "Revise", proposal: reviseProposal({ subsystem: "Powertrain" }),
    }, harness.ports);
    expect(harness.rowOf("FR-2").subsystem).toBe("Powertrain");

    await undoFunctionalReviewDecision({ session: applied.session }, harness.ports);

    expect(harness.rowOf("FR-1").subsystem).toBe("Control");
    expect(harness.rowOf("FR-2").subsystem).toBe("Control");
  });

  it("keeps the decision intact when the restore itself fails", async () => {
    const harness = createFunctionalReviewHarness();
    const applied = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]), card: functionalCard("FR-1"),
      action: "remove", decision: "Remove", proposal: {},
    }, harness.ports);
    harness.state.faults.undo = new Error("the decomposition is read-only");

    const outcome = await undoFunctionalReviewDecision({ session: applied.session }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.RESTORE_FAILED);
    expect(harness.rowIds()).toEqual(["FR-2"]);
    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.decisions).toHaveLength(1);
  });

  it("refuses when there is nothing to undo", async () => {
    const harness = createFunctionalReviewHarness();
    const outcome = await undoFunctionalReviewDecision({ session: sessionFor(["FR-1"]) }, harness.ports);

    expect(outcome.outcome).toBe(UNDO_OUTCOME.NOTHING_TO_UNDO);
    expect(harness.state.undoCalls).toBe(0);
  });

  it("adds a compensating audit record instead of deleting the original", async () => {
    const harness = createFunctionalReviewHarness();
    const applied = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]), card: functionalCard("FR-1"),
      action: "keep", decision: "Keep", proposal: {},
    }, harness.ports);
    await undoFunctionalReviewDecision({ session: applied.session }, harness.ports);

    expect(harness.state.audit).toHaveLength(2);
    expect(harness.state.audit[1].action).toBe("undo");
  });
});

describe("functional skipping and stopping", () => {
  it("advances past a skipped item without touching the rows", () => {
    const harness = createFunctionalReviewHarness();
    const outcome = skipFunctionalReviewItem({
      session: sessionFor(["FR-1", "FR-2"]),
      card: functionalCard("FR-1"),
      reason: "Needs the owning subsystem confirmed.",
    }, harness.ports);

    expect(outcome.session.cursor).toBe(1);
    expect(outcome.session.skips[0].reason).toBe("Needs the owning subsystem confirmed.");
    expect(harness.rowIds()).toEqual(["FR-1", "FR-2"]);
    expect(harness.state.applyCalls).toBe(0);
  });

  it("keeps decisions already applied when the review is stopped early", async () => {
    const harness = createFunctionalReviewHarness();
    const applied = await commitFunctionalReviewDecision({
      session: sessionFor(["FR-1", "FR-2"]), card: functionalCard("FR-1"),
      action: "remove", decision: "Remove", proposal: {},
    }, harness.ports);

    const outcome = stopFunctionalReview({ session: applied.session }, harness.ports);

    expect(outcome.session.state).toBe(FUNCTIONAL_VIBE_REVIEW_STATES.CANCELLED);
    expect(outcome.session.decisions).toHaveLength(1);
    expect(harness.rowIds()).toEqual(["FR-2"]);
  });
});

describe("a functional row that changed under an open proposal", () => {
  const proposedOn = (harness, session, rowId = "FR-1") => recordFunctionalReviewProposal({
    session,
    proposal: reviseProposal({ controlAction: "Report calibrated speed" }),
    currentRowSnapshot: { ...harness.rowOf(rowId) },
  }, harness.ports).session;

  it("refuses the decision and leaves the other edit in place", async () => {
    const harness = createFunctionalReviewHarness();
    const proposed = proposedOn(harness, sessionFor(["FR-1", "FR-2"]));

    // Someone edits the row after the proposal was prepared.
    harness.rowOf("FR-1").toFunction = "Control braking";

    const outcome = await commitFunctionalReviewDecision({
      session: proposed, card: functionalCard("FR-1"), action: "accept",
      decision: "Revise", proposal: reviseProposal({ controlAction: "Report calibrated speed" }),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.CONFLICT);
    expect(outcome.committed).toBe(false);
    expect(harness.rowOf("FR-1").toFunction).toBe("Control braking");
    expect(harness.rowOf("FR-1").controlAction).toBe("Report speed");
    expect(outcome.session.cursor).toBe(0);
  });

  it("ignores review metadata stamped by an earlier decision", async () => {
    const harness = createFunctionalReviewHarness();
    const proposed = proposedOn(harness, sessionFor(["FR-1", "FR-2"]));

    // This is bookkeeping the reviewer never saw, not a change to the row.
    harness.rowOf("FR-1")._functionalVibeReview = { decision: "Keep", reviewedAt: "2026-09-20" };

    const outcome = await commitFunctionalReviewDecision({
      session: proposed, card: functionalCard("FR-1"), action: "accept",
      decision: "Revise", proposal: reviseProposal({ controlAction: "Report calibrated speed" }),
    }, harness.ports);

    expect(outcome.outcome).toBe(DECISION_OUTCOME.APPLIED);
    expect(harness.rowOf("FR-1").controlAction).toBe("Report calibrated speed");
  });
});
