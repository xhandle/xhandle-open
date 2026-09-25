/**
 * Row IDs are an FNV-1a hash of the row's content, synthesized on read whenever
 * the column is absent. A review snapshots its queue from that derived view and
 * then changes the row -- so if the IDs were never written down, the ID
 * re-derives to a different value and the follow-up review reports "the source
 * row no longer exists in the active hazard analysis".
 */

import {
  ensureHazardAnalysisRowIds,
  normalizeHazardAnalysisResolutionStatus,
} from "./classificationResolutionStatus";

const HEADERS = [
  "Function (From)", "Control Action", "Function (To)", "Guide Phrase",
  "Guide Phrase Applicable", "Guide Phrase Applicability Rationale",
  "Safety Significant", "Safety Classification",
];
const row = (applicable, rationale) => [
  "Generate Trajectory Plan", "Request Perception ROI", "Perception Subsystem", "Too early",
  applicable, rationale, "No", "Mission/Reliability",
];

const idIndexOf = (summary) => summary[0].indexOf("Raw Analysis Row ID");
const idOf = (summary, rowIndex = 1) => summary[rowIndex][idIndexOf(summary)];

const applyApplicability = (summary, applicable, rationale) => {
  const next = summary.map((entry) => [...entry]);
  next[1][summary[0].indexOf("Guide Phrase Applicable")] = applicable;
  next[1][summary[0].indexOf("Guide Phrase Applicability Rationale")] = rationale;
  return next;
};

describe("stable row identity across a review decision", () => {
  it("derives a different id when the content changes and no id was written down", () => {
    // This is the failure: the queue holds the first id, the row now has the second.
    const before = ensureHazardAnalysisRowIds([HEADERS, row("Needs Review", "not validated")]);
    const after = ensureHazardAnalysisRowIds([HEADERS, row("Yes", "the guide phrase applies")]);

    expect(idOf(before)).not.toEqual(idOf(after));
  });

  it("keeps the id when it was materialized before the decision", () => {
    const materialized = normalizeHazardAnalysisResolutionStatus({
      Summary: [HEADERS, row("Needs Review", "not validated")],
    }).Summary;
    const queuedId = idOf(materialized);
    expect(queuedId).toMatch(/^RAW-/);

    const decided = normalizeHazardAnalysisResolutionStatus({
      Summary: applyApplicability(materialized, "Yes", "the guide phrase applies"),
    }).Summary;

    expect(idOf(decided)).toBe(queuedId);
  });

  it("survives a whole cascade: applicability then significance", () => {
    let summary = normalizeHazardAnalysisResolutionStatus({
      Summary: [HEADERS, row("Needs Review", "not validated")],
    }).Summary;
    const queuedId = idOf(summary);

    summary = normalizeHazardAnalysisResolutionStatus({
      Summary: applyApplicability(summary, "Yes", "the guide phrase applies"),
    }).Summary;

    const withSignificance = summary.map((entry) => [...entry]);
    withSignificance[1][summary[0].indexOf("Safety Significant")] = "Yes";
    summary = normalizeHazardAnalysisResolutionStatus({ Summary: withSignificance }).Summary;

    // The follow-up review looks the row up by the id its parent queued.
    expect(idOf(summary)).toBe(queuedId);
  });

  it("never reassigns an id that is already present", () => {
    const seeded = [
      [...HEADERS, "Raw Analysis Row ID"],
      [...row("Needs Review", "not validated"), "RAW-CHOSEN"],
    ];
    const changed = applyApplicability(seeded, "Yes", "the guide phrase applies");

    expect(idOf(ensureHazardAnalysisRowIds(changed))).toBe("RAW-CHOSEN");
  });

  it("gives rows with identical content distinct ids", () => {
    const duplicated = [HEADERS, row("Needs Review", "same"), row("Needs Review", "same")];
    const identified = ensureHazardAnalysisRowIds(duplicated);

    expect(idOf(identified, 1)).not.toBe(idOf(identified, 2));
  });
});
