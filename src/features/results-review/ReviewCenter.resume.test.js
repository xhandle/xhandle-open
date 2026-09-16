jest.mock("lucide-react", () => new Proxy({}, { get: () => () => null }));

import { resumableVibeReviewForGroup } from "./ReviewCenter";

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
