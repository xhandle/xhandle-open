/**
 * A follow-up review must start from the row the verified write committed, not
 * from whatever the workspace happens to have re-rendered. Blocking on the
 * workspace left the reviewer with a saved decision, no follow-up, and no
 * action to take.
 */

import { hazardStateWithCommittedRow } from "./hazardReviewState";

const HEADERS = ["Raw Analysis Row ID", "Function (From)", "Safety Significant", "Safety Classification"];
const state = (rows) => ({ activeProjectId: "P1", workspaceType: "functional-project", summary: [HEADERS, ...rows] });

const committed = {
  headers: [...HEADERS],
  nextRow: ["RAW-1", "Sensor", "Yes", "Needs Review"],
};

describe("hazardStateWithCommittedRow", () => {
  it("substitutes the committed row while leaving siblings alone", () => {
    const next = hazardStateWithCommittedRow(state([
      ["RAW-1", "Sensor", "Needs Review", "Needs Review"],
      ["RAW-2", "Controller", "No", "Mission/Reliability"],
    ]), "RAW-1", committed);

    expect(next.summary[1]).toEqual(["RAW-1", "Sensor", "Yes", "Needs Review"]);
    expect(next.summary[2]).toEqual(["RAW-2", "Controller", "No", "Mission/Reliability"]);
  });

  it("uses the committed value even when the workspace is still stale", () => {
    // This is the case that previously stranded the review.
    const stale = state([["RAW-1", "Sensor", "Needs Review", "Needs Review"]]);
    const next = hazardStateWithCommittedRow(stale, "RAW-1", committed);
    expect(next.summary[1][HEADERS.indexOf("Safety Significant")]).toBe("Yes");
  });

  it("realigns sibling rows when normalization changed the columns", () => {
    const legacy = {
      activeProjectId: "P1",
      summary: [
        ["Raw Analysis Row ID", "Safety Significant", "Function (From)"],
        ["RAW-1", "Needs Review", "Sensor"],
        ["RAW-2", "No", "Controller"],
      ],
    };
    const next = hazardStateWithCommittedRow(legacy, "RAW-1", committed);

    expect(next.summary[0]).toEqual(HEADERS);
    expect(next.summary[1]).toEqual(["RAW-1", "Sensor", "Yes", "Needs Review"]);
    // RAW-2's values follow their headers rather than their old positions.
    expect(next.summary[2]).toEqual(["RAW-2", "Controller", "No", ""]);
  });

  it("adds the committed row when the workspace has not seen it at all", () => {
    const next = hazardStateWithCommittedRow(state([["RAW-2", "Controller", "No", ""]]), "RAW-1", committed);
    expect(next.summary).toHaveLength(3);
    expect(next.summary[2]).toEqual(["RAW-1", "Sensor", "Yes", "Needs Review"]);
  });

  it("returns the state untouched when there is nothing usable to patch", () => {
    const base = state([["RAW-1", "Sensor", "Yes", ""]]);
    expect(hazardStateWithCommittedRow(base, "RAW-1", {})).toBe(base);
    expect(hazardStateWithCommittedRow(null, "RAW-1", committed)).toBeNull();
  });
});
