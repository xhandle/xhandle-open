import {
  aggregateHazardEvalReports,
  matchRowsToItems,
  normalizeProducedApplicability,
  normalizeProducedSafetySignificance,
  scoreApplicability,
  scoreArchitecturalConsistency,
  scoreCanonicalization,
  scoreHazardEvalRun,
  scoreSafetySignificance,
} from "./hazardEvalScoring";
import vehicleBrakingFixture from "./fixtures/vehicleBraking";

const applicableRow = (id, overrides = {}) => ({
  id,
  guidePhraseApplicable: "Yes",
  proposedSafetyAssessment: "Safety",
  safetySignificant: "Yes",
  hazards: `Hazard for ${id}`,
  ...overrides,
});

describe("produced value normalization", () => {
  test("treats Needs Review as undecided rather than a silent yes", () => {
    expect(normalizeProducedApplicability({ guidePhraseApplicable: "Yes" })).toBe("yes");
    expect(normalizeProducedApplicability({ guidePhraseApplicable: "No" })).toBe("no");
    expect(normalizeProducedApplicability({ guidePhraseApplicable: "Needs Review" })).toBeNull();
    expect(normalizeProducedApplicability({})).toBeNull();
  });

  test("reads safety significance from the assessment before the significance flag", () => {
    expect(normalizeProducedSafetySignificance({ proposedSafetyAssessment: "Safety" })).toBe("yes");
    expect(normalizeProducedSafetySignificance({ proposedSafetyAssessment: "Mission/Reliability" })).toBe("no");
    expect(normalizeProducedSafetySignificance({ safetySignificant: "Yes" })).toBe("yes");
    expect(normalizeProducedSafetySignificance({ safetySignificant: "Needs Review" })).toBeNull();
  });
});

describe("row matching", () => {
  test("matches rows by generated id suffix, then by position", () => {
    const items = [{ id: "FD-1" }, { id: "FD-2" }, { id: "FD-3" }];
    const rows = [{ id: "FD-2-STPA" }, { id: "FD-1-STPA" }, { id: "unrelated" }];
    const matched = matchRowsToItems(items, rows);
    expect(matched[0].id).toBe("FD-1-STPA");
    expect(matched[1].id).toBe("FD-2-STPA");
    expect(matched[2].id).toBe("unrelated");
  });

  test("reports a missing row as null rather than silently shifting", () => {
    expect(matchRowsToItems([{ id: "FD-1" }], [])[0]).toBeNull();
  });
});

describe("applicability scoring", () => {
  const items = [
    { id: "FD-1", guidePhrase: "Not providing", expected: { applicable: "yes" } },
    { id: "FD-2", guidePhrase: "Wrong order", expected: { applicable: "no" } },
    { id: "FD-3", guidePhrase: "Applied too long", expected: { applicable: "no" } },
  ];

  test("counts an over-applied deviation as a false positive", () => {
    const rows = [applicableRow("FD-1-STPA"), applicableRow("FD-2-STPA"), applicableRow("FD-3-STPA")];
    const score = scoreApplicability(items, matchRowsToItems(items, rows));
    expect(score.truePositive).toBe(1);
    expect(score.falsePositive).toBe(2);
    expect(score.trueNegative).toBe(0);
    // Every deviation the engineer rejected was claimed anyway.
    expect(score.falsePositiveRate).toBe(1);
    expect(score.disagreements).toHaveLength(2);
    expect(score.disagreements[0]).toMatchObject({ itemId: "FD-2", expected: "no", produced: "yes" });
  });

  test("rewards a run that declines the non-applicable deviations", () => {
    const rows = [
      applicableRow("FD-1-STPA"),
      applicableRow("FD-2-STPA", { guidePhraseApplicable: "No" }),
      applicableRow("FD-3-STPA", { guidePhraseApplicable: "No" }),
    ];
    const score = scoreApplicability(items, matchRowsToItems(items, rows));
    expect(score.truePositive).toBe(1);
    expect(score.falsePositive).toBe(0);
    expect(score.trueNegative).toBe(2);
    expect(score.falsePositiveRate).toBe(0);
    expect(score.accuracy).toBe(1);
    expect(score.disagreements).toHaveLength(0);
  });

  test("separates an undecided row from a wrong decision", () => {
    const rows = [applicableRow("FD-1-STPA", { guidePhraseApplicable: "Needs Review" })];
    const score = scoreApplicability(items.slice(0, 1), matchRowsToItems(items.slice(0, 1), rows));
    expect(score.undecided).toBe(1);
    expect(score.decided).toBe(0);
    expect(score.falseNegative).toBe(0);
  });
});

describe("safety significance scoring", () => {
  const items = [
    { id: "FD-1", expected: { applicable: "yes", safetySignificant: "yes" } },
    { id: "FD-2", expected: { applicable: "yes", safetySignificant: "no" } },
    { id: "FD-3", expected: { applicable: "no", safetySignificant: null } },
  ];

  test("counts a mission-only effect promoted to Safety as over-classification", () => {
    const rows = [applicableRow("FD-1-STPA"), applicableRow("FD-2-STPA"), applicableRow("FD-3-STPA")];
    const score = scoreSafetySignificance(items, matchRowsToItems(items, rows));
    expect(score.truePositive).toBe(1);
    expect(score.falsePositive).toBe(1);
    expect(score.falsePositiveRate).toBe(1);
    expect(score.disagreements[0]).toMatchObject({ itemId: "FD-2", expected: "no", produced: "yes" });
  });

  test("does not score rows the engineer marked non-applicable", () => {
    const rows = [applicableRow("FD-1-STPA"), applicableRow("FD-2-STPA"), applicableRow("FD-3-STPA")];
    const score = scoreSafetySignificance(items, matchRowsToItems(items, rows));
    // FD-3 is expected non-applicable, so it never reaches significance scoring.
    expect(score.decided).toBe(2);
  });

  test("does not double-count an applicability miss as a significance miss", () => {
    const rows = [
      applicableRow("FD-1-STPA", { guidePhraseApplicable: "No" }),
      applicableRow("FD-2-STPA", { proposedSafetyAssessment: "Mission/Reliability" }),
      applicableRow("FD-3-STPA", { guidePhraseApplicable: "No" }),
    ];
    const score = scoreSafetySignificance(items, matchRowsToItems(items, rows));
    expect(score.decided).toBe(1);
    expect(score.trueNegative).toBe(1);
  });
});

describe("canonicalization scoring", () => {
  const fixture = {
    canonicalHazards: [{ id: "H-1" }, { id: "H-2" }],
    items: [
      { id: "FD-1", expected: { applicable: "yes", canonicalHazardId: "H-1" } },
      { id: "FD-2", expected: { applicable: "yes", canonicalHazardId: "H-1" } },
      { id: "FD-3", expected: { applicable: "yes", canonicalHazardId: "H-2" } },
    ],
  };

  test("flags unconverged output when every row invents its own hazard", () => {
    const rows = fixture.items.map((entry, index) => applicableRow(`${entry.id}-STPA`, {
      hazards: `Distinct hazard statement ${index}`,
      canonicalHazardId: `H-INVENTED-${index}`,
    }));
    const score = scoreCanonicalization(fixture, fixture.items, matchRowsToItems(fixture.items, rows));
    expect(score.producedHazardStatementCount).toBe(3);
    expect(score.expectedHazardCount).toBe(2);
    expect(score.convergenceRatio).toBeCloseTo(1.5);
    expect(score.mappingCorrect).toBe(0);
    expect(score.mappingIncorrect).toBe(3);
  });

  test("scores a converged run at the expected hazard count", () => {
    const rows = [
      applicableRow("FD-1-STPA", { hazards: "Hazard one", canonicalHazardId: "H-1" }),
      applicableRow("FD-2-STPA", { hazards: "Hazard one", canonicalHazardId: "H-1" }),
      applicableRow("FD-3-STPA", { hazards: "Hazard two", canonicalHazardId: "H-2" }),
    ];
    const score = scoreCanonicalization(fixture, fixture.items, matchRowsToItems(fixture.items, rows));
    expect(score.convergenceRatio).toBe(1);
    expect(score.mappingAccuracy).toBe(1);
  });

  test("counts an unmapped row as missing rather than correct", () => {
    const rows = fixture.items.map((entry) => applicableRow(`${entry.id}-STPA`, { canonicalHazardId: "" }));
    const score = scoreCanonicalization(fixture, fixture.items, matchRowsToItems(fixture.items, rows));
    expect(score.mappingMissing).toBe(3);
    expect(score.mappingAccuracy).toBe(0);
  });
});

describe("architectural consistency scoring", () => {
  const items = [{
    id: "FD-1",
    contextAssumptions: "On loss of controller power the actuator reverts to its fail-safe position with no command required.",
    expected: {
      applicable: "yes",
      forbiddenRequirementClaims: ["shall command brake application on power loss"],
    },
  }];

  test("flags a requirement that contradicts a stated context assumption", () => {
    const rows = [applicableRow("FD-1-STPA", {
      systemRequirement: "The Brake Controller shall command brake application on power loss within 50 ms.",
    })];
    const score = scoreArchitecturalConsistency(items, matchRowsToItems(items, rows));
    expect(score.violationCount).toBe(1);
    expect(score.violationRate).toBe(1);
    expect(score.violations[0].claim).toBe("shall command brake application on power loss");
  });

  test("passes a requirement that respects the passive fail-safe assumption", () => {
    const rows = [applicableRow("FD-1-STPA", {
      systemRequirement: "The Brake Controller shall relinquish pressure authority so the actuator reaches its fail-safe position on power loss.",
    })];
    const score = scoreArchitecturalConsistency(items, matchRowsToItems(items, rows));
    expect(score.violationCount).toBe(0);
    expect(score.checked).toBe(1);
  });
});

describe("full run and aggregation", () => {
  test("scores the seed fixture end to end", () => {
    const rows = vehicleBrakingFixture.items.map((entry) => applicableRow(`${entry.id}-STPA`));
    const report = scoreHazardEvalRun({ fixture: vehicleBrakingFixture, rows });
    expect(report.fixtureId).toBe("vehicle-braking-001");
    expect(report.itemCount).toBe(vehicleBrakingFixture.items.length);
    expect(report.missingRows).toBe(0);
    // An all-applicable run must show every engineer-rejected deviation as a
    // false positive — this is the baseline failure the harness exists to catch.
    expect(report.applicability.falsePositive).toBe(5);
    expect(report.applicability.falsePositiveRate).toBe(1);
  });

  test("aggregates confusion counts and ratios across fixtures", () => {
    const first = {
      itemCount: 2,
      missingRows: 0,
      applicability: { truePositive: 1, falsePositive: 1, trueNegative: 0, falseNegative: 0, undecided: 0, unlabeled: 0 },
      safetySignificance: { truePositive: 1, falsePositive: 0, trueNegative: 0, falseNegative: 0, undecided: 0, unlabeled: 0 },
      canonicalization: { expectedHazardCount: 2, producedHazardStatementCount: 4, mappingCorrect: 1, mappingIncorrect: 1, mappingMissing: 0 },
      architecturalConsistency: { checked: 2, violationCount: 1 },
    };
    const second = {
      itemCount: 2,
      missingRows: 1,
      applicability: { truePositive: 0, falsePositive: 0, trueNegative: 2, falseNegative: 0, undecided: 0, unlabeled: 0 },
      safetySignificance: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, undecided: 0, unlabeled: 0 },
      canonicalization: { expectedHazardCount: 2, producedHazardStatementCount: 0, mappingCorrect: 1, mappingIncorrect: 0, mappingMissing: 1 },
      architecturalConsistency: { checked: 0, violationCount: 0 },
    };
    const total = aggregateHazardEvalReports([first, second]);
    expect(total.fixtureCount).toBe(2);
    expect(total.missingRows).toBe(1);
    expect(total.applicability.falsePositive).toBe(1);
    expect(total.applicability.trueNegative).toBe(2);
    expect(total.applicability.falsePositiveRate).toBeCloseTo(1 / 3);
    expect(total.canonicalization.convergenceRatio).toBe(1);
    expect(total.canonicalization.mappingAccuracy).toBeCloseTo(0.5);
    expect(total.architecturalConsistency.violationRate).toBe(0.5);
  });
});
