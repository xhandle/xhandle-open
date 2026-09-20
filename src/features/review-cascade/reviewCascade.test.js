import { advanceReviewCascade, createReviewCascade, currentReviewCascadeStep, planFunctionalDecisionCascade, planHazardDecisionCascade, selectReviewCascadeSteps } from "./reviewCascade";

test("orders a Safety Significant Yes cascade through classification and regeneration", () => {
  const cascade = planHazardDecisionCascade({ projectId: "p", rowId: "RAW-1", reviewTarget: "safetySignificant", decision: "Yes" });
  expect(cascade.steps.map((step) => step.type)).toEqual([
    "hazard-safety-classification", "hazard-causal-analysis-review", "hazard-control-evidence-review", "hazard-classification-validation", "safety-issue-regeneration",
  ]);
  expect(currentReviewCascadeStep(cascade).targetId).toBe("RAW-1");
});

test("deduplicates steps and advances without cycles", () => {
  const cascade = createReviewCascade({ projectId: "p", trigger: { targetId: "r" }, steps: [
    { type: "x", targetId: "r" }, { type: "x", targetId: "r" }, { type: "y", targetId: "r" },
  ] });
  expect(cascade.steps).toHaveLength(2);
  expect(currentReviewCascadeStep(advanceReviewCascade(cascade)).type).toBe("y");
});

test("functional revisions queue integrity, hazards, evidence, and traceability", () => {
  const cascade = planFunctionalDecisionCascade({ projectId: "p", rowId: "FD-1", decision: "Revise" });
  expect(cascade.steps.map((step) => step.type)).toEqual([
    "functional-interface-integrity", "affected-hazard-discovery", "affected-hazard-review", "derived-evidence-regeneration", "traceability-validation",
  ]);
  expect(JSON.parse(JSON.stringify(cascade))).toMatchObject({ projectId: "p", status: "active" });
});

test("selects any downstream subset while preserving dependency order", () => {
  const cascade = planHazardDecisionCascade({ projectId: "p", rowId: "RAW-1", reviewTarget: "safetyClassification", decision: "Safety — Direct" });
  const selectedIds = [cascade.steps[0].id, cascade.steps[2].id];
  const selected = selectReviewCascadeSteps(cascade, selectedIds);
  expect(selected.selectedStepIds).toEqual(selectedIds);
  expect(selected.steps.map((step) => step.status)).toEqual(["queued", "dismissed", "queued", "dismissed"]);
  expect(currentReviewCascadeStep(selected).id).toBe(selectedIds[0]);
  expect(JSON.parse(JSON.stringify(selected)).selectionConfirmed).toBe(true);
});

test("records an explicit skip of every downstream review", () => {
  const cascade = planFunctionalDecisionCascade({ projectId: "p", rowId: "FD-1", decision: "Revise" });
  const skipped = selectReviewCascadeSteps(cascade, []);
  expect(skipped.status).toBe("dismissed");
  expect(skipped.steps.every((step) => step.status === "dismissed")).toBe(true);
});

test("describes Safety Significant No impacts using concrete table columns", () => {
  const cascade = planHazardDecisionCascade({ projectId: "p", rowId: "RAW-2", reviewTarget: "safetySignificant", decision: "No" });
  expect(cascade.steps[0]).toMatchObject({
    type: "hazard-derived-classification",
    affectedColumns: expect.arrayContaining(["Safety Classification", "Safety Classification Rule", "Causal Path Type"]),
  });
  expect(cascade.steps.find((step) => step.type === "hazard-control-evidence-review").affectedColumns)
    .toEqual(expect.arrayContaining(["Safety Constraint", "System Requirement", "Verification Method"]));
});
