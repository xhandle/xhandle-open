jest.mock("lucide-react", () => new Proxy({}, { get: () => () => null }));

import {
  collaboratorThreadForGroup,
  isSessionOwnedVibeDecision,
  flattenReviewFolderTree,
  moveReviewFolderState,
  normalizeReviewFolderState,
  relatedReviewHistoryItems,
  renameReviewFolderState,
  renameReviewProjectState,
  reviewFolderDescendantIds,
  reviewRecordDeletionIds,
  resumableVibeReviewForGroup,
} from "./ReviewCenter";

test("keeps Collaborator decision evidence inside its named vibe-review record", () => {
  const session = {
    id: "collaborator-vibe-review-session__session-1",
    artifactType: "collaborator_vibe_review_session",
    currentContent: { sessionId: "session-1", reviewName: "AV Haulage" },
  };
  const decision = {
    id: "collaborator-vibe-review__hazard-summary__RAW-1",
    artifactType: "hazard_summary_table",
    vibeReview: { sessionId: "session-1", rowId: "RAW-1" },
  };

  expect(isSessionOwnedVibeDecision(decision, [session, decision])).toBe(true);
  expect(isSessionOwnedVibeDecision(session, [session, decision])).toBe(false);
  expect(relatedReviewHistoryItems({ artifactType: "collaborator_vibe_review_session", items: [session] }, [session, decision]))
    .toEqual([session, decision]);

  const mergedGeneratedDecision = { ...decision, id: "hazard-run__hazard-summary-table__row-1" };
  expect(isSessionOwnedVibeDecision(mergedGeneratedDecision, [session, mergedGeneratedDecision])).toBe(true);

  const legacyDecision = {
    ...mergedGeneratedDecision,
    vibeReview: null,
    traceLinks: [{ type: "collaborator_thread", sessionId: "session-1" }],
  };
  expect(isSessionOwnedVibeDecision(legacyDecision, [session, legacyDecision])).toBe(true);
});

test("Review Center exposes exact paused session navigation metadata and preserves reviewName", () => {
  const result = resumableVibeReviewForGroup({
    artifactType: "collaborator_vibe_review_session",
    projectId: "project-1",
    items: [{
      projectId: "project-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      currentContent: { sessionId: "session-1", threadId: "thread-1", domain: "hazard-analysis", outcome: "paused", workspaceType: "code-based-architecture", repoId: "repo-1", reviewName: "Operator hazards" },
    }],
  });
  expect(result).toEqual({ sessionId: "session-1", threadId: "thread-1", projectId: "project-1", domain: "hazard-analysis", workspaceType: "code-based-architecture", repoId: "repo-1", reviewName: "Operator hazards" });
});

test("completed and cancelled sessions are not resumable", () => {
  for (const outcome of ["completed", "cancelled", "stopped"]) {
    expect(resumableVibeReviewForGroup({ artifactType: "collaborator_vibe_review_session", items: [{ currentContent: { sessionId: "s", outcome } }] })).toBeNull();
  }
});

test("an actively executing review is not presented as paused", () => {
  expect(resumableVibeReviewForGroup({
    artifactType: "collaborator_vibe_review_session",
    items: [{ currentContent: { sessionId: "running", domain: "hazard-analysis", outcome: "in_progress", state: "awaiting_decision" } }],
  })).toBeNull();
});

test("a legacy review without a confirmed paused session is not resumable", () => {
  expect(resumableVibeReviewForGroup({
    artifactType: "collaborator_vibe_review_session",
    items: [{ currentContent: { sessionId: "missing", domain: "hazard-analysis", outcome: "in_progress" } }],
  })).toBeNull();
});

test("normalizes persistent review folders and removes assignments to deleted folders", () => {
  expect(normalizeReviewFolderState({
    folders: [{ id: "safety", name: "  Safety reviews  " }, { id: "invalid", name: "" }],
    assignments: { "review-1": "safety", "review-2": "missing" },
    sidebarCollapsed: true,
  })).toEqual({
    folders: [{ id: "safety", name: "Safety reviews", parentId: "" }],
    assignments: { "review-1": "safety" },
    projectNames: {},
    sidebarCollapsed: true,
  });
});

test("normalizes and traverses nested review folders", () => {
  const state = normalizeReviewFolderState({
    folders: [
      { id: "root", name: "Haulage" },
      { id: "child", name: "Hazards", parentId: "root" },
      { id: "grandchild", name: "Guide phrases", parentId: "child" },
    ],
    assignments: { review: "grandchild" },
  });

  expect(state.folders).toEqual([
    { id: "root", name: "Haulage", parentId: "" },
    { id: "child", name: "Hazards", parentId: "root" },
    { id: "grandchild", name: "Guide phrases", parentId: "child" },
  ]);
  expect(Array.from(reviewFolderDescendantIds(state.folders, "root"))).toEqual(expect.arrayContaining(["root", "child", "grandchild"]));
  expect(flattenReviewFolderTree(state.folders).map(({ folder, depth }) => [folder.id, depth])).toEqual([
    ["root", 0], ["child", 1], ["grandchild", 2],
  ]);
});

test("breaks invalid nested-folder cycles without losing folders", () => {
  const state = normalizeReviewFolderState({
    folders: [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ],
  });
  expect(state.folders.every((folder) => folder.parentId === "")).toBe(true);
});

test("moves folders between parents while preserving their subtree and review assignments", () => {
  const state = {
    folders: [
      { id: "one", name: "One", parentId: "" },
      { id: "two", name: "Two", parentId: "" },
      { id: "child", name: "Child", parentId: "one" },
    ],
    assignments: { review: "child" },
  };
  const moved = moveReviewFolderState(state, "one", "two");
  expect(moved.folders.find((folder) => folder.id === "one")?.parentId).toBe("two");
  expect(moved.folders.find((folder) => folder.id === "child")?.parentId).toBe("one");
  expect(moved.assignments.review).toBe("child");
});

test("moves a nested folder back to the root", () => {
  const moved = moveReviewFolderState({
    folders: [
      { id: "root", name: "Root", parentId: "" },
      { id: "child", name: "Child", parentId: "root" },
    ],
  }, "child", "");
  expect(moved.folders.find((folder) => folder.id === "child")?.parentId).toBe("");
});

test("rejects moving a folder into itself or one of its descendants", () => {
  const state = normalizeReviewFolderState({
    folders: [
      { id: "root", name: "Root", parentId: "" },
      { id: "child", name: "Child", parentId: "root" },
    ],
  });
  expect(moveReviewFolderState(state, "root", "root")).toEqual(state);
  expect(moveReviewFolderState(state, "root", "child")).toEqual(state);
});

test("renames a nested review folder without changing hierarchy or assignments", () => {
  expect(renameReviewFolderState({
    folders: [
      { id: "root", name: "Haulage", parentId: "" },
      { id: "child", name: "Old name", parentId: "root" },
    ],
    assignments: { review: "child" },
  }, "child", "  Guide Phrase Reviews  ")).toEqual({
    folders: [
      { id: "root", name: "Haulage", parentId: "" },
      { id: "child", name: "Guide Phrase Reviews", parentId: "root" },
    ],
    assignments: { review: "child" },
    projectNames: {},
    sidebarCollapsed: false,
  });
});

test("renames a Review Center project without changing folder organization", () => {
  expect(renameReviewProjectState({
    folders: [{ id: "folder", name: "CBA", parentId: "" }],
    assignments: { review: "folder" },
    projectNames: {},
  }, "project-1", "  Alpamayo Safety Review  ")).toEqual({
    folders: [{ id: "folder", name: "CBA", parentId: "" }],
    assignments: { review: "folder" },
    projectNames: { "project-1": "Alpamayo Safety Review" },
    sidebarCollapsed: false,
  });
});

test("exposes the exact Collaborator thread for a vibe-review record without resuming it", () => {
  expect(collaboratorThreadForGroup({
    artifactType: "collaborator_vibe_review_session",
    projectId: "project-1",
    items: [{
      projectId: "project-1",
      currentContent: { sessionId: "session-1", threadId: "thread-1", reviewName: "Lifecycle review" },
    }],
  })).toEqual({ threadId: "thread-1", sessionId: "session-1", projectId: "project-1", reviewName: "Lifecycle review" });
  expect(collaboratorThreadForGroup({ artifactType: "hazard_summary_table", items: [] })).toBeNull();
});

test("deletes only the selected review record even when related session history is displayed", () => {
  expect(reviewRecordDeletionIds({
    reviewItemIds: ["functional-row-1", "functional-row-2"],
    items: [
      { id: "functional-row-1" },
      { id: "functional-row-2" },
      { id: "related-vibe-review-session" },
    ],
  })).toEqual(["functional-row-1", "functional-row-2"]);
});
