import { createVibeReviewSession, currentVibeReviewRowId, loadVibeReviewSession, parseVibeReviewAction, saveVibeReviewSession, summarizeVibeReviewSession, transitionVibeReviewSession, VIBE_REVIEW_STATES } from "./vibeReviewSession";

test("deduplicates stable IDs and advances exactly one row per decision or skip", () => {
  let session = createVibeReviewSession({ projectId: "p", threadId: "t", queue: ["b", "a", "b"] });
  expect(session.queue).toEqual(["b", "a"]);
  session = transitionVibeReviewSession(session, { type: "proposal", proposal: { normalizedDecision: "Safety — Direct" } });
  expect(session.state).toBe(VIBE_REVIEW_STATES.AWAITING);
  session = transitionVibeReviewSession(session, { type: "decision", record: { action: "accept", newSafetySignificant: "Yes" } });
  expect(currentVibeReviewRowId(session)).toBe("a");
  session = transitionVibeReviewSession(session, { type: "skip", record: { sourceRowId: "a" } });
  expect(session.state).toBe(VIBE_REVIEW_STATES.COMPLETED);
  expect(summarizeVibeReviewSession(session)).toMatchObject({ total: 2, reviewed: 1, skipped: 1, changedToYes: 1 });
});

test("bare no explicitly maps to Mark No while questions do not advance", () => {
  expect(parseVibeReviewAction("no")).toBe("no");
  expect(parseVibeReviewAction("Do we know whether the interlock exists?")).toBeNull();
});

test("undo rewinds to the restored row and resume is an explicit action", () => {
  let session = createVibeReviewSession({ projectId: "p", threadId: "t", queue: ["row-1", "row-2"] });
  session = transitionVibeReviewSession(session, { type: "decision", record: { sourceRowId: "row-1", action: "accept" } });
  session = transitionVibeReviewSession(session, { type: "undo" });
  expect(currentVibeReviewRowId(session)).toBe("row-1");
  expect(session.state).toBe(VIBE_REVIEW_STATES.PROPOSING);
  expect(parseVibeReviewAction("resume")).toBe("resume");
});

test("persists compact sessions across remount without full row payloads", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { this.data[k] = v; } };
  const session = createVibeReviewSession({ projectId: "p", threadId: "t", queue: ["row-1"] });
  saveVibeReviewSession(session, storage);
  expect(loadVibeReviewSession("p", "t", storage).queue).toEqual(["row-1"]);
  expect(JSON.stringify(loadVibeReviewSession("p", "t", storage))).not.toContain("Function (From)");
});
