/**
 * The hazard import merges by Raw Analysis Row ID rather than replacing the
 * table, because Export CSV writes only the *visible* rows and because row IDs
 * are the addresses reviews and audit records use. These cover both: a filtered
 * export must not delete what it did not contain, and a file naming an unknown
 * row must be refused rather than appended.
 */

import {
  applyHazardAnalysisCsvImport,
  applyHazardCsvImportToDrafts,
  describeHazardCsvPlan,
  describeHazardCsvProblems,
  planHazardAnalysisCsvImport,
} from "./hazardAnalysisCsv";
import { toCsvText } from "../../lib/csv";

const HEADERS = [
  "Raw Analysis Row ID",
  "Unsafe Control Action",
  "Causal Scenario",
  "Safety Classification",
  "Safety Significant",
  "Safety Significance Rationale",
];

const summary = () => [
  [...HEADERS],
  ["RAW-1", "Command issued too late", "Latency in the planner", "Safety — Direct", "Yes", "Credited in the design review."],
  ["RAW-2", "Command not issued", "Watchdog masked the fault", "Mission/Reliability", "No", "No causal path to harm."],
  ["RAW-3", "Command issued out of order", "Queue reordering", "Needs Review", "Needs Review", "Needs review."],
];

const csv = (rows) => toCsvText(rows);

describe("planHazardAnalysisCsvImport", () => {
  it("changes only the cells that actually differ", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Causal Scenario"],
      ["RAW-1", "Latency in the planner"],
      ["RAW-2", "Watchdog masked the fault and the retry path"],
    ]));

    expect(plan.errors).toEqual([]);
    expect(plan.changedRowCount).toBe(1);
    expect(plan.unchangedRowCount).toBe(1);
    expect(plan.changedColumns).toEqual(["Causal Scenario"]);
    expect(plan.updates[0].rowId).toBe("RAW-2");
  });

  it("leaves rows a filtered export omitted alone", () => {
    // The live defect this prevents: Export CSV writes the visible rows, so a
    // replace-style import would delete the other 2 rows outright.
    const original = summary();
    const plan = planHazardAnalysisCsvImport(original, csv([
      ["Raw Analysis Row ID", "Safety Significant"],
      ["RAW-3", "No"],
    ]));
    const merged = applyHazardAnalysisCsvImport(original, plan.updates);

    expect(merged).toHaveLength(4);
    expect(merged[1]).toEqual(original[1]);
    expect(merged[2]).toEqual(original[2]);
    expect(merged[3][4]).toBe("No");
  });

  it("leaves columns the file omitted alone", () => {
    const original = summary();
    const plan = planHazardAnalysisCsvImport(original, csv([
      ["Raw Analysis Row ID", "Causal Scenario"],
      ["RAW-1", "A revised scenario"],
    ]));
    const merged = applyHazardAnalysisCsvImport(original, plan.updates);

    expect(merged[1][2]).toBe("A revised scenario");
    expect(merged[1][3]).toBe("Safety — Direct");
    expect(merged[1][5]).toBe("Credited in the design review.");
  });

  it("refuses a row this analysis does not have", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Causal Scenario"],
      ["RAW-9", "Invented in a spreadsheet"],
    ]));

    expect(plan.updates).toEqual([]);
    expect(plan.errors[0]).toContain("RAW-9");
    expect(plan.errors[0]).toContain("Include unchanged interface and context columns");
  });

  it("refuses a duplicated or missing row ID", () => {
    const duplicate = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Causal Scenario"],
      ["RAW-1", "One"],
      ["RAW-1", "Two"],
    ]));
    expect(duplicate.errors[0]).toContain("repeats Raw Analysis Row ID RAW-1 from line 2");

    const missing = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Causal Scenario"],
      ["", "Orphan"],
    ]));
    expect(missing.errors[0]).toContain("no matching row");
  });

  it("refuses a file with no row ID column", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["Unsafe Control Action", "Causal Scenario"],
      ["Command issued too late", "Something else"],
    ]));
    expect(plan.errors[0]).toContain("Raw Analysis Row ID");
  });

  it("refuses an empty file and an analysis with no table", () => {
    expect(planHazardAnalysisCsvImport(summary(), "").errors).toEqual(["The file is empty."]);
    expect(planHazardAnalysisCsvImport([], csv([["Raw Analysis Row ID"]])).errors)
      .toEqual(["This project has no hazard analysis table to merge into."]);
  });

  it("reports columns the analysis does not have instead of writing them", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Causal Scenario", "Reviewer Notes"],
      ["RAW-1", "A revised scenario", "Checked with the mechanical team"],
    ]));

    expect(plan.errors).toEqual([]);
    expect(plan.unknownColumns).toEqual(["Reviewer Notes"]);
    expect(plan.changedColumns).toEqual(["Causal Scenario"]);
  });

  it("names the governed columns an import would overwrite", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Safety Significant", "Safety Significance Rationale"],
      ["RAW-1", "No", "Reconsidered against the protection independence evidence."],
    ]));

    expect(plan.governedColumns).toEqual(["Safety Significant", "Safety Significance Rationale"]);
  });

  it("surfaces a significance the merged classification contradicts, without rewriting it", () => {
    const original = summary();
    const plan = planHazardAnalysisCsvImport(original, csv([
      ["Raw Analysis Row ID", "Safety Classification"],
      ["RAW-2", "Safety — Direct"],
    ]));
    const merged = applyHazardAnalysisCsvImport(original, plan.updates);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toContain("RAW-2");
    expect(plan.conflicts[0]).toContain("Safety Significant = No");
    // Neither value is altered automatically.
    expect(merged[2][4]).toBe("No");
    expect(merged[2][3]).toBe("Safety — Direct");
  });

  it("matches headers regardless of case and punctuation", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["raw analysis row id", "CAUSAL SCENARIO"],
      ["RAW-1", "Rewritten"],
    ]));

    expect(plan.errors).toEqual([]);
    expect(plan.changedColumns).toEqual(["Causal Scenario"]);
  });
});

describe("applyHazardAnalysisCsvImport", () => {
  it("does not mutate the analysis it was given", () => {
    const original = summary();
    const snapshot = JSON.stringify(original);
    const plan = planHazardAnalysisCsvImport(original, csv([
      ["Raw Analysis Row ID", "Causal Scenario"],
      ["RAW-1", "Rewritten"],
    ]));

    applyHazardAnalysisCsvImport(original, plan.updates);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("returns the same table when there is nothing to apply", () => {
    const original = summary();
    expect(applyHazardAnalysisCsvImport(original, [])).toBe(original);
  });
});

describe("the messages the reviewer is shown", () => {
  it("says nothing when there is nothing wrong", () => {
    expect(describeHazardCsvProblems({ errors: [] })).toBe("");
    expect(describeHazardCsvPlan({ changedRowCount: 0 })).toBe("");
  });

  it("states the scope of the merge and what stays untouched", () => {
    const plan = planHazardAnalysisCsvImport(summary(), csv([
      ["Raw Analysis Row ID", "Safety Significant"],
      ["RAW-1", "No"],
      ["RAW-2", "No"],
    ]));
    const message = describeHazardCsvPlan(plan);

    expect(message).toContain("Update 1 row in this hazard analysis?");
    expect(message).toContain("governed review decisions: Safety Significant");
    expect(message).toContain("Rows not listed in the file are left unchanged.");
    expect(message).toContain("restorable");
  });

  it("caps a long problem list", () => {
    const message = describeHazardCsvProblems({ errors: ["a", "b", "c"] }, 2);
    expect(message).toContain("• a");
    expect(message).toContain("…and 1 more.");
  });
});


describe("imports into the displayed generated rows", () => {
  const draftHeaders = [...HEADERS].reverse();
  const drafts = () => ({
    "context:guide:1": { generated: true, row: [...summary()[1]].reverse(), note: "keep metadata" },
    "context:guide:2": { generated: true, row: [...summary()[2]].reverse() },
  });
  const text = csv([["Raw Analysis Row ID", "Safety Significance Rationale"], ["RAW-1", ""]]);

  it("updates by stable ID and header, preserves blank edits and unrelated rows", () => {
    const original = drafts();
    const plan = planHazardAnalysisCsvImport(summary(), text, { draftHeaders, draftRows: original });
    const next = applyHazardCsvImportToDrafts(original, draftHeaders, plan.updates);
    expect(next["context:guide:1"].row[0]).toBe("");
    expect(next["context:guide:1"].generated).toBe(true);
    expect(next["context:guide:1"].note).toBe("keep metadata");
    expect(next["context:guide:2"]).toBe(original["context:guide:2"]);
    expect(original["context:guide:1"].row[0]).toBe("Credited in the design review.");
  });

  it("repairs a previous Summary-only import when the same CSV is retried", () => {
    const savedSummary = applyHazardAnalysisCsvImport(summary(), planHazardAnalysisCsvImport(summary(), text).updates);
    const original = drafts();
    const plan = planHazardAnalysisCsvImport(savedSummary, text, { draftHeaders, draftRows: original });
    expect(plan.changedRowCount).toBe(1);
    const next = applyHazardCsvImportToDrafts(original, draftHeaders, plan.updates);
    expect(next["context:guide:1"].row[0]).toBe("");
    expect(planHazardAnalysisCsvImport(savedSummary, text, { draftHeaders, draftRows: next }).changedRowCount).toBe(0);
  });
});


describe("legacy exports with blank or externally assigned IDs", () => {
  const headers = ["Raw Analysis Row ID", "Function (From)", "Control Action", "Function (To)", "Guide Phrase", "Operational Scenario", "Hazard"];
  const rows = [headers,
    ["INTERNAL-1", "Dispatch", "Mission", "Vehicle", "Not provided", "Normal", "old first"],
    ["INTERNAL-2", "Dispatch", "Mission", "Vehicle", "Provided", "Normal", "old second"],
  ];

  it.each(["EXTERNAL", ""])("matches reordered edited rows with %p IDs, preserving internal references", (id) => {
    const imported = [headers, [id ? `${id}-2` : "", ...rows[2].slice(1, -1), "new second"], [id ? `${id}-1` : "", ...rows[1].slice(1, -1), "new first"]];
    const draftRows = { first: { generated: true, row: ["", ...rows[1].slice(1)] } };
    const plan = planHazardAnalysisCsvImport(rows, csv(imported), { draftHeaders: headers, draftRows });
    expect(plan.errors).toEqual([]);
    expect(plan.identityMatchedRowCount).toBe(2);
    const merged = applyHazardAnalysisCsvImport(rows, plan.updates);
    expect(merged[1]).toEqual(["INTERNAL-1", ...rows[1].slice(1, -1), "new first"]);
    expect(merged[2]).toEqual(["INTERNAL-2", ...rows[2].slice(1, -1), "new second"]);
    expect(applyHazardCsvImportToDrafts(draftRows, headers, plan.updates).first.row[6]).toBe("new first");
    expect(describeHazardCsvPlan(plan)).toContain("Existing internal row IDs will be retained");
  });

  it("accepts an export with no ID column and preserves omitted rows", () => {
    const plan = planHazardAnalysisCsvImport(rows, csv([headers.slice(1), [...rows[2].slice(1, -1), "new second"]]));
    expect(plan.errors).toEqual([]);
    expect(plan.changedRowCount).toBe(1);
    expect(applyHazardAnalysisCsvImport(rows, plan.updates)[1]).toEqual(rows[1]);
  });

  it("rejects ambiguous identities instead of using file order", () => {
    const ambiguous = [...rows, ["INTERNAL-3", ...rows[1].slice(1)]];
    const plan = planHazardAnalysisCsvImport(ambiguous, csv([headers, ["EXTERNAL", ...rows[1].slice(1)]]));
    expect(plan.errors[0]).toContain("match 2 rows");
    expect(plan.updates).toEqual([]);
  });

  it("rejects two different CSV IDs that resolve to the same internal row", () => {
    const plan = planHazardAnalysisCsvImport(rows, csv([headers,
      ["EXTERNAL-1", ...rows[1].slice(1)], ["EXTERNAL-2", ...rows[1].slice(1)],
    ]));
    expect(plan.errors[0]).toContain("same analysis row as line 2");
  });

  it("uses context to distinguish identical interfaces", () => {
    const contextual = [...rows, ["INTERNAL-3", ...rows[1].slice(1, 5), "Emergency", "old emergency"]];
    const plan = planHazardAnalysisCsvImport(contextual, csv([headers,
      ["EXTERNAL", ...contextual[3].slice(1, -1), "new emergency"],
    ]));
    expect(plan.errors).toEqual([]);
    expect(plan.updates[0].rowId).toBe("INTERNAL-3");
  });
});
