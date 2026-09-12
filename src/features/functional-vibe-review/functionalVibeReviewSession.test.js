import {
  createFunctionalVibeReviewSession,
  currentFunctionalVibeReviewRowId,
  FUNCTIONAL_VIBE_REVIEW_STATES,
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
  expect(parseFunctionalVibeReviewAction("Why is this interface directed toward planning?")).toBeNull();
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

