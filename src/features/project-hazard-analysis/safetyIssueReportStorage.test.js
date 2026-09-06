import {
  loadSafetyIssueReportRecord,
  saveSafetyIssueReportRecord,
} from "./safetyIssueReportStorage";

describe("safety issue report storage", () => {
  const originalIndexedDB = global.indexedDB;

  beforeEach(() => {
    Object.defineProperty(global, "indexedDB", { configurable: true, value: undefined });
    localStorage.clear();
  });

  afterAll(() => {
    Object.defineProperty(global, "indexedDB", { configurable: true, value: originalIndexedDB });
  });

  it("retains a project report when IndexedDB is unavailable", async () => {
    const markdown = "# Safety Issue Reports\n\nA durable report.";
    await expect(saveSafetyIssueReportRecord("project-1", markdown)).resolves.toBe(true);
    await expect(loadSafetyIssueReportRecord("project-1")).resolves.toEqual(expect.objectContaining({
      projectId: "project-1",
      markdown,
    }));
  });

  it("keeps reports isolated by project", async () => {
    await saveSafetyIssueReportRecord("project-a", "Report A");
    await saveSafetyIssueReportRecord("project-b", "Report B");
    await expect(loadSafetyIssueReportRecord("project-a")).resolves.toEqual(expect.objectContaining({ markdown: "Report A" }));
    await expect(loadSafetyIssueReportRecord("project-b")).resolves.toEqual(expect.objectContaining({ markdown: "Report B" }));
  });
});
