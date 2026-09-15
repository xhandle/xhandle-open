import React from "react";
import { createRoot } from "react-dom/client";
import ReviewActivityHistoryModal, {
  buildReadableEvidenceDiff,
  buildReviewActivityHistory,
  summarizeReviewActivityHistory,
} from "./ReviewActivityHistoryModal";
import { REVIEW_LIFECYCLE_STATES, REVIEW_UNIT_TYPES } from "./reviewTypes";

const { act } = React;
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

const rowItem = {
  id: "row-review",
  artifactType: "hazard_summary_table",
  artifactId: "hazard-summary:project-1:row:RAW-1",
  projectId: "project-1",
  reviewUnitType: REVIEW_UNIT_TYPES.TABLE_ROW,
  sourceRunId: "run-1",
  sourceFeature: "AI Hazard Analysis",
  sourceMethod: "STPA",
  originalContent: { rowIndex: 0, rowId: "RAW-1", columns: ["Safety Significance"], row: ["Needs Review"] },
  currentContent: { rowIndex: 0, rowId: "RAW-1", columns: ["Safety Significance"], row: ["Yes"] },
  createdAt: "2026-09-14T12:00:00.000Z",
  history: [{
    id: "decision-1",
    action: "collaborator_vibe_review_decision",
    reviewAction: "accept",
    decision: "Yes",
    at: "2026-09-14T12:05:00.000Z",
    rowId: "RAW-1",
    rowIndex: 0,
    label: "Sense → Obstacle state → Plan",
    rationale: "The causal path reaches physical harm.",
    provider: "openai",
    model: "gpt-test",
    before: ["Needs Review"],
    after: ["Yes"],
    traceUri: "xhandle://hazard-row/RAW-1",
  }],
  traceLinks: [{ type: "table_row", rowIndex: 0, rowId: "RAW-1" }],
};

const sessionItem = {
  id: "session-review",
  artifactType: "collaborator_vibe_review_session",
  artifactId: "collaborator-vibe-review-session:project-1:hazard-analysis:row:session-1",
  projectId: "project-1",
  reviewUnitType: REVIEW_UNIT_TYPES.REVIEW_SESSION,
  currentContent: { sessionId: "session-1", domain: "hazard-analysis", scope: "Needs Review rows", ai: { provider: "openai", model: "gpt-test" } },
  history: [{ id: "session-history", action: "collaborator_vibe_review_session", outcome: "completed", at: "2026-09-14T12:06:00.000Z", summary: { reviewed: 1, remaining: 0 } }],
};

test("builds a chronological QA history with row decisions, sessions, and the source baseline", () => {
  const activities = buildReviewActivityHistory([rowItem, sessionItem]);
  const summary = summarizeReviewActivityHistory([rowItem, sessionItem], activities);

  expect(activities.map((activity) => activity.kind)).toEqual(["session", "decision", "baseline"]);
  expect(summary).toEqual(expect.objectContaining({
    activityCount: 2,
    decisionCount: 1,
    reviewedRowCount: 1,
    sessionCount: 1,
    acceptedProposalCount: 1,
    traceCoverage: 100,
  }));
});

test("builds a human-readable field comparison for row evidence", () => {
  const comparison = buildReadableEvidenceDiff(["Needs Review", "old rationale"], ["Yes", "updated rationale"], {
    currentContent: { columns: ["Safety Significance", "Safety Rationale"] },
  });

  expect(comparison.changed).toEqual([
    expect.objectContaining({ field: "Safety Significance", beforeText: "Needs Review", afterText: "Yes" }),
    expect.objectContaining({ field: "Safety Rationale", beforeText: "old rationale", afterText: "updated rationale" }),
  ]);
});

test("records workflow-state changes without counting them as engineering decisions", () => {
  const itemWithStateChange = {
    ...rowItem,
    history: [...rowItem.history, {
      id: "state-1",
      action: "review_state_changed",
      previousReviewState: REVIEW_LIFECYCLE_STATES.OPEN,
      reviewState: REVIEW_LIFECYCLE_STATES.CLOSED,
      at: "2026-09-14T12:07:00.000Z",
    }],
  };
  const activities = buildReviewActivityHistory([itemWithStateChange]);
  const summary = summarizeReviewActivityHistory([itemWithStateChange], activities);

  expect(activities.some((activity) => activity.kind === "state")).toBe(true);
  expect(summary.activityCount).toBe(2);
  expect(summary.decisionCount).toBe(1);
});

test("renders readable history and allows the review workflow state to be changed", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = jest.fn();
  const onOpenSource = jest.fn();
  const onChangeReviewState = jest.fn().mockResolvedValue([]);

  try {
    act(() => root.render(
      <ReviewActivityHistoryModal
        record={{ projectName: "Door Project", materialType: "Hazard Analysis Summary", artifactRoot: "hazard-summary:project-1", items: [rowItem, sessionItem] }}
        onClose={onClose}
        onOpenSource={onOpenSource}
        onChangeReviewState={onChangeReviewState}
      />
    ));

    expect(host.textContent).toContain("Review Activity History");
    expect(host.textContent).toContain("Quality assurance summary");
    expect(host.textContent).toContain("The causal path reaches physical harm.");
    expect(host.textContent).toContain("Before / after evidence");
    expect(host.textContent).toContain("Safety Significance");
    expect(host.textContent).not.toContain('["Needs Review"]');

    const stateSelect = host.querySelector('select[aria-label="Review state"]');
    expect(Array.from(stateSelect.options).map((option) => option.value)).toContain(REVIEW_LIFECYCLE_STATES.ARCHIVED);
    await act(async () => {
      stateSelect.value = REVIEW_LIFECYCLE_STATES.IN_PROGRESS;
      stateSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChangeReviewState).toHaveBeenCalledWith(REVIEW_LIFECYCLE_STATES.IN_PROGRESS);

    const sourceButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent.includes("Jump to reviewed source"));
    act(() => sourceButton.click());
    expect(onOpenSource).toHaveBeenCalledWith(rowItem);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
