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
};

export const RISK_IMPACT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
