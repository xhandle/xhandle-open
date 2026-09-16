export const CANONICAL_PROJECT_HAZARD_METHOD = "STPA-Textbook";

export function normalizeProjectHazardMethod(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["stpa", "stpa-textbook", "stpa-(textbook)"].includes(normalized)) {
    return CANONICAL_PROJECT_HAZARD_METHOD;
  }
  // STPA is currently the only selectable project-hazard method. Treat stale,
  // imported, or malformed values as STPA instead of silently producing one
  // blank generic variant per interface.
  return CANONICAL_PROJECT_HAZARD_METHOD;
}

export function shouldApplyHazardReconciliation(existingSummary, nextRows) {
  const existingRowCount = Array.isArray(existingSummary) ? Math.max(0, existingSummary.length - 1) : 0;
  const nextRowCount = Array.isArray(nextRows) ? nextRows.length : 0;
  if (!nextRowCount) return false;
  // Reconciliation may align or add evidence, but it must never silently
  // delete completed hazard rows. Removal requires an explicit user workflow.
  return existingRowCount === 0 || nextRowCount >= existingRowCount;
}
