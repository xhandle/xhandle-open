jest.mock("idb", () => ({
  __esModule: true,
  openDB: jest.fn(),
}));

import { openDB } from "idb";
import {
  deleteProjectHazardAnalysisRecord,
  loadProjectHazardAnalysisRecord,
  saveProjectHazardAnalysisRecord,
} from "./projectHazardAnalysisStorage";

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockRemove = jest.fn();

describe("project hazard analysis artifact storage", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockRemove.mockReset();
    openDB.mockResolvedValue({
      get: mockGet,
      put: mockPut,
      delete: mockRemove,
    });
  });

  it("persists the full analysis, draft rows, and consolidated risks together", async () => {
    const analysisResult = { Summary: [["Hazard"], ["Loss of control"]] };
    const draftHazardRowsByIndex = { "0:context:a:guide:0": { generated: true, row: ["Loss of control"] } };
    const riskRegister = [{ id: "risk-1", sourceIndexes: [1] }];

    await expect(saveProjectHazardAnalysisRecord("project-1", {
      analysisResult,
      draftHazardRowsByIndex,
      riskRegister,
    })).resolves.toBe(true);

    expect(mockPut).toHaveBeenCalledWith("analyses", expect.objectContaining({
      projectId: "project-1",
      analysisResult,
      draftHazardRowsByIndex,
      riskRegister,
    }));
  });

  it("loads and deletes records by project id", async () => {
    const record = { projectId: "project-1", analysisResult: null };
    mockGet.mockResolvedValue(record);

    await expect(loadProjectHazardAnalysisRecord("project-1")).resolves.toEqual(record);
    await expect(deleteProjectHazardAnalysisRecord("project-1")).resolves.toBe(true);

    expect(mockGet).toHaveBeenCalledWith("analyses", "project-1");
    expect(mockRemove).toHaveBeenCalledWith("analyses", "project-1");
  });
});
