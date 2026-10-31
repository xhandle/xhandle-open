const {
  buildCodeArchitectureHazardGroups,
  createCodeArchitectureHazardLayout,
  HAZARD_LAYOUT_LIMIT_BYTES,
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

  it("bounds remote group metadata without retaining long row text or merging suffix differences", () => {
    const layout = createCodeArchitectureHazardLayout(headers);
    const action = "X".repeat(50000);
    for (let index = 0; index < 100; index++) layout.addRow(index, ["Plan", `${action}${index}`, "Control"]);
    layout.addRow(100, [" plan ", `${action.toLowerCase()}0`, "control"]);
    const result = layout.finish();
    expect(result.groups).toHaveLength(100);
    expect(result.groups[0].rowIndices).toEqual([0, 100]);
    expect(result.indices).toEqual(Array.from({length: 101}, (_, index) => index));
    expect(result.groups.every(group => group.label.length <= 512 && group.key.length === 64)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(action);
    expect(result.metadataBytes).toBeLessThan(160000);
  });

  it("rejects oversized headers, groups and numeric row coordinates before exceeding the outline budget", () => {
    expect(HAZARD_LAYOUT_LIMIT_BYTES).toBe(32 * 1024 * 1024);
    expect(() => createCodeArchitectureHazardLayout(["x".repeat(HAZARD_LAYOUT_LIMIT_BYTES / 2)]))
      .toThrow("Narrow the table filters");
    for (const distinct of [false, true]) {
      const layout = createCodeArchitectureHazardLayout(headers, {maxBytes: 4096});
      expect(() => {
        for (let index = 0; index < 200; index++) layout.addRow(index, ["Plan", distinct ? `Action ${index}` : "Command", "Control"]);
      }).toThrow("Narrow the table filters");
      const result = layout.finish();
      expect(result.metadataBytes).toBeLessThanOrEqual(4096);
      expect(result.indices.length).toBeLessThan(200);
      expect(result.groups.reduce((total, group) => total + group.rowCount, 0)).toBe(result.total);
    }
  });
});
