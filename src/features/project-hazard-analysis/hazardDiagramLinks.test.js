import {
  buildHazardDiagramFocusTarget,
  getHazardDiagramLinkLabel,
} from "./hazardDiagramLinks";

const headers = [
  "Function (From)",
  "Control Action",
  "Function (To)",
  "Subsystem Allocation",
  "Hazard",
];
const row = [
  "Estimate Vehicle State",
  "Vehicle State Estimate",
  "Plan Motion",
  "Localization",
  "Unsafe state estimate",
];

test("builds function-node targets for both function columns", () => {
  expect(buildHazardDiagramFocusTarget(headers, row, 0)).toMatchObject({
    kind: "function",
    label: "Estimate Vehicle State",
  });
  expect(buildHazardDiagramFocusTarget(headers, row, 2)).toMatchObject({
    kind: "function",
    label: "Plan Motion",
  });
});

test("builds an edge target with enough context to disambiguate the control action", () => {
  const target = buildHazardDiagramFocusTarget(headers, row, 1);
  expect(target).toEqual({
    kind: "edge",
    label: "Vehicle State Estimate",
    fromFunction: "Estimate Vehicle State",
    toFunction: "Plan Motion",
    controlAction: "Vehicle State Estimate",
    subsystem: "Localization",
  });
  expect(getHazardDiagramLinkLabel(target)).toBe("View control action in diagram");
});

test("builds a subsystem target and ignores unrelated or empty cells", () => {
  expect(buildHazardDiagramFocusTarget(headers, row, 3)).toMatchObject({
    kind: "subsystem",
    label: "Localization",
    fromFunction: "Estimate Vehicle State",
  });
  expect(buildHazardDiagramFocusTarget(headers, row, 4)).toBeNull();
  expect(buildHazardDiagramFocusTarget(headers, ["", "", "", "", ""], 0)).toBeNull();
});
