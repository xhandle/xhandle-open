/**
 * A governed rationale is written back into the row, so the next decision reads
 * it as "existing basis". Without care it repeats itself within one decision and
 * nests itself across decisions, growing the largest artifact in browser storage
 * with copies of its own history.
 */

import {
  buildHumanGuidePhraseApplicabilityDecision,
  buildHumanSafetyClassificationDecision,
  buildHumanVibeReviewDecision,
  composeGovernedRationale,
} from "./vibeReviewProposal";

/**
 * The significance and classification builders return governed fields flat; the
 * applicability builder nests them under governedDecision. Read either.
 */
const governed = (decision, field) => decision.governedDecision?.[field] ?? decision[field];

const rowFields = (overrides = {}) => ({
  "Raw Analysis Row ID": "RAW-1",
  "Guide Phrase Applicable": "Yes",
  "Safety Significant": "Needs Review",
  "Safety Classification": "Needs Review",
  "Safety Significance Rationale": "Needs review: applicability could not be validated.",
  ...overrides,
});

describe("composeGovernedRationale", () => {
  it("emits a repeated value once", () => {
    const composed = composeGovernedRationale(["A decision.", "Same text.", "Same text."]);
    expect(composed.match(/Same text\./g)).toHaveLength(1);
  });

  it("ignores case when de-duplicating", () => {
    expect(composeGovernedRationale(["Same Text.", "same text."]).match(/[Ss]ame [Tt]ext\./g)).toHaveLength(1);
  });

  it("drops a previous decision's rationale rather than nesting it", () => {
    const prior = "Human-directed Vibe Review decision: the reviewer marked Safety Significant = No.";
    const composed = composeGovernedRationale(["A new decision.", prior, "Fresh evidence."]);

    expect(composed).toContain("Fresh evidence.");
    expect(composed.match(/Human-directed Vibe Review decision/g)).toBeNull();
  });

  it("caps a pathological rationale and says it was truncated", () => {
    const composed = composeGovernedRationale(["x".repeat(5000)]);
    expect(composed.length).toBeLessThan(1400);
    expect(composed).toContain("rationale truncated");
  });
});

describe("the significance decision rationale", () => {
  it("does not print the same basis twice", () => {
    // remainingGap falls back to existingBasis when the classification needs
    // review and the proposal carries no gap -- the live duplication.
    const decision = buildHumanVibeReviewDecision({
      rowFields: rowFields(),
      proposal: {},
      significance: "No",
    });
    const basis = "Needs review: applicability could not be validated.";

    expect(governed(decision, "Safety Significance Rationale")
      .match(new RegExp(basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
  });

  it("keeps a genuinely different gap", () => {
    const decision = buildHumanVibeReviewDecision({
      rowFields: rowFields(),
      proposal: { remainingEvidenceGap: "No protection independence is documented." },
      significance: "No",
    });

    expect(governed(decision, "Safety Significance Rationale")).toContain("No protection independence is documented.");
  });

  it("preserves the reviewer's own words verbatim", () => {
    const decision = buildHumanVibeReviewDecision({
      rowFields: rowFields(),
      proposal: {},
      significance: "Yes",
      userFeedback: "The interlock is credited in the mechanical design review.",
    });

    expect(governed(decision, "Safety Significance Rationale"))
      .toContain("The interlock is credited in the mechanical design review.");
  });

  it("stabilises instead of growing when the same row is reviewed repeatedly", () => {
    let fields = rowFields();
    const lengths = [];
    for (let round = 0; round < 6; round += 1) {
      const decision = buildHumanVibeReviewDecision({ rowFields: fields, proposal: {}, significance: "No" });
      const rationale = governed(decision, "Safety Significance Rationale");
      lengths.push(rationale.length);
      // Written back into the row, exactly as the review does.
      fields = { ...fields, "Safety Significance Rationale": rationale };
    }

    // Nesting showed up as a rationale that grew on every single round. It may
    // change once when the row's original basis is superseded, then must settle.
    const settled = lengths.slice(1);
    expect(new Set(settled).size).toBe(1);
    expect(lengths.at(-1)).toBeLessThan(1400);
  });

  it("never embeds a previous decision's rationale in the next one", () => {
    const first = buildHumanVibeReviewDecision({ rowFields: rowFields(), proposal: {}, significance: "No" });
    const firstRationale = governed(first, "Safety Significance Rationale");

    const second = buildHumanVibeReviewDecision({
      rowFields: rowFields({ "Safety Significance Rationale": firstRationale }),
      proposal: {},
      significance: "Yes",
    });

    expect(governed(second, "Safety Significance Rationale").match(/Human-directed Vibe Review decision/g))
      .toHaveLength(1);
  });
});

describe("the other governed builders", () => {
  it("does not repeat the applicability gap when it equals the basis", () => {
    const decision = buildHumanGuidePhraseApplicabilityDecision({
      rowFields: rowFields({ "Guide Phrase Applicability Rationale": "Shared text." }),
      proposal: { remainingEvidenceGap: "Shared text." },
      applicable: "Yes",
    });

    expect(governed(decision, "Guide Phrase Applicability Rationale").match(/Shared text\./g)).toHaveLength(1);
  });

  it("bounds the classification rationale", () => {
    const decision = buildHumanSafetyClassificationDecision({
      rowFields: rowFields({ "Safety Significant": "No" }),
      proposal: { explanation: "y".repeat(5000) },
      classification: "Mission/Reliability",
    });

    expect(governed(decision, "Classification Evidence").length).toBeLessThan(1400);
  });
});

describe("a rejected AI proposal contributes no governed evidence", () => {
  // A proposal the policy rejected describes an assessment that failed its
  // checks. Carrying its fields into the row records rejected reasoning as
  // engineering evidence, under the reviewer's name.
  const rejected = {
    normalizedDecision: "Needs Review",
    explanation: "Reasoning the policy rejected.",
    governedDecision: {
      "Classification Evidence": "Reasoning the policy rejected.",
      "Classification Confidence": "High",
      "Safety Significance Rationale": "Needs review: Needs Review requires a concise, named material evidence gap.",
    },
  };

  it("keeps rejected classification evidence out of the row", () => {
    const decision = buildHumanSafetyClassificationDecision({
      rowFields: rowFields({
        "Safety Significant": "Yes",
        "Classification Evidence": "The documented causal path for this interface.",
      }),
      proposal: rejected,
      classification: "Safety — Direct",
      proposalValid: false,
    });
    const evidence = governed(decision, "Classification Evidence");

    expect(evidence).not.toContain("Reasoning the policy rejected.");
    expect(evidence).toContain("The documented causal path for this interface.");
    expect(evidence).toContain("did not pass the configured checks");
  });

  it("does not inherit a rejected proposal's confidence", () => {
    const decision = buildHumanSafetyClassificationDecision({
      rowFields: rowFields({ "Safety Significant": "Yes" }),
      proposal: rejected,
      classification: "Safety — Direct",
      proposalValid: false,
    });

    // "High" came from an assessment the policy threw out.
    expect(governed(decision, "Classification Confidence")).toBe("Low");
  });

  it("still uses a proposal that passed", () => {
    const accepted = {
      governedDecision: {
        "Classification Evidence": "A validated causal path.",
        "Classification Confidence": "High",
      },
    };
    const decision = buildHumanSafetyClassificationDecision({
      rowFields: rowFields({ "Safety Significant": "Yes" }),
      proposal: accepted,
      classification: "Safety — Direct",
      proposalValid: true,
    });

    expect(governed(decision, "Classification Evidence")).toContain("A validated causal path.");
    expect(governed(decision, "Classification Confidence")).toBe("High");
  });

  it("keeps rejected reasoning out of a significance decision", () => {
    const decision = buildHumanVibeReviewDecision({
      rowFields: rowFields(),
      proposal: rejected,
      significance: "No",
      proposalValid: false,
    });

    expect(governed(decision, "Safety Significance Rationale")).not.toContain("Reasoning the policy rejected.");
  });

  it("behaves as before when validity is unknown", () => {
    const decision = buildHumanSafetyClassificationDecision({
      rowFields: rowFields({ "Safety Significant": "Yes" }),
      proposal: { governedDecision: { "Classification Evidence": "Legacy evidence." } },
      classification: "Safety — Direct",
    });

    expect(governed(decision, "Classification Evidence")).toContain("Legacy evidence.");
  });
});
