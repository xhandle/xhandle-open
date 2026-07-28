export const SAFETY_REMEDIATION_REVIEW_DECISIONS = {
  APPROVE: "approve",
  APPROVE_WITH_CHANGES: "approve_with_changes",
  REJECT: "reject",
  REGENERATE: "regenerate",
  NEEDS_MORE_INFO: "needs_more_info",
};

export const SAFETY_REMEDIATION_VERIFICATION_DECISIONS = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request_changes",
  REJECT: "reject",
  OVERRIDE: "override",
};

export const SAFETY_REMEDIATION_VERIFICATION_CATEGORIES = {
  BUILD: "build",
  LINT: "lint",
  TYPECHECK: "typecheck",
  UNIT: "unit",
  CUSTOM: "custom",
};

export const SAFETY_REMEDIATION_VERIFICATION_RESULT_STATUSES = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
  TIMED_OUT: "timed_out",
  NOT_DETECTED: "not_detected",
};

export const SAFETY_REMEDIATION_VERIFICATION_RUN_STATUSES = {
  PASSED: "passed",
  FAILED: "failed",
  PARTIAL: "partial",
  NOT_RUN: "not_run",
  OVERRIDDEN: "overridden",
};

export const SAFETY_FINDING_REVIEW_STATUSES = {
  DRAFT_AI_GENERATED: "draft_ai_generated",
  APPROVED: "approved",
  APPROVED_WITH_CHANGES: "approved_with_changes",
  REJECTED: "rejected",
  NEEDS_REGENERATION: "needs_regeneration",
  NEEDS_MORE_INFO: "needs_more_info",
};

export const SAFETY_FINDING_IMPLEMENTATION_STATUSES = {
  NOT_STARTED: "not_started",
  PATCH_PROPOSED: "patch_proposed",
  SENT_TO_VSCODE: "sent_to_vscode",
  APPLIED_LOCALLY: "applied_locally",
  COMMITTED: "committed",
  PUSHED: "pushed",
  PR_OPEN: "pr_open",
  MERGED: "merged",
  REJECTED: "rejected",
  EXPORTED: "exported",
  IMPLEMENTED_EXTERNALLY: "implemented_externally",
};

export const SAFETY_FINDING_VERIFICATION_STATUSES = {
  NOT_STARTED: "not_started",
  PENDING: "pending",
  RECOMMENDED: "recommended",
  VERIFIED: "verified",
  FAILED: "failed",
  DEFERRED: "deferred",
  EVIDENCE_ATTACHED: "evidence_attached",
};

export const SAFETY_REMEDIATION_TEST_STATUSES = {
  NOT_RUN: "not_run",
  PASSED: "passed",
  FAILED: "failed",
  BLOCKED: "blocked",
  NOT_APPLICABLE: "not_applicable",
};

export const SAFETY_FINDING_VIEWS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  REMOVED: "removed",
};

export const SAFETY_FINDING_PRIORITIES = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

export const REVIEW_DECISION_LABELS = {
  [SAFETY_REMEDIATION_REVIEW_DECISIONS.APPROVE]: "Approve",
  [SAFETY_REMEDIATION_REVIEW_DECISIONS.APPROVE_WITH_CHANGES]: "Approve with changes",
  [SAFETY_REMEDIATION_REVIEW_DECISIONS.REJECT]: "Reject",
  [SAFETY_REMEDIATION_REVIEW_DECISIONS.REGENERATE]: "Regenerate",
  [SAFETY_REMEDIATION_REVIEW_DECISIONS.NEEDS_MORE_INFO]: "Needs more info",
};

export const VERIFICATION_DECISION_LABELS = {
  [SAFETY_REMEDIATION_VERIFICATION_DECISIONS.APPROVE]: "Approve",
  [SAFETY_REMEDIATION_VERIFICATION_DECISIONS.REQUEST_CHANGES]: "Request Changes",
  [SAFETY_REMEDIATION_VERIFICATION_DECISIONS.REJECT]: "Reject",
  [SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE]: "Override with Reason",
};

export const FINDING_STATUS_LABELS = {
  [SAFETY_FINDING_REVIEW_STATUSES.DRAFT_AI_GENERATED]: "Needs Review",
  [SAFETY_FINDING_REVIEW_STATUSES.APPROVED]: "Approved",
  [SAFETY_FINDING_REVIEW_STATUSES.APPROVED_WITH_CHANGES]: "Approved with Changes",
  [SAFETY_FINDING_REVIEW_STATUSES.REJECTED]: "Rejected",
  [SAFETY_FINDING_REVIEW_STATUSES.NEEDS_REGENERATION]: "Needs Regeneration",
  [SAFETY_FINDING_REVIEW_STATUSES.NEEDS_MORE_INFO]: "Needs More Info",
};
