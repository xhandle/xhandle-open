import {
  deleteHazardAnalysisResetSnapshot,
  loadHazardAnalysisResetSnapshot,
  saveHazardAnalysisResetSnapshot,
} from "./hazardAnalysisResetStorage";

describe("hazard analysis reset snapshot storage", () => {
  const originalIndexedDB = global.indexedDB;

  beforeEach(() => {
    Object.defineProperty(global, "indexedDB", { configurable: true, value: undefined });
    localStorage.clear();
  });

  afterAll(() => {
    Object.defineProperty(global, "indexedDB", { configurable: true, value: originalIndexedDB });
  });

  test("stores, loads, and deletes a recoverable reset snapshot", async () => {
    const snapshot = { analysisResult: { Summary: [["Hazard"], ["Loss of control"]] }, riskRegister: [{ id: "SI-1" }] };
    await expect(saveHazardAnalysisResetSnapshot("project-1", snapshot)).resolves.toBe(true);
    await expect(loadHazardAnalysisResetSnapshot("project-1")).resolves.toEqual(expect.objectContaining({
      projectId: "project-1",
      snapshot,
    }));
    await expect(deleteHazardAnalysisResetSnapshot("project-1")).resolves.toBe(true);
    await expect(loadHazardAnalysisResetSnapshot("project-1")).resolves.toBeNull();
  });
});
