import {
  createReviewItemsFromGeneratedTable,
  createVibeReviewDecisionEvidence,
  createVibeReviewSessionEvidence,
  mergeVibeReviewEvidenceItems,
} from "./reviewUtils";
import { REVIEW_LIFECYCLE_STATES, REVIEW_STATUSES, REVIEW_UNIT_TYPES } from "./reviewTypes";

test("captures a hazard vibe-review decision against its source artifact row", () => {
  const evidence = createVibeReviewDecisionEvidence({
    domain: "hazard-analysis",
    projectId: "project-1",
    sessionId: "session-1",
    threadId: "thread-1",
    scopeLabel: "Safety Significance = Needs Review",
    rowId: "RAW-123",
    rowIndex: 4,
    label: "Detect obstacle → Obstacle state → Plan motion",
    action: "accept",
    decision: "Yes",
    beforeRow: ["RAW-123", "Needs Review"],
    afterRow: ["RAW-123", "Yes"],
    columns: ["Raw Analysis Row ID", "Safety Significant"],
    rationale: "The documented path reaches physical harm.",
    ai: { provider: "openai", model: "gpt-test", effort: "medium" },
    timestamp: "2026-09-14T12:00:00.000Z",
  });

  expect(evidence.artifactId).toBe("hazard-summary:project-1:row:RAW-123");
  expect(evidence.projectId).toBe("project-1");
  expect(evidence.status).toBe(REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS);
  expect(evidence.reviewState).toBe(REVIEW_LIFECYCLE_STATES.CLOSED);
  expect(evidence.currentContent.row).toEqual(["RAW-123", "Yes"]);
  expect(evidence.traceLinks).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "table_row", rowId: "RAW-123", rowIndex: 4 }),
    expect.objectContaining({ type: "collaborator_thread", sessionId: "session-1" }),
  ]));
  expect(evidence.history[0]).toEqual(expect.objectContaining({
    action: "collaborator_vibe_review_decision",
    reviewAction: "accept",
    before: ["RAW-123", "Needs Review"],
    after: ["RAW-123", "Yes"],
    model: "gpt-test",
  }));
});

test("merges Collaborator evidence into an existing generated row and appends history", () => {
  const [generated] = createReviewItemsFromGeneratedTable({
    sourceFeature: "AI Hazard Analysis",
    sourceMethod: "STPA",
    sourceRunId: "run-1",
    artifactType: "hazard_summary_table",
    artifactId: "hazard-summary:project-1",
    projectId: "project-1",
    columns: ["Raw Analysis Row ID", "Safety Significant"],
    rows: [["RAW-123", "Needs Review"]],
  });
  const decision = createVibeReviewDecisionEvidence({
    domain: "hazard-analysis",
    projectId: "project-1",
    sessionId: "session-1",
    rowId: "RAW-123",
    rowIndex: 0,
    action: "no",
    decision: "No",
    beforeRow: ["RAW-123", "Needs Review"],
    afterRow: ["RAW-123", "No"],
    columns: ["Raw Analysis Row ID", "Safety Significant"],
  });

  const merged = mergeVibeReviewEvidenceItems([generated], decision);

  expect(merged.items).toHaveLength(1);
  expect(merged.recorded.id).toBe(generated.id);
  expect(merged.recorded.sourceRunId).toBe("run-1");
  expect(merged.recorded.originalContent).toEqual(generated.originalContent);
  expect(merged.recorded.currentContent.row).toEqual(["RAW-123", "No"]);
  expect(merged.recorded.history).toHaveLength(1);
});

test("captures a traceable Collaborator session summary", () => {
  const evidence = createVibeReviewSessionEvidence({
    domain: "functional-decomposition",
    outcome: "completed",
    session: {
      id: "session-2",
      projectId: "project-2",
      threadId: "thread-2",
      scopeLabel: "Lifecycle Phase = Needs Review",
      workspaceType: "code-based-architecture",
      repoId: "repo-7",
      queue: ["ROW-1", "ROW-2"],
      cursor: 2,
      decisions: [{ rowId: "ROW-1", decision: "Revise" }, { rowId: "ROW-2", decision: "Keep" }],
      skips: [],
      failures: [],
      missingRows: [],
      ai: { provider: "anthropic", model: "claude-test" },
      createdAt: "2026-09-14T12:00:00.000Z",
      updatedAt: "2026-09-14T12:05:00.000Z",
    },
    summary: { total: 2, reviewed: 2, remaining: 0 },
  });

  expect(evidence.reviewUnitType).toBe(REVIEW_UNIT_TYPES.REVIEW_SESSION);
  expect(evidence.status).toBe(REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS);
  expect(evidence.reviewState).toBe(REVIEW_LIFECYCLE_STATES.CLOSED);
  expect(evidence.currentContent).toEqual(expect.objectContaining({
    outcome: "completed",
    repoId: "repo-7",
    queueSize: 2,
    summary: { total: 2, reviewed: 2, remaining: 0 },
  }));
  expect(evidence.traceLinks).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "reviewed_artifact", projectId: "project-2", repoId: "repo-7" }),
  ]));
});
