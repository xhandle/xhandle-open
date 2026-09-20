const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID?.()) || `cascade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clean = (value) => String(value ?? "").trim();

const CLASSIFICATION_COLUMNS = ["Safety Classification", "Safety Classification Rule", "Causal Path Type", "Classification Evidence", "Classification Confidence"];
const CAUSAL_ANALYSIS_COLUMNS = ["Loss", "Hazard", "Raw Loss Candidate", "Raw Hazard Candidate", "Canonical Loss ID", "Canonical Hazard ID", "Unsafe Control Action", "Causal Scenario", "Causal Factor", "Causal Factor Category", "Causal Effect", "Resulting System State", "Intermediate Safety Function", "Intermediate Safety Effect", "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination"];
const CONTROL_EVIDENCE_COLUMNS = ["Mitigation Strategy", "Safety Constraint", "System Requirement", "Requirement Parameter Source", "Verification Method", "Acceptance Criteria"];

export const REVIEW_CASCADE_STATUS = Object.freeze({ QUEUED: "queued", ACTIVE: "active", COMPLETE: "complete", DISMISSED: "dismissed" });

export function createReviewCascade({ projectId, workspaceType = "functional-project", sourceReviewId = "", trigger = {}, steps = [] } = {}) {
  const seen = new Set();
  const normalizedSteps = steps.reduce((result, step, index) => {
    const type = clean(step?.type);
    const targetId = clean(step?.targetId || trigger?.targetId);
    const key = clean(step?.key || `${type}:${targetId}`);
    if (!type || !targetId || seen.has(key)) return result;
    seen.add(key);
    result.push({
      id: clean(step?.id) || `${index + 1}:${key}`,
      key, type, targetId,
      label: clean(step?.label) || type,
      reason: clean(step?.reason),
      affectedColumns: [...new Set((step?.affectedColumns || []).map(clean).filter(Boolean))],
      automatic: step?.automatic === true,
      status: REVIEW_CASCADE_STATUS.QUEUED,
    });
    return result;
  }, []);
  return {
    id: uid(), projectId: clean(projectId), workspaceType: clean(workspaceType), sourceReviewId: clean(sourceReviewId),
    trigger: { ...trigger }, steps: normalizedSteps, cursor: 0,
    status: normalizedSteps.length ? REVIEW_CASCADE_STATUS.ACTIVE : REVIEW_CASCADE_STATUS.COMPLETE,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

export function currentReviewCascadeStep(cascade) {
  return cascade?.steps?.[cascade?.cursor] || null;
}

export function advanceReviewCascade(cascade, { status = REVIEW_CASCADE_STATUS.COMPLETE } = {}) {
  if (!cascade) return cascade;
  const steps = (cascade.steps || []).map((step, index) => index === cascade.cursor ? { ...step, status } : step);
  const cursor = cascade.cursor + 1;
  return { ...cascade, steps, cursor, status: cursor >= steps.length ? REVIEW_CASCADE_STATUS.COMPLETE : REVIEW_CASCADE_STATUS.ACTIVE, updatedAt: new Date().toISOString() };
}

export function selectReviewCascadeSteps(cascade, selectedStepIds = []) {
  if (!cascade) return cascade;
  const selected = new Set((selectedStepIds || []).map(clean));
  const steps = (cascade.steps || []).map((step) => ({
    ...step,
    status: selected.has(clean(step.id)) ? REVIEW_CASCADE_STATUS.QUEUED : REVIEW_CASCADE_STATUS.DISMISSED,
  }));
  const cursor = steps.findIndex((step) => step.status === REVIEW_CASCADE_STATUS.QUEUED);
  return {
    ...cascade,
    steps,
    cursor: cursor < 0 ? steps.length : cursor,
    status: cursor < 0 ? REVIEW_CASCADE_STATUS.DISMISSED : REVIEW_CASCADE_STATUS.ACTIVE,
    selectionConfirmed: true,
    selectedStepIds: steps.filter((step) => step.status === REVIEW_CASCADE_STATUS.QUEUED).map((step) => step.id),
    updatedAt: new Date().toISOString(),
  };
}

export function planHazardDecisionCascade({ projectId, workspaceType, sourceReviewId, rowId, reviewTarget, decision } = {}) {
  const trigger = { domain: "hazard-analysis", reviewTarget, decision, targetId: rowId };
  const steps = [];
  if (reviewTarget === "guidePhraseApplicable" && decision === "Yes") {
    steps.push({ type: "hazard-safety-significance", targetId: rowId, label: "Review Safety Significance", reason: "Applicable deviations require a governed safety-significance assessment." });
  } else if (reviewTarget === "safetySignificant" && decision === "Yes") {
    steps.push({ type: "hazard-safety-classification", targetId: rowId, label: "Review Safety Classification", reason: "Safety Significant = Yes requires an explicit Direct-versus-Related assessment." });
  } else if (reviewTarget === "safetySignificant" && decision === "No") {
    steps.push({ type: "hazard-derived-classification", targetId: rowId, label: "Align classification columns to Mission/Reliability", reason: "Safety Significant = No deterministically constrains these classification values.", affectedColumns: CLASSIFICATION_COLUMNS, automatic: true });
  }
  if (["guidePhraseApplicable", "safetySignificant", "safetyClassification"].includes(reviewTarget)) {
    steps.push(
      { type: "hazard-causal-analysis-review", targetId: rowId, label: "Review causal-analysis columns", reason: "These hazard and causal-path fields may no longer agree with the governed decision.", affectedColumns: CAUSAL_ANALYSIS_COLUMNS },
      { type: "hazard-control-evidence-review", targetId: rowId, label: "Review control and verification columns", reason: "Controls, requirements, and verification evidence depend on the resulting hazard path.", affectedColumns: CONTROL_EVIDENCE_COLUMNS },
      { type: "hazard-classification-validation", targetId: rowId, label: "Validate classification columns", reason: "These columns must remain mutually consistent after the selected updates.", affectedColumns: CLASSIFICATION_COLUMNS, automatic: true },
      { type: "safety-issue-regeneration", targetId: rowId, label: "Regenerate consolidated Safety Issues", reason: "Consolidated issues become stale when governed hazard evidence changes." },
    );
  }
  return createReviewCascade({ projectId, workspaceType, sourceReviewId, trigger, steps });
}

export function planFunctionalDecisionCascade({ projectId, workspaceType, sourceReviewId, rowId, decision } = {}) {
  const trigger = { domain: "functional-decomposition", decision, targetId: rowId };
  const steps = [
    { type: "functional-interface-integrity", targetId: rowId, label: "Review allocation and interface direction", reason: "The accepted functional change may alter responsibility or interface semantics." },
    { type: "affected-hazard-discovery", targetId: rowId, label: "Identify affected hazard rows", reason: "Hazard evidence tied to this stable interface identity may be stale.", automatic: true },
    { type: "affected-hazard-review", targetId: rowId, label: "Review affected hazard decisions", reason: "Applicability, significance, or classification may change." },
    { type: "derived-evidence-regeneration", targetId: rowId, label: "Regenerate requirements and verification evidence", reason: "Derived controls must follow the reviewed functional and hazard decisions." },
    { type: "traceability-validation", targetId: rowId, label: "Validate traceability", reason: "All affected artifacts must resolve to current stable identities.", automatic: true },
  ];
  return createReviewCascade({ projectId, workspaceType, sourceReviewId, trigger, steps: decision === "Keep" ? [] : steps });
}
