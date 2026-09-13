import {
  buildFunctionalQualityReviewMessages,
  formatFunctionalQualityReview,
  isFunctionalQualityReviewIntent,
  isFunctionalQualityReviewRevisionIntent,
  normalizeFunctionalQualityReview,
} from "./functionalQualityReview";

const categoryScores = {
  scopeBoundary: { score: 9, assessment: "Clear boundary." },
  functionQualityOwnership: { score: 8, assessment: "Mostly sound ownership." },
  interfaceSemanticsDirection: { score: 7, assessment: "One direction issue." },
  closedLoopFeedback: { score: 8, assessment: "Feedback is present." },
  connectivityCoverage: { score: 9, assessment: "Connected architecture." },
  safetyDegradedRecovery: { score: 8, assessment: "Recovery is modeled." },
  evidenceDiscipline: { score: 9, assessment: "Unknowns use TBD." },
};

describe("functional decomposition quality review", () => {
  test("distinguishes scoring from revision prompts", () => {
    expect(isFunctionalQualityReviewIntent("Review and score the current functional decomposition.")).toBe(true);
    expect(isFunctionalQualityReviewIntent("Revise the functional decomposition using that review.")).toBe(false);
    expect(isFunctionalQualityReviewRevisionIntent("Revise the current functional decomposition using this quality review.")).toBe(true);
    expect(isFunctionalQualityReviewRevisionIntent("Revise the current functional decomposition based on this feedback: replace row 2.")).toBe(false);
  });

  test("computes a deterministic weighted score and retains actionable row references", () => {
    const result = normalizeFunctionalQualityReview({
      categoryScores,
      strengths: [{ title: "Closed loop", evidence: "Status returns to control.", rowNumbers: [1, 2] }],
      findings: [{ severity: "High", title: "Wrong source", description: "Status originates from the wrong function.", rowNumbers: [2, 99], recommendation: "Move the status to the actuator." }],
      readiness: { hazardAnalysis: "Ready after correction.", demonstration: "Ready.", governedBaseline: "Needs verification." },
      summary: "Strong baseline.",
    }, { projectId: "p1", projectName: "Demo", rowCount: 4 });
    expect(result.valid).toBe(true);
    expect(result.review.overallScore).toBe(8.2);
    expect(result.review.findings[0].rowNumbers).toEqual([2]);
    expect(formatFunctionalQualityReview(result.review)).toContain("not approval or certification evidence");
    expect(formatFunctionalQualityReview(result.review)).toContain("Revise the current functional decomposition using this quality review");
  });

  test("builds an evidence-bound request containing all supplied rows", () => {
    const messages = buildFunctionalQualityReviewMessages({
      projectName: "Demo",
      rows: [{ rowIndex: 0, row: { subsystem: "Control", fromFunction: "Regulate Motion", controlAction: "Brake Demand", toFunction: "Apply Braking" } }],
    });
    expect(messages[0].content).toContain("Return strict JSON only");
    expect(messages[1].content).toContain("Regulate Motion");
  });
});
