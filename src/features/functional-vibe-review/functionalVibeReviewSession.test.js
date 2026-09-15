import {
  appendFunctionalVibeReviewAudit,
  createFunctionalVibeReviewSession,
  currentFunctionalVibeReviewRowId,
  FUNCTIONAL_VIBE_REVIEW_STATES,
  loadFunctionalVibeReviewAudit,
  loadFunctionalVibeReviewSession,
  parseFunctionalVibeReviewAction,
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

test("undo rewinds and sessions persist without embedding project rows", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, value) { this.data[k] = value; } };
  let session = createFunctionalVibeReviewSession({ projectId: "p", threadId: "t", queue: ["a"] });
  session = transitionFunctionalVibeReviewSession(session, { type: "decision", record: { rowId: "a", decision: "Remove", previousRow: { fromFunction: "A" } } });
  session = transitionFunctionalVibeReviewSession(session, { type: "undo" });
  expect(currentFunctionalVibeReviewRowId(session)).toBe("a");
  saveFunctionalVibeReviewSession(session, storage);
  expect(loadFunctionalVibeReviewSession("p", "t", storage).queue).toEqual(["a"]);
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
