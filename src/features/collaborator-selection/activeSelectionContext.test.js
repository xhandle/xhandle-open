import {
  createTableCellSelection,
  describeActiveSelection,
  isSelectedTableCell,
  isSelectedTableRow,
} from "./activeSelectionContext";

describe("Collaborator active selection context", () => {
  test("captures the selected cell and its complete source row", () => {
    const selection = createTableCellSelection({
      tableId: "functional-decomposition",
      tableLabel: "Functional Decomposition",
      projectId: "project-1",
      rowId: "fd-4",
      rowIndex: 3,
      headers: ["Function (From)", "Control Action", "Function (To)"],
      row: ["Plan Motion", "Trajectory Command", "Control Motion"],
      columnIndex: 1,
    });

    expect(selection.primary).toEqual(expect.objectContaining({ rowId: "fd-4", rowNumber: 4, columnLabel: "Control Action", value: "Trajectory Command" }));
    expect(selection.selectedRows[0].values["Function (To)"]).toBe("Control Motion");
    expect(isSelectedTableRow(selection, "functional-decomposition", "fd-4")).toBe(true);
    expect(isSelectedTableCell(selection, "functional-decomposition", "fd-4", 1)).toBe(true);
    expect(describeActiveSelection(selection)).toContain("row 4");
  });
});
