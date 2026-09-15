export const REVIEW_STATUSES = {
  DRAFT_AI_GENERATED: "draft_ai_generated",
  APPROVED_AS_IS: "approved_as_is",
  APPROVED_WITH_MODIFICATIONS: "approved_with_modifications",
  REJECTED: "rejected",
  NEEDS_REGENERATION: "needs_regeneration",
  NEEDS_MORE_CONTEXT: "needs_more_context",
  SUPERSEDED: "superseded",
};

export const REVIEW_STATUS_LABELS = {
  [REVIEW_STATUSES.DRAFT_AI_GENERATED]: "Pending Review",
  [REVIEW_STATUSES.APPROVED_AS_IS]: "Approved",
  [REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS]: "Modified & Approved",
  [REVIEW_STATUSES.REJECTED]: "Rejected",
  [REVIEW_STATUSES.NEEDS_REGENERATION]: "Needs Regeneration",
  [REVIEW_STATUSES.NEEDS_MORE_CONTEXT]: "Needs More Context",
  [REVIEW_STATUSES.SUPERSEDED]: "Superseded",
};

// The workflow state is intentionally separate from the engineering disposition
// above. A reviewer can reopen an approved/rejected item without erasing the
// decision that was made, or close a record whose disposition is still retained.
export const REVIEW_LIFECYCLE_STATES = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  CLOSED: "closed",
  ARCHIVED: "archived",
};

export const REVIEW_LIFECYCLE_LABELS = {
  [REVIEW_LIFECYCLE_STATES.OPEN]: "Open",
  [REVIEW_LIFECYCLE_STATES.IN_PROGRESS]: "In progress",
  [REVIEW_LIFECYCLE_STATES.CLOSED]: "Closed",
  [REVIEW_LIFECYCLE_STATES.ARCHIVED]: "Archived",
};

const IN_PROGRESS_REVIEW_STATUSES = new Set([
  REVIEW_STATUSES.NEEDS_REGENERATION,
  REVIEW_STATUSES.NEEDS_MORE_CONTEXT,
]);

const CLOSED_REVIEW_STATUSES = new Set([
  REVIEW_STATUSES.APPROVED_AS_IS,
  REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS,
  REVIEW_STATUSES.REJECTED,
  REVIEW_STATUSES.SUPERSEDED,
]);

export function reviewLifecycleStateForStatus(status) {
  if (IN_PROGRESS_REVIEW_STATUSES.has(status)) return REVIEW_LIFECYCLE_STATES.IN_PROGRESS;
  if (CLOSED_REVIEW_STATUSES.has(status)) return REVIEW_LIFECYCLE_STATES.CLOSED;
  return REVIEW_LIFECYCLE_STATES.OPEN;
}

export function reviewLifecycleStateForItem(item = {}) {
  if (Object.values(REVIEW_LIFECYCLE_STATES).includes(item.reviewState)) return item.reviewState;
  return reviewLifecycleStateForStatus(item.status);
}

export const REVIEW_UNIT_TYPES = {
  TABLE_ROW: "table_row",
  TABLE_CELL: "table_cell",
  REQUIREMENT: "requirement",
  REPORT_SECTION: "report_section",
  REPORT_PARAGRAPH: "report_paragraph",
  DIAGRAM_NODE: "diagram_node",
  DIAGRAM_EDGE: "diagram_edge",
  SAFETY_CASE_CLAIM: "safety_case_claim",
  SAFETY_CASE_ARGUMENT: "safety_case_argument",
  SAFETY_CASE_EVIDENCE_LINK: "safety_case_evidence_link",
  TRACEABILITY_LINK: "traceability_link",
  REVIEW_SESSION: "review_session",
};

export const RISK_IMPACT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
