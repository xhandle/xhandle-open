import {
  CANONICAL_PROJECT_HAZARD_METHOD,
  normalizeProjectHazardMethod,
  shouldApplyHazardReconciliation,
} from "./hazardReconciliation";

test("normalizes legacy and malformed project hazard methods to STPA", () => {
  expect(normalizeProjectHazardMethod("STPA")).toBe(CANONICAL_PROJECT_HAZARD_METHOD);
  expect(normalizeProjectHazardMethod(" STPA Textbook ")).toBe(CANONICAL_PROJECT_HAZARD_METHOD);
  expect(normalizeProjectHazardMethod("Collaborator hazard vibe review")).toBe(CANONICAL_PROJECT_HAZARD_METHOD);
});

test("blocks partial reconciliation from shrinking completed hazard evidence", () => {
  const existing = [["id"], ...Array.from({ length: 130 }, (_, index) => [`ROW-${index + 1}`])];
  expect(shouldApplyHazardReconciliation(existing, Array.from({ length: 24 }, () => []))).toBe(false);
  expect(shouldApplyHazardReconciliation(existing, Array.from({ length: 130 }, () => []))).toBe(true);
  expect(shouldApplyHazardReconciliation(existing, Array.from({ length: 140 }, () => []))).toBe(true);
  expect(shouldApplyHazardReconciliation(existing, [])).toBe(false);
});
