import {
  appendFunctionalVibeReviewAudit,
  createFunctionalVibeReviewSession,
  currentFunctionalVibeReviewRowId,
  FUNCTIONAL_VIBE_REVIEW_STATES,
  loadFunctionalVibeReviewAudit,
  loadFunctionalVibeReviewSession,
  parseFunctionalVibeReviewAction,
  recoverFunctionalVibeReviewRows,
  saveFunctionalVibeReviewSession,
  summarizeFunctionalVibeReviewSession,
  transitionFunctionalVibeReviewSession,
} from "./functionalVibeReviewSession";

test("reviews a stable functional queue exactly once", () => {
  let session = createFunctionalVibeReviewSession({ projectId: "p", threadId: "t", queue: ["a", "b", "a"] });
  expect(session.queue).toEqual(["a", "b"]);
  session = transitionFunctionalVibeReviewSession(session, { type: "proposal", proposal: { decision: "Keep" } });
  expect(session.state).toBe(FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING);
  session = transitionFunctionalVibeReviewSession(session, { type: "decision", record: { rowId: "a", decision: "Keep" } });
  expect(currentFunctionalVibeReviewRowId(session)).toBe("b");
  session = transitionFunctionalVibeReviewSession(session, { type: "decision", record: { rowId: "b", decision: "Revise" } });
  expect(session.state).toBe(FUNCTIONAL_VIBE_REVIEW_STATES.COMPLETED);
  expect(summarizeFunctionalVibeReviewSession(session)).toMatchObject({ total: 2, kept: 1, revised: 1, remaining: 0 });
});

test("parses functional actions but leaves engineering questions alone", () => {
  expect(parseFunctionalVibeReviewAction("keep as is")).toBe("keep");
  expect(parseFunctionalVibeReviewAction("apply the revision")).toBe("revise");
  expect(parseFunctionalVibeReviewAction("Continue review")).toBe("resume");
  expect(parseFunctionalVibeReviewAction("Why is this interface directed toward planning?")).toBeNull();
});

test("retains explicitly targeted review columns in the session", () => {
  const session = createFunctionalVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["a"],
    scopeLabel: "Lifecycle Phase = Needs Review",
    reviewFields: ["lifecyclePhase"],
  });
  expect(session.reviewFields).toEqual(["lifecyclePhase"]);
});

test("persists the user-supplied review name", () => {
  const session = createFunctionalVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["a"],
    reviewName: "Localization interface review",
  });
  expect(session.reviewName).toBe("Localization interface review");
});

test("retains the original reviewer instructions after resolving a scope choice", () => {
  const session = createFunctionalVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["a"],
    scopeLabel: "Hazard Analysis Eligibility = Include",
    reviewInstructions: "Consolidate low-level tensor and helper calls into operational transformations.",
  });
  expect(session.reviewInstructions).toContain("Consolidate low-level tensor");
});

test("undo rewinds and sessions persist with a recoverable project-row snapshot", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, value) { this.data[k] = value; } };
  let session = createFunctionalVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["a"],
    rowSnapshot: [{ rowId: "a", rowIndex: 0, row: { fromFunction: "A", controlAction: "sends", toFunction: "B" } }],
  });
  session = transitionFunctionalVibeReviewSession(session, { type: "decision", record: { rowId: "a", decision: "Remove", previousRow: { fromFunction: "A" } } });
  session = transitionFunctionalVibeReviewSession(session, { type: "undo" });
  expect(currentFunctionalVibeReviewRowId(session)).toBe("a");
  saveFunctionalVibeReviewSession(session, storage);
  expect(loadFunctionalVibeReviewSession("p", "t", storage).queue).toEqual(["a"]);
  expect(recoverFunctionalVibeReviewRows(loadFunctionalVibeReviewSession("p", "t", storage))[0].fromFunction).toBe("A");
});

test("recovers a legacy session from proposed rows and replays accepted decisions", () => {
  const session = {
    queue: ["a", "b"],
    decisions: [{
      rowId: "a",
      decision: "Revise",
      nextRow: { fromFunction: "A", controlAction: "sends", toFunction: "B", subsystem: "Merged" },
    }],
  };
  const recovered = recoverFunctionalVibeReviewRows(session, [
    { fromFunction: "A", controlAction: "sends", toFunction: "B", subsystem: "Original" },
    { fromFunction: "B", controlAction: "returns", toFunction: "A", subsystem: "Original" },
  ]);
  expect(recovered).toHaveLength(2);
  expect(recovered[0]).toMatchObject({ _functionalVibeReviewId: "a", subsystem: "Merged" });
  expect(recovered[1]).toMatchObject({ _functionalVibeReviewId: "b", fromFunction: "B" });
});

test("persists the reviewed workspace and repository boundary", () => {
  const session = createFunctionalVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["a"],
    workspaceType: "code-based-architecture",
    repoId: "repo-1",
  });
  expect(session).toMatchObject({ workspaceType: "code-based-architecture", repoId: "repo-1" });
});

test("keeps a functional review usable when browser storage quota is exceeded", () => {
  const quotaError = Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
  const storage = {
    getItem() { return null; },
    setItem() { throw quotaError; },
  };
  const session = createFunctionalVibeReviewSession({ projectId: "quota-project", threadId: "quota-thread", queue: ["row-1"] });

  expect(() => saveFunctionalVibeReviewSession(session, storage)).not.toThrow();
  expect(loadFunctionalVibeReviewSession("quota-project", "quota-thread", storage)?.queue).toEqual(["row-1"]);

  expect(() => appendFunctionalVibeReviewAudit({ projectId: "quota-project", rowId: "row-1" }, storage)).not.toThrow();
  expect(loadFunctionalVibeReviewAudit("quota-project", storage)).toHaveLength(1);
});

test("makes an interrupted applying state retryable after reload", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, value) { this.data[k] = value; } };
  let session = createFunctionalVibeReviewSession({ projectId: "p", threadId: "t", queue: ["a"] });
  session = transitionFunctionalVibeReviewSession(session, { type: "proposal", proposal: { decision: "Keep" } });
  session = transitionFunctionalVibeReviewSession(session, { type: "applying" });
  saveFunctionalVibeReviewSession(session, storage);
  expect(loadFunctionalVibeReviewSession("p", "t", storage).state).toBe(FUNCTIONAL_VIBE_REVIEW_STATES.AWAITING);
});
