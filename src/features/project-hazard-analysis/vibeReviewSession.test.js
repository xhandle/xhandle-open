import { appendVibeReviewAudit, createVibeReviewSession, currentVibeReviewRowId, loadVibeReviewAudit, loadVibeReviewSession, parseVibeReviewAction, saveVibeReviewSession, summarizeVibeReviewSession, transitionVibeReviewSession, VIBE_REVIEW_STATES } from "./vibeReviewSession";

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

test("retains the reviewed hazard column so actions cannot mutate a different field", () => {
  const session = createVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["row-1"],
    reviewTarget: "guidePhraseApplicable",
  });
  expect(session.reviewTarget).toBe("guidePhraseApplicable");
});

test("persists the user-supplied review name", () => {
  const session = createVibeReviewSession({
    projectId: "p",
    threadId: "t",
    queue: ["row-1"],
    reviewName: "Intersection guide-phrase review",
  });
  expect(session.reviewName).toBe("Intersection guide-phrase review");
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

test("pause persists the complete cursor, proposal, progress, and identity without advancing", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { this.data[k] = v; } };
  let session = createVibeReviewSession({ projectId: "p", threadId: "t", queue: ["r1", "r2"], reviewName: "Named", workspaceType: "code-based-architecture", repoId: "repo", sourceRunId: "run" });
  session = transitionVibeReviewSession(session, { type: "proposal", proposal: { normalizedDecision: "Safety — Direct" }, currentRowSnapshot: ["r1", "Yes"] });
  session = { ...session, decisions: [{ sourceRowId: "prior" }], skips: [{ sourceRowId: "skip" }], failures: [{ sourceRowId: "fail" }] };
  const paused = transitionVibeReviewSession(session, { type: "pause" });
  saveVibeReviewSession(paused, storage);
  expect(loadVibeReviewSession("p", "t", storage)).toMatchObject({ id: session.id, projectId: "p", threadId: "t", queue: ["r1", "r2"], cursor: 0, state: "paused", proposal: session.proposal, currentRowSnapshot: ["r1", "Yes"], reviewName: "Named", repoId: "repo", sourceRunId: "run", decisions: session.decisions, skips: session.skips, failures: session.failures });
});

test("legacy active-looking persisted sessions load as paused and never auto-resume", () => {
  const legacy = { id: "old", projectId: "p", threadId: "t", queue: ["r1"], cursor: 0, state: "awaiting_decision", proposal: { normalizedDecision: "Safety — Direct" } };
  const storage = { getItem: () => JSON.stringify({ "p:t": legacy }), setItem: jest.fn() };
  expect(loadVibeReviewSession("p", "t", storage)).toMatchObject({ id: "old", state: "paused", recoveredAfterRestart: true, proposal: legacy.proposal });
  expect(storage.setItem).not.toHaveBeenCalled();
});

test("preserves Code-Based Architecture run identity across a review session", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { this.data[k] = v; } };
  const session = createVibeReviewSession({
    projectId: "cba-project",
    threadId: "thread",
    queue: ["RAW-CBA-1"],
    workspaceType: "code-based-architecture",
    sourceRunId: "hazard-run-7",
    repoId: "repo-3",
  });

  saveVibeReviewSession(session, storage);

  expect(loadVibeReviewSession("cba-project", "thread", storage)).toMatchObject({
    workspaceType: "code-based-architecture",
    sourceRunId: "hazard-run-7",
    repoId: "repo-3",
  });
});

test("keeps an active review usable when browser storage quota is exhausted", () => {
  const quotaLimitedStorage = {
    getItem() { return null; },
    setItem() { throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" }); },
  };
  const session = createVibeReviewSession({
    projectId: "quota-project",
    threadId: "quota-thread",
    queue: ["RAW-QUOTA-1"],
    workspaceType: "code-based-architecture",
  });

  expect(() => saveVibeReviewSession(session, quotaLimitedStorage)).not.toThrow();
  expect(loadVibeReviewSession("quota-project", "quota-thread", quotaLimitedStorage)).toMatchObject({
    queue: ["RAW-QUOTA-1"],
    workspaceType: "code-based-architecture",
  });

  expect(() => appendVibeReviewAudit({ projectId: "quota-project", sourceRowId: "RAW-QUOTA-1" }, quotaLimitedStorage)).not.toThrow();
  expect(loadVibeReviewAudit("quota-project", quotaLimitedStorage)).toEqual([
    expect.objectContaining({ sourceRowId: "RAW-QUOTA-1" }),
  ]);
});

test("does not evict unfinished reviews when the session history exceeds its terminal retention limit", () => {
  const storage = { data: {}, getItem(key) { return this.data[key] || null; }, setItem(key, value) { this.data[key] = value; } };
  const protectedSession = createVibeReviewSession({ projectId: "protected-project", threadId: "protected-thread", queue: ["RAW-1"] });
  saveVibeReviewSession(protectedSession, storage);
  for (let index = 0; index < 20; index += 1) {
    let session = createVibeReviewSession({ projectId: `terminal-${index}`, threadId: `thread-${index}`, queue: ["RAW-1"] });
    session = transitionVibeReviewSession(session, { type: "stop" });
    saveVibeReviewSession(session, storage);
  }
  expect(loadVibeReviewSession("protected-project", "protected-thread", storage)).toMatchObject({ state: VIBE_REVIEW_STATES.PROPOSING });
});
