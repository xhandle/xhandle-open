import {
  applyReviewedApplicabilityToGenerationInput,
  applyReviewedSafetySignificanceToGenerationInput,
  buildReviewedRowRegenerationContext,
  latestGuidePhraseReviewByRowId,
  latestSafetySignificanceReviewByRowId,
  latestSafetyClassificationReviewByRowId,
  normalizeReviewedHazardRowForPersistence,
  reconcileRegeneratedGuidePhraseReview,
  reconcileRegeneratedSafetySignificanceReview,
  preserveRegeneratedRowIdentity,
  restoreReviewedGuidePhraseDecisions,
} from "./hazardRegenerationReview";

const persistenceFields = (headers, row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]));

const persistenceHeaders = [
  "Raw Analysis Row ID", "Source ID", "Review Session ID", "Reviewer Name", "Reviewed At",
  "Guide Phrase", "Guide Phrase Applicable", "Loss", "Hazard", "Canonical Loss ID", "Canonical Hazard ID",
  "Causal Scenario", "Mitigation Strategy", "System Requirement", "Verification Method",
  "Safety Classification", "Safety Classification Rule", "Causal Path Type",
  "Intermediate Safety Function", "Intermediate Safety Effect", "Protection Assessment", "Protection Status",
  "Classification Evidence", "Safety Significant", "Safety Significance Rationale", "Classification Resolution Status",
];

const governedReview = (decision, row) => ({
  reviewedAt: "2026-09-18T13:00:00Z",
  currentContent: { columns: persistenceHeaders, row },
  vibeReview: { decision, reviewerName: "Nick", reviewTarget: "safetySignificant" },
});

const rationaleHeaders = [
  "Raw Analysis Row ID", "Source ID", "Review Session ID", "Reviewer Name", "Reviewed At",
  "Guide Phrase Applicable", "Safety Classification", "Safety Classification Rule", "Causal Path Type",
  "Causal Effect", "Resulting System State", "Intermediate Safety Function", "Intermediate Safety Effect",
  "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination", "Classification Evidence",
  "Safety Significant", "Safety Significance Rationale", "Classification Resolution Status",
];

const rationaleRow = (fields = {}) => rationaleHeaders.map((header) => fields[header] || "");
const rationaleReview = (decision, row, extras = {}) => ({
  reviewedAt: "2026-09-18T13:00:00Z",
  originalContent: { columns: rationaleHeaders, row: [...row] },
  currentContent: { columns: rationaleHeaders, row },
  vibeReview: { decision, reviewerName: "Nick", reviewTarget: "safetySignificant", ...extras },
});

test("final persistence replaces stale governed-No rationale with the regenerated mission boundary", () => {
  const staleRationale = "Needs review: Mission/Reliability contradicts an asserted L1-L3 or physical-harm path. Needs review: could not be validated.";
  const source = rationaleRow({
    "Raw Analysis Row ID": "RAW-AWARENESS", "Source ID": "SRC-A", "Review Session ID": "SESSION-A",
    "Reviewer Name": "Nick", "Reviewed At": "2026-09-18T13:00:00Z", "Guide Phrase Applicable": "Yes",
    "Safety Significant": "No", "Safety Significance Rationale": staleRationale,
  });
  const generated = rationaleRow({
    "Raw Analysis Row ID": "changed", "Source ID": "changed", "Review Session ID": "changed",
    "Reviewer Name": "changed", "Reviewed At": "changed", "Guide Phrase Applicable": "Yes",
    "Safety Classification": "Mission/Reliability", "Safety Classification Rule": "M1", "Causal Path Type": "None",
    "Causal Effect": "stale fleet awareness", "Resulting System State": "operators see delayed fleet status",
    "Physical-Harm Chain Termination": "stale fleet and operational awareness",
    "Safety Significant": "Needs Review", "Safety Significance Rationale": staleRationale,
  });
  const reviewItem = rationaleReview("No", source);
  const beforeSnapshot = JSON.stringify(reviewItem);
  const fields = persistenceFields(rationaleHeaders, normalizeReviewedHazardRowForPersistence({
    headers: rationaleHeaders, sourceRow: source, regeneratedRow: generated, safetySignificanceReviewItem: reviewItem,
  }).row);
  expect(fields["Safety Significance Rationale"]).toMatch(/No reviewer rationale was supplied/i);
  expect(fields["Safety Significance Rationale"]).toMatch(/stale fleet and operational awareness/i);
  expect(fields["Safety Significance Rationale"]).toMatch(/no documented propagation into vehicle control or physical harm/i);
  expect(fields["Safety Significance Rationale"]).not.toMatch(/needs? review|could not be validated|contradict/i);
  expect(fields["Classification Resolution Status"]).toBe("Human Disposition — Evidence Gap");
  expect(fields).toMatchObject({
    "Raw Analysis Row ID": "RAW-AWARENESS", "Source ID": "SRC-A", "Review Session ID": "SESSION-A",
    "Reviewer Name": "Nick", "Reviewed At": "2026-09-18T13:00:00Z", "Safety Significant": "No",
  });
  expect(JSON.stringify(reviewItem)).toBe(beforeSnapshot);
  expect(reviewItem.originalContent.row[rationaleHeaders.indexOf("Safety Significance Rationale")]).toBe(staleRationale);
  expect(reviewItem.currentContent.row[rationaleHeaders.indexOf("Safety Significance Rationale")]).toBe(staleRationale);
});

test("final persistence keeps supplied reviewer rationale authoritative and adds concise regenerated context", () => {
  const source = rationaleRow({ "Guide Phrase Applicable": "Yes", "Safety Significant": "No", "Safety Significance Rationale": "Reviewer confirmed this output is advisory only." });
  const generated = rationaleRow({
    "Guide Phrase Applicable": "Yes", "Safety Significant": "Needs Review", "Causal Effect": "delayed dashboard awareness",
    "Physical-Harm Chain Termination": "the advisory dashboard", "Safety Significance Rationale": "Needs review: old contradiction.",
  });
  const fields = persistenceFields(rationaleHeaders, normalizeReviewedHazardRowForPersistence({
    headers: rationaleHeaders, sourceRow: source, regeneratedRow: generated,
    safetySignificanceReviewItem: rationaleReview("No", source),
  }).row);
  expect(fields["Safety Significance Rationale"]).toMatch(/Reviewer rationale: Reviewer confirmed this output is advisory only\./);
  expect(fields["Safety Significance Rationale"]).toMatch(/terminates at the advisory dashboard/i);
  expect(fields["Safety Significance Rationale"]).not.toMatch(/needs? review|old contradiction/i);
});

test.each([
  ["Safety — Direct", "", "", "Direct", /Safety — Direct with a direct physical-harm path/i],
  ["Safety — Related", "Safe motion authorization", "Delayed intervention", "Contributory", /Safety — Related with a contributory path through Safe motion authorization/i],
])("final persistence gives governed Yes a clean %s rationale", (classification, intermediateFunction, intermediateEffect, causalPath, expected) => {
  const source = rationaleRow({ "Guide Phrase Applicable": "Yes", "Safety Significant": "Yes", "Safety Significance Rationale": "Needs review: could not be validated." });
  const generated = rationaleRow({
    "Guide Phrase Applicable": "Yes", "Safety Significant": "Needs Review", "Safety Classification": classification,
    "Intermediate Safety Function": intermediateFunction, "Intermediate Safety Effect": intermediateEffect,
    "Protection Assessment": "Independence is not documented", "Protection Status": "Unknown",
    "Safety Significance Rationale": "Uncertain; needs review.",
  });
  const fields = persistenceFields(rationaleHeaders, normalizeReviewedHazardRowForPersistence({
    headers: rationaleHeaders, sourceRow: source, regeneratedRow: generated,
    safetySignificanceReviewItem: rationaleReview("Yes", source),
  }).row);
  expect(fields["Safety Significance Rationale"]).toMatch(expected);
  expect(fields["Safety Significance Rationale"]).toMatch(/Protection status remains Unknown.*does not reverse the governed Yes decision/i);
  expect(fields["Safety Significance Rationale"]).not.toMatch(/needs? review|could not be validated|uncertain/i);
  expect(fields["Causal Path Type"]).toBe(causalPath);
  expect(fields["Protection Status"]).toBe("Unknown");
  expect(fields["Protection Assessment"]).toBe("Independence is not documented");
});

test("final persistence normalizer repairs the supplied reviewed collision pattern without erasing an unknown safeguard", () => {
  const source = [
    "RAW-77", "SRC-4", "SESSION-9", "Nick", "2026-09-18T13:00:00Z", "Too late", "Yes",
    "Property damage from collision", "Vehicle collision", "MISSION-4", "MR-8",
    "Late braking creates unsafe proximity and collision exposure", "Monitor latency", "The controller shall report latency", "Test",
    "Needs Review", "U4", "Uncertain", "", "", "No confirmed independent safeguard", "Unknown",
    "Collision and property-damage causal path is documented.", "Yes", "Reviewed collision path.", "Needs Review",
  ];
  const generated = source.map((value, index) => index === persistenceHeaders.indexOf("Safety Significant") ? "Needs Review" : value);
  const result = normalizeReviewedHazardRowForPersistence({
    headers: persistenceHeaders,
    sourceRow: source,
    regeneratedRow: generated,
    safetySignificanceReviewItem: governedReview("Yes", source),
  }).row;
  const fields = persistenceFields(persistenceHeaders, result);
  expect(fields["Safety Classification"]).toBe("Safety — Direct");
  expect(fields["Safety Classification Rule"]).toMatch(/^D/);
  expect(fields["Causal Path Type"]).toBe("Direct");
  expect(fields["Canonical Loss ID"]).toBe("");
  expect(fields["Canonical Hazard ID"]).toBe("");
  expect(fields["Protection Status"]).toBe("Unknown");
  expect(fields["Protection Assessment"]).toBe("No confirmed independent safeguard");
  expect(fields["Classification Resolution Status"]).not.toBe("Needs Review");
});

test("final persistence normalizer selects Related only for a substantive intermediate chain", () => {
  const direct = Array(persistenceHeaders.length).fill("");
  Object.assign(direct, { 0: "RAW-1", 6: "Yes", 23: "Yes" });
  const related = [...direct];
  related[persistenceHeaders.indexOf("Intermediate Safety Function")] = "Trajectory planner safe-envelope contribution";
  related[persistenceHeaders.indexOf("Intermediate Safety Effect")] = "An unsafe trajectory reaches the motion controller";
  const normalize = (row) => persistenceFields(persistenceHeaders, normalizeReviewedHazardRowForPersistence({
    headers: persistenceHeaders, sourceRow: row, regeneratedRow: row,
    safetySignificanceReviewItem: governedReview("Yes", row),
  }).row);
  expect(normalize(direct)["Safety Classification"]).toBe("Safety — Direct");
  expect(normalize(related)).toMatchObject({
    "Safety Classification": "Safety — Related",
    "Safety Classification Rule": "R1",
    "Causal Path Type": "Contributory",
  });
});

test("final persistence normalizer preserves provenance and engineering controls for governed No", () => {
  const source = [
    "RAW-2", "SRC-2", "SESSION-2", "Nick", "2026-09-18T14:00:00Z", "Too late", "Yes",
    "Property damage", "Collision", "L-2", "H-2", "Delay causes collision", "Retain telemetry", "The service shall log delay", "Inspection",
    "Safety — Direct", "D1", "Direct", "Brake intervention", "Avoid collision", "Unknown", "Unknown", "Collision path", "No", "Human disposition", "Needs Review",
  ];
  const generated = source.map((value, index) => index < 5 ? `changed-${index}` : value);
  const fields = persistenceFields(persistenceHeaders, normalizeReviewedHazardRowForPersistence({
    headers: persistenceHeaders, sourceRow: source, regeneratedRow: generated,
    safetySignificanceReviewItem: governedReview("No", source),
  }).row);
  expect(fields).toMatchObject({
    "Raw Analysis Row ID": "RAW-2", "Source ID": "SRC-2", "Review Session ID": "SESSION-2",
    "Reviewer Name": "Nick", "Reviewed At": "2026-09-18T14:00:00Z",
    "Safety Classification": "Mission/Reliability", "Causal Path Type": "None",
    "Mitigation Strategy": "Retain telemetry", "System Requirement": "The service shall log delay", "Verification Method": "Inspection",
  });
  expect(fields.Loss).not.toMatch(/property damage/i);
  expect(fields.Hazard).not.toMatch(/collision/i);
  expect(fields["Canonical Loss ID"]).toBe("");
  expect(fields["Canonical Hazard ID"]).toBe("");
  expect(fields["Classification Resolution Status"]).not.toBe("Needs Review");
});

test("final persistence normalizer applies the existing Not Applicable policy for governed applicability No", () => {
  const source = Array(persistenceHeaders.length).fill("");
  source[persistenceHeaders.indexOf("Raw Analysis Row ID")] = "RAW-NA";
  source[persistenceHeaders.indexOf("Guide Phrase")] = "Too late";
  source[persistenceHeaders.indexOf("Guide Phrase Applicable")] = "No";
  const applicabilityReview = {
    currentContent: { columns: persistenceHeaders, row: source },
    vibeReview: { decision: "No", reviewerName: "Nick", reviewTarget: "guidePhraseApplicable" },
  };
  const generated = [...source];
  generated[persistenceHeaders.indexOf("Guide Phrase Applicable")] = "Yes";
  generated[persistenceHeaders.indexOf("Hazard")] = "Collision";
  generated[persistenceHeaders.indexOf("Safety Classification")] = "Safety — Direct";
  const fields = persistenceFields(persistenceHeaders, normalizeReviewedHazardRowForPersistence({
    headers: persistenceHeaders, sourceRow: source, previousRow: source, currentBasisRow: source,
    regeneratedRow: generated, guidePhraseReviewItem: applicabilityReview,
  }).row);
  expect(fields["Guide Phrase Applicable"]).toBe("No");
  expect(fields.Hazard).toBe("Not Applicable");
  expect(fields["Safety Classification"]).toBe("Not Applicable");
  expect(fields["Causal Path Type"]).toBe("None");
});

test("builds full-row regeneration evidence that treats stale uncertainty as recomputable", () => {
  const context = buildReviewedRowRegenerationContext({
    headers: ["Raw Analysis Row ID", "Safety Classification", "Protection Status", "Hazard"],
    row: ["RAW-1", "Needs Review", "Unknown", "Collision with an adjacent vehicle"],
    reviewTarget: "Safety Significant",
    decision: "Yes",
  });
  expect(context).toMatch(/human-reviewed Safety Significant is Yes and is authoritative/i);
  expect(context).toMatch(/regenerate the entire derived hazard-analysis row/i);
  expect(context).toMatch(/Do not preserve blank, Unknown, Undetermined, Needs Review/i);
  expect(context).toContain('"Raw Analysis Row ID": "RAW-1"');
  expect(context).toContain('"Hazard": "Collision with an adjacent vehicle"');
});

test("preserves source identity and context while allowing derived fields to regenerate", () => {
  const identityHeaders = [
    "Raw Analysis Row ID", "Function (From)", "Control Action", "Function (To)",
    "Operational Scenario", "Guide Phrase", "Hazard", "Safety Classification",
  ];
  const result = preserveRegeneratedRowIdentity({
    headers: identityHeaders,
    sourceRow: ["RAW-1", "Monitor Health", "Health Status", "Manage Readiness", "Change lanes", "Stopped too soon", "Old hazard", "Needs Review"],
    regeneratedRow: ["RAW-NEW", "Changed source", "Changed action", "Changed target", "Changed context", "Too late", "New coherent hazard", "Safety — Related"],
  });
  expect(result).toEqual([
    "RAW-1", "Monitor Health", "Health Status", "Manage Readiness", "Change lanes", "Stopped too soon", "New coherent hazard", "Safety — Related",
  ]);
});

const headers = [
  "Raw Analysis Row ID", "Function (From)", "Control Action", "Function (To)",
  "Operational Scenario", "Guide Phrase", "Guide Phrase Applicable",
  "Guide Phrase Applicability Rationale", "Hazard",
];

const reviewedItem = {
  projectId: "project-1",
  reviewedAt: "2026-09-18T12:00:00Z",
  currentContent: { columns: headers, row: ["RAW-1", "A", "Command", "B", "Nominal", "Too late", "Yes", "Reviewed rationale", "Old hazard"] },
  vibeReview: { domain: "hazard-analysis", reviewTarget: "guidePhraseApplicable", rowId: "RAW-1", decision: "Yes", reviewerName: "Nick" },
};

test("preserves a reviewed applicability decision when only generated hazard content changes", () => {
  const result = reconcileRegeneratedGuidePhraseReview({
    headers,
    previousRow: reviewedItem.currentContent.row,
    currentBasisRow: reviewedItem.currentContent.row,
    regeneratedRow: ["RAW-1", "A", "Command", "B", "Nominal", "Too late", "Needs Review", "Generated rationale", "New hazard"],
    reviewItem: reviewedItem,
  });
  expect(result.status).toBe("preserved");
  expect(result.row[6]).toBe("Yes");
  expect(result.row[7]).toBe("Reviewed rationale");
  expect(result.row[8]).toBe("New hazard");
});

test("reopens review when the applicability decision basis changes", () => {
  const result = reconcileRegeneratedGuidePhraseReview({
    headers,
    previousRow: reviewedItem.currentContent.row,
    currentBasisRow: ["RAW-1", "A", "Different command", "B", "Nominal", "Too late", "", "", ""],
    regeneratedRow: ["RAW-1", "A", "Different command", "B", "Nominal", "Too late", "Yes", "Generated rationale", "New hazard"],
    reviewItem: reviewedItem,
  });
  expect(result.status).toBe("basis-changed");
  expect(result.changedBasisFields).toEqual(["Control Action"]);
  expect(result.row[6]).toBe("Needs Review");
  expect(result.row[7]).toContain("Control Action");
});

test("indexes only definitive guide-phrase reviews for the active project", () => {
  const map = latestGuidePhraseReviewByRowId([
    reviewedItem,
    { ...reviewedItem, projectId: "project-2", vibeReview: { ...reviewedItem.vibeReview, rowId: "RAW-2" } },
    { ...reviewedItem, vibeReview: { ...reviewedItem.vibeReview, rowId: "RAW-3", decision: "Needs Review" } },
  ], "project-1");
  expect([...map.keys()]).toEqual(["RAW-1"]);
});

test("uses the persisted vibe-review audit and honors a later undo", () => {
  const applied = {
    projectId: "project-1",
    sourceRowId: "RAW-AUDIT",
    reviewTarget: "guidePhraseApplicable",
    newReviewValue: "Yes",
    headers,
    nextRow: ["RAW-AUDIT", "A", "Command", "B", "Nominal", "Too late", "Yes", "Audit rationale", "Hazard"],
    timestamp: "2026-09-18T12:00:00Z",
  };
  expect(latestGuidePhraseReviewByRowId([], "project-1", [applied]).get("RAW-AUDIT")?.vibeReview?.decision).toBe("Yes");
  expect(latestGuidePhraseReviewByRowId([], "project-1", [
    applied,
    { projectId: "project-1", sourceRowId: "RAW-AUDIT", action: "undo", timestamp: "2026-09-18T12:01:00Z" },
  ]).has("RAW-AUDIT")).toBe(false);
});

test("repairs an already reverted summary row from its review evidence", () => {
  const reverted = ["RAW-1", "A", "Command", "B", "Nominal", "Too late", "Needs Review", "Generated rationale", "New hazard"];
  const result = restoreReviewedGuidePhraseDecisions([headers, reverted], new Map([["RAW-1", reviewedItem]]));
  expect(result.changed).toBe(true);
  expect(result.restoredRowIds).toEqual(["RAW-1"]);
  expect(result.summary[1][6]).toBe("Yes");
  expect(result.summary[1][7]).toBe("Reviewed rationale");
});

test("injects the reviewed applicability into the regeneration input", () => {
  const input = applyReviewedApplicabilityToGenerationInput({
    headers,
    previousRow: reviewedItem.currentContent.row,
    currentBasisRow: reviewedItem.currentContent.row,
    reviewItem: reviewedItem,
    functionalRow: { fromFunction: "A", guidePhraseApplicable: "Needs Review" },
  });
  expect(input.reconciliation.status).toBe("preserved");
  expect(input.functionalRow.guidePhraseApplicable).toBe("Yes");
  expect(input.functionalRow.guidePhraseApplicabilityRationale).toBe("Reviewed rationale");
  expect(input.functionalRow.guidePhraseApplicabilityReviewStatus).toBe("Reviewed");
});

test("injects and preserves a reviewed safety-significance decision during regeneration", () => {
  const safetyHeaders = [
    ...headers,
    "Safety Significant",
    "Safety Significance Rationale",
    "Safety Classification",
    "Safety Classification Rule",
    "Causal Path Type",
    "Intermediate Safety Function",
    "Intermediate Safety Effect",
  ];
  const safetyItem = {
    projectId: "project-1",
    reviewedAt: "2026-09-18T13:00:00Z",
    currentContent: {
      columns: safetyHeaders,
      row: [...reviewedItem.currentContent.row, "No", "Reviewer found no supported physical-harm path.", "Needs Review", "U2", "Uncertain", "Fleet intervention", "Delayed response"],
    },
    vibeReview: { domain: "hazard-analysis", reviewTarget: "safetySignificant", rowId: "RAW-1", decision: "No", reviewerName: "Nick" },
  };
  const input = applyReviewedSafetySignificanceToGenerationInput({
    headers: safetyHeaders,
    reviewItem: safetyItem,
    functionalRow: { fromFunction: "A" },
  });
  expect(input.functionalRow).toMatchObject({
    safetySignificant: "No",
    safetySignificanceRationale: "Reviewer found no supported physical-harm path.",
    safetySignificanceReviewStatus: "Reviewed",
  });
  const regenerated = reconcileRegeneratedSafetySignificanceReview({
    headers: safetyHeaders,
    regeneratedRow: [...reviewedItem.currentContent.row, "Needs Review", "Generated rationale", "Needs Review", "U2", "Uncertain", "Fleet intervention", "Delayed response"],
    reviewItem: safetyItem,
  });
  expect(regenerated.status).toBe("preserved");
  expect(regenerated.row[safetyHeaders.indexOf("Safety Significant")]).toBe("No");
  expect(regenerated.row[safetyHeaders.indexOf("Safety Significance Rationale")]).toBe("Reviewer found no supported physical-harm path.");
  expect(regenerated.row[safetyHeaders.indexOf("Safety Classification")]).toBe("Mission/Reliability");
  expect(regenerated.row[safetyHeaders.indexOf("Safety Classification Rule")]).toBe("M1");
  expect(regenerated.row[safetyHeaders.indexOf("Causal Path Type")]).toBe("None");
  expect(regenerated.row[safetyHeaders.indexOf("Intermediate Safety Function")]).toBe("Not Applicable");
  expect(regenerated.row[safetyHeaders.indexOf("Intermediate Safety Effect")]).toBe("Not Applicable");
  expect(latestSafetySignificanceReviewByRowId([safetyItem], "project-1").get("RAW-1")).toBe(safetyItem);
});

test("reconciles a reviewed Yes with a canonical safety classification", () => {
  const safetyHeaders = [
    ...headers,
    "Safety Significant",
    "Safety Significance Rationale",
    "Safety Classification",
    "Safety Classification Rule",
    "Causal Path Type",
  ];
  const reviewItem = {
    reviewedAt: "2026-09-18T13:00:00Z",
    vibeReview: { decision: "Yes", reviewerName: "Nick" },
  };
  const regenerated = reconcileRegeneratedSafetySignificanceReview({
    headers: safetyHeaders,
    regeneratedRow: [...reviewedItem.currentContent.row, "Needs Review", "Generated rationale", "Needs Review", "U2", "Uncertain"],
    reviewItem,
  });
  expect(regenerated.row[safetyHeaders.indexOf("Safety Significant")]).toBe("Yes");
  expect(regenerated.row[safetyHeaders.indexOf("Safety Classification")]).toBe("Safety — Direct");
  expect(regenerated.row[safetyHeaders.indexOf("Safety Classification Rule")]).toBe("D1");
  expect(regenerated.row[safetyHeaders.indexOf("Causal Path Type")]).toBe("Direct");
});

test("reviewed No removes stale physical-harm claims without making an applicable row wholly Not Applicable", () => {
  const safetyHeaders = [
    "Raw Analysis Row ID", "Guide Phrase", "Guide Phrase Applicable", "Loss", "Hazard",
    "Causal Scenario", "Causal Effect", "Resulting System State", "Mitigation Strategy",
    "System Requirement", "Verification Method", "Safety Classification",
    "Safety Classification Rule", "Causal Path Type", "Intermediate Safety Function",
    "Intermediate Safety Effect", "Protection Assessment", "Protection Status",
    "Physical-Harm Chain Termination", "Classification Evidence", "Classification Confidence",
    "Safety Significant", "Safety Significance Rationale",
  ];
  const row = [
    "RAW-1", "Too late", "Yes", "Property damage from collision", "Vehicle collision",
    "Late command causes a crash", "Loss of separation", "Unsafe proximity", "Log degraded service",
    "Record command latency", "Review event log", "Needs Review", "U4", "Uncertain",
    "Fleet intervention", "Delayed response", "Unknown", "Unknown", "Uncertain", "Collision evidence",
    "Uncertain", "Needs Review", "old rationale",
  ];
  const reviewItem = {
    currentContent: { columns: safetyHeaders, row: row.map((value, index) => index === safetyHeaders.indexOf("Safety Significant") ? "No" : value) },
    vibeReview: { decision: "No" },
  };
  const result = reconcileRegeneratedSafetySignificanceReview({ headers: safetyHeaders, regeneratedRow: row, reviewItem }).row;
  const fields = Object.fromEntries(safetyHeaders.map((header, index) => [header, result[index]]));
  expect(fields["Safety Classification"]).toBe("Mission/Reliability");
  expect(fields["Safety Classification Rule"]).toBe("M1");
  expect(fields["Causal Path Type"]).toBe("None");
  expect(fields.Loss).not.toMatch(/collision|property damage/i);
  expect(fields.Hazard).not.toMatch(/collision/i);
  expect(fields["Intermediate Safety Function"]).toBe("Not Applicable");
  expect(fields["Mitigation Strategy"]).toBe("Log degraded service");
  expect(fields["System Requirement"]).toBe("Record command latency");
});

test("reviewed Yes remains a coherent safety subtype when protection status is Unknown", () => {
  const safetyHeaders = [
    "Guide Phrase Applicable", "Safety Classification", "Safety Classification Rule", "Causal Path Type",
    "Intermediate Safety Function", "Intermediate Safety Effect", "Protection Status", "Safety Significant",
  ];
  const reviewItem = { vibeReview: { decision: "Yes" } };
  const result = reconcileRegeneratedSafetySignificanceReview({
    headers: safetyHeaders,
    regeneratedRow: ["Yes", "Needs Review", "U4", "Uncertain", "", "", "Unknown", "Needs Review"],
    reviewItem,
  }).row;
  expect(result[safetyHeaders.indexOf("Safety Classification")]).toBe("Safety — Direct");
  expect(result[safetyHeaders.indexOf("Safety Classification Rule")]).toMatch(/^D/);
  expect(result[safetyHeaders.indexOf("Causal Path Type")]).toBe("Direct");
  expect(result[safetyHeaders.indexOf("Protection Status")]).toBe("Unknown");
});

test("applicability No makes all derived fields coherently Not Applicable while preserving identity and rationale", () => {
  const applicabilityHeaders = [
    "Raw Analysis Row ID", "Function (From)", "Guide Phrase", "Guide Phrase Applicable",
    "Guide Phrase Applicability Rationale", "Hazard", "Safety Classification",
    "Safety Classification Rule", "Causal Path Type", "Safety Significant",
  ];
  const reviewItem = {
    currentContent: { columns: applicabilityHeaders, row: ["RAW-9", "A", "Too late", "No", "Receiver is unaffected.", "old collision", "Needs Review", "U4", "Uncertain", "Needs Review"] },
    vibeReview: { decision: "No" },
  };
  const result = reconcileRegeneratedGuidePhraseReview({
    headers: applicabilityHeaders,
    previousRow: reviewItem.currentContent.row,
    currentBasisRow: reviewItem.currentContent.row,
    regeneratedRow: ["CHANGED", "Changed", "Wrong", "Yes", "generated", "collision", "Safety — Direct", "D1", "Direct", "Yes"],
    reviewItem,
  }).row;
  expect(result[0]).toBe("CHANGED");
  expect(result[3]).toBe("No");
  expect(result[4]).toBe("Receiver is unaffected.");
  expect(result[5]).toBe("Not Applicable");
  expect(result[6]).toBe("Not Applicable");
  expect(result[7]).toBe("N4");
  expect(result[8]).toBe("None");
  expect(result[9]).toBe("Not Applicable");
});

test("classification review lookup and final normalizer preserve all governed layers", () => {
  const headers = ["Raw Analysis Row ID", "Guide Phrase Applicable", "Guide Phrase Applicability Rationale", "Safety Significant", "Safety Significance Rationale", "Safety Classification", "Safety Classification Rule", "Causal Path Type", "Classification Evidence", "Classification Confidence"];
  const reviewed = ["RAW-C", "Yes", "app bytes", "No", "significance bytes", "Mission/Reliability", "M2", "None", "reviewed classification rationale", "High"];
  const item = { projectId: "project-1", reviewedAt: "2026-09-18T12:00:00Z", currentContent: { rowId: "RAW-C", columns: headers, row: reviewed }, vibeReview: { domain: "hazard-analysis", reviewTarget: "safetyClassification", rowId: "RAW-C", decision: "Mission/Reliability", reviewerName: "Nick" } };
  expect(latestSafetyClassificationReviewByRowId([item], "project-1").get("RAW-C")).toBe(item);
  const generated = ["RAW-C", "Yes", "app bytes", "No", "significance bytes", "Safety — Direct", "D1", "Direct", "generated overwrite", "Low"];
  const result = normalizeReviewedHazardRowForPersistence({ headers, sourceRow: reviewed, regeneratedRow: generated, safetyClassificationReviewItem: item });
  expect(result.row[headers.indexOf("Guide Phrase Applicable")]).toBe("Yes");
  expect(result.row[headers.indexOf("Guide Phrase Applicability Rationale")]).toBe("app bytes");
  expect(result.row[headers.indexOf("Safety Significant")]).toBe("No");
  expect(result.row[headers.indexOf("Safety Significance Rationale")]).toBe("significance bytes");
  expect(result.row[headers.indexOf("Safety Classification")]).toBe("Mission/Reliability");
  expect(result.row[headers.indexOf("Safety Classification Rule")]).toBe("M2");
  expect(result.row[headers.indexOf("Classification Evidence")]).toBe("reviewed classification rationale");
});

test("locked Mission/Reliability classification removes regenerated physical-harm contradictions", () => {
  const headers = [
    "Raw Analysis Row ID", "Function (To)", "Guide Phrase Applicable", "Loss", "Hazard",
    "Raw Loss Candidate", "Raw Hazard Candidate", "Canonical Loss ID", "Canonical Hazard ID",
    "Unsafe Control Action", "Causal Scenario", "Causal Factor", "Causal Effect",
    "Resulting System State", "Intermediate Safety Function", "Intermediate Safety Effect",
    "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination",
    "Safety Classification", "Safety Classification Rule", "Causal Path Type",
    "Classification Evidence", "Classification Confidence", "Safety Significant",
    "Safety Significance Rationale", "Classification Resolution Status",
  ];
  const reviewed = [
    "RAW-0D1MMKU", "Report Vehicle Status", "Yes", "old", "old", "old", "old", "L2", "H-1",
    "old", "old", "old", "Superseded status reaches fleet supervision.",
    "Fleet supervision displays an out-of-sequence vehicle status.", "", "", "", "Absent",
    "Terminates at the fleet display; no vehicle-control authority is documented.",
    "Mission/Reliability", "M1", "None",
    "Report Vehicle Status has no documented control authority back to motion execution.", "Medium", "No", "", "Needs Review",
  ];
  const item = {
    currentContent: { columns: headers, row: reviewed },
    vibeReview: { decision: "Mission/Reliability", reviewTarget: "safetyClassification" },
  };
  const generated = [...reviewed];
  generated[headers.indexOf("Loss")] = "Potential collision and injury.";
  generated[headers.indexOf("Hazard")] = "Unsafe vehicle state causing collision.";
  generated[headers.indexOf("Raw Loss Candidate")] = "Property damage.";
  generated[headers.indexOf("Raw Hazard Candidate")] = "Collision risk.";
  generated[headers.indexOf("Canonical Loss ID")] = "L2";
  generated[headers.indexOf("Canonical Hazard ID")] = "H-INVALID_STATE";
  generated[headers.indexOf("Safety Classification")] = "Safety — Direct";
  generated[headers.indexOf("Safety Significant")] = "Yes";
  generated[headers.indexOf("Causal Path Type")] = "Direct";

  const result = normalizeReviewedHazardRowForPersistence({
    headers, sourceRow: reviewed, regeneratedRow: generated, safetyClassificationReviewItem: item,
  }).row;
  const fields = persistenceFields(headers, result);
  expect(fields["Safety Classification"]).toBe("Mission/Reliability");
  expect(fields["Safety Significant"]).toBe("No");
  expect(fields["Causal Path Type"]).toBe("None");
  expect(fields["Protection Status"]).toBe("Not Applicable");
  expect(fields["Canonical Loss ID"]).toBe("");
  expect(fields["Canonical Hazard ID"]).toBe("");
  expect(`${fields.Loss} ${fields.Hazard} ${fields["Raw Loss Candidate"]} ${fields["Raw Hazard Candidate"]}`)
    .not.toMatch(/collision|injury|property damage/i);
  expect(fields["Classification Resolution Status"]).not.toBe("Needs Review");
});
