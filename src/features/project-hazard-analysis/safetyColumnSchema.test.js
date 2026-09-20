import {
  getSafetyDetailEntries,
  isSafetyDetailHeader,
  reconcileDerivedSafetyColumns,
  safetyColumnDisplayLabel,
} from "./safetyColumnSchema";

describe("hazard safety column schema", () => {
  test("separates default columns from retained safety details", () => {
    expect(isSafetyDetailHeader("Safety Classification Rule")).toBe(true);
    expect(isSafetyDetailHeader("Protection Assessment")).toBe(true);
    expect(isSafetyDetailHeader("Safety Classification")).toBe(false);
    expect(safetyColumnDisplayLabel("Classification Evidence")).toBe("Classification Rationale");
    expect(getSafetyDetailEntries(
      ["Safety Classification Rule", "Protection Assessment", "Classification Confidence"],
      ["D1", "", "High"],
    )).toEqual([
      { header: "Safety Classification Rule", label: "Safety Classification Rule", value: "D1" },
      { header: "Classification Confidence", label: "Classification Confidence", value: "High" },
    ]);
  });

  test.each([
    ["Safety — Direct", "Yes", "Direct"],
    ["Safety — Related", "Yes", "Contributory"],
    ["Mission/Reliability", "No", "None"],
    ["Not Applicable", "No", "None"],
  ])("derives summaries for %s", (classification, significant, path) => {
    const headers = ["Safety Classification", "Safety Significant", "Causal Path Type"];
    expect(reconcileDerivedSafetyColumns(headers, [classification, "Needs Review", "Uncertain"]))
      .toEqual([classification, significant, path]);
  });

  test("does not overwrite a governed significance decision while classification needs review", () => {
    const headers = ["Safety Classification", "Safety Significant", "Causal Path Type"];
    expect(reconcileDerivedSafetyColumns(headers, ["Needs Review", "Yes", "Direct"]))
      .toEqual(["Needs Review", "Yes", "Uncertain"]);
  });
});
