/**
 * The import replaces the whole functional decomposition table, so the parser
 * has to be right about quoting, about headers a reviewer may have retyped, and
 * about the two invariants a spreadsheet cannot enforce.
 */

import {
  FUNCTIONAL_DECOMPOSITION_COLUMNS,
  describeFunctionalCsvProblems,
  functionalDecompositionToCsv,
  parseCsv,
  parseFunctionalDecompositionCsv,
  resolveFunctionalCsvHeaders,
} from "./decompositionCsv";

const row = (overrides = {}) => ({
  subsystem: "Motion Planning",
  fromFunction: "Plan Vehicle Motion",
  fromDetails: "Produce a feasible trajectory.",
  controlAction: "Motion Plan",
  controlDetails: "Trajectory and constraints.",
  toFunction: "Manage Motion Execution",
  toDetails: "Track the trajectory.",
  ...overrides,
});

describe("parseCsv", () => {
  it("keeps commas, quotes, and wrapped lines inside a quoted cell", () => {
    const grid = parseCsv('a,"b, still b","he said ""go"""\r\n"line one\r\nline two",d,e');

    expect(grid).toEqual([
      ["a", "b, still b", 'he said "go"'],
      ["line one\nline two", "d", "e"],
    ]);
  });

  it("reads LF, CRLF, and a trailing newline the same way", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("strips the byte order mark Excel writes", () => {
    expect(parseCsv("﻿Subsystem,Function (From)")[0][0]).toBe("Subsystem");
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("the export/import round trip", () => {
  it("returns the rows it was given", () => {
    const rows = [
      row(),
      row({
        subsystem: "Perception And Localization",
        fromFunction: "Perceive Environment",
        fromDetails: 'Detect obstacles, "traversable" space,\nand lane edges.',
        controlAction: "Environmental Model",
        toFunction: "Plan Vehicle Motion",
      }),
    ];

    const parsed = parseFunctionalDecompositionCsv(functionalDecompositionToCsv(rows));

    expect(parsed.errors).toEqual([]);
    expect(parsed.conflicts).toEqual([]);
    expect(parsed.rows).toEqual(rows);
  });

  it("writes the seven exported column labels in order", () => {
    const [header] = parseCsv(functionalDecompositionToCsv([]));
    expect(header).toEqual(FUNCTIONAL_DECOMPOSITION_COLUMNS.map(({ label }) => label));
    expect(header).toEqual([
      "Subsystem", "Function (From)", "Function (From) Details", "Control Action",
      "Control Action Details", "Function (To)", "Function (To) Details",
    ]);
  });
});

describe("resolveFunctionalCsvHeaders", () => {
  it("accepts the aliases used elsewhere in the workspace", () => {
    const { columns, missingRequired } = resolveFunctionalCsvHeaders([
      "Subsystem Allocation", "Function From", "From Details", "Interface",
      "Control Details", "Function To", "To Details",
    ]);

    expect(missingRequired).toEqual([]);
    expect(columns.get("fromFunction")).toBe(1);
    expect(columns.get("controlAction")).toBe(3);
    expect(columns.get("toFunction")).toBe(5);
  });

  it("ignores column order and extra columns", () => {
    const { columns, missingRequired } = resolveFunctionalCsvHeaders([
      "Notes", "Function (To)", "Control Action", "Function (From)",
    ]);

    expect(missingRequired).toEqual([]);
    expect(columns.get("fromFunction")).toBe(3);
    expect(columns.has("subsystem")).toBe(false);
  });

  it("names the columns it cannot do without", () => {
    expect(resolveFunctionalCsvHeaders(["Subsystem", "Function (From)"]).missingRequired)
      .toEqual(["Control Action", "Function (To)"]);
  });
});

describe("parseFunctionalDecompositionCsv", () => {
  const csv = (lines) => lines.join("\r\n");
  const header = "Subsystem,Function (From),Function (From) Details,Control Action,Control Action Details,Function (To),Function (To) Details";

  it("refuses a file whose header does not describe the table", () => {
    const parsed = parseFunctionalDecompositionCsv("Name,Owner\nBraking,Nick");
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]).toContain("Control Action");
  });

  it("refuses an empty file and a header with no rows", () => {
    expect(parseFunctionalDecompositionCsv("").errors).toEqual(["The file is empty."]);
    expect(parseFunctionalDecompositionCsv(header).errors)
      .toEqual(["The file has a header row but no decomposition rows."]);
  });

  it("skips the blank lines a spreadsheet leaves behind", () => {
    const parsed = parseFunctionalDecompositionCsv(csv([
      header,
      "Motion Planning,Plan Vehicle Motion,,Motion Plan,,Manage Motion Execution,",
      ",,,,,,",
      '"","","","","","",""',
    ]));

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.ignoredBlankRows).toBe(2);
    expect(parsed.errors).toEqual([]);
  });

  it("reports a row that no longer names an interface, by line number", () => {
    const parsed = parseFunctionalDecompositionCsv(csv([
      header,
      "Motion Planning,Plan Vehicle Motion,,Motion Plan,,Manage Motion Execution,",
      "Motion Planning,Plan Vehicle Motion,,,,Manage Motion Execution,",
    ]));

    expect(parsed.errors).toEqual(["Line 3 is missing Function (From), Control Action, or Function (To)."]);
  });

  it("catches a function allocated to two subsystems", () => {
    const parsed = parseFunctionalDecompositionCsv(csv([
      header,
      "Motion Planning,Plan Vehicle Motion,,Motion Plan,,Manage Motion Execution,",
      "Safety Supervision,Plan Vehicle Motion,,Replanning Request,,Enforce Safe State,",
    ]));

    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.conflicts[0]).toContain("Line 3");
    expect(parsed.conflicts[0]).toContain("Safety Supervision");
    expect(parsed.conflicts[0]).toContain("line 2");
  });

  it("catches a duplicated interface", () => {
    const parsed = parseFunctionalDecompositionCsv(csv([
      header,
      "Motion Planning,Plan Vehicle Motion,,Motion Plan,,Manage Motion Execution,",
      "Motion Planning,plan vehicle motion,,MOTION PLAN,,Manage Motion Execution,other details",
    ]));

    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.conflicts[0]).toContain("repeats the interface");
  });

  it("accepts the same function on several rows under one subsystem", () => {
    const parsed = parseFunctionalDecompositionCsv(csv([
      header,
      "Motion Planning,Plan Vehicle Motion,,Motion Plan,,Manage Motion Execution,",
      "Motion Planning,Plan Vehicle Motion,,Planning Status,,Assess Operational Safety,",
    ]));

    expect(parsed.conflicts).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
  });

  it("trims cells and normalizes wrapped details to one newline", () => {
    const parsed = parseFunctionalDecompositionCsv(
      `${header}\r\n"  Motion Planning  ",Plan Vehicle Motion,"first\r\nsecond",Motion Plan,,Manage Motion Execution,`,
    );

    expect(parsed.rows[0].subsystem).toBe("Motion Planning");
    expect(parsed.rows[0].fromDetails).toBe("first\nsecond");
  });
});

describe("describeFunctionalCsvProblems", () => {
  it("is empty when nothing blocks the import", () => {
    expect(describeFunctionalCsvProblems({ errors: [], conflicts: [] })).toBe("");
  });

  it("lists errors and conflicts together and caps the list", () => {
    const message = describeFunctionalCsvProblems(
      { errors: ["one", "two"], conflicts: ["three", "four"] },
      2,
    );

    expect(message).toContain("• one");
    expect(message).toContain("• two");
    expect(message).toContain("…and 2 more.");
    expect(message).not.toContain("• three");
  });
});
