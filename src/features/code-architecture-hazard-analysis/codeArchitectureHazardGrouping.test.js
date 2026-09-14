const {
  buildCodeArchitectureHazardGroups,
  filterCodeArchitectureHazardRowsByContext,
} = require("./codeArchitectureHazardGrouping");

const headers = [
  "Function (From)",
  "Control Action",
  "Function (To)",
  "Guide Phrase",
  "Operational Context ID",
];

function item(rowIndex, values) {
  return { rowIndex, row: values };
}

describe("code architecture hazard grouping", () => {
  const rows = [
    item(1, ["Estimate Pose", "Pose Estimate", "Plan Motion", "Not provided", "normal"]),
    item(2, ["Estimate Pose", "Pose Estimate", "Plan Motion", "Not provided", "degraded"]),
    item(3, ["Estimate Pose", "Pose Estimate", "Plan Motion", "Too late", "normal"]),
    item(4, ["Plan Motion", "Trajectory", "Control Motion", "Wrong order", "normal"]),
  ];

  it("groups rows by interface while preserving row order and context variants", () => {
    const groups = buildCodeArchitectureHazardGroups(headers, rows);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      label: "Estimate Pose → Pose Estimate → Plan Motion",
      rowCount: 3,
    });
    expect(groups[0].items.map((entry) => entry.rowIndex)).toEqual([1, 2, 3]);
    expect(groups[1].items[0].rowIndex).toBe(4);
  });

  it("filters a grouped result set to the selected operational context", () => {
    const filtered = filterCodeArchitectureHazardRowsByContext(headers, rows, "degraded");
    const groups = buildCodeArchitectureHazardGroups(headers, filtered);

    expect(filtered.map((entry) => entry.rowIndex)).toEqual([2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowCount).toBe(1);
  });

  it("keeps all rows for the all-context selection and fails closed for legacy rows", () => {
    expect(filterCodeArchitectureHazardRowsByContext(headers, rows, "all")).toBe(rows);
    expect(filterCodeArchitectureHazardRowsByContext(headers.slice(0, 4), rows, "normal")).toEqual([]);
  });
});
