import { buildBrowserStorageSummary, classifyStoredWorkspaceProjects } from "./storageWorkspaceVisibility";

describe("storage workspace visibility", () => {
  it("distinguishes active projects from recoverable removed project records", () => {
    const records = [
      {
        id: "functional-active",
        name: "Active haulage",
        sourceStore: "localStorage:xhandle.projects",
        sourceData: { id: "functional-active", name: "Active haulage" },
      },
      {
        id: "functional-removed",
        name: "Removed haulage",
        sourceStore: "localStorage:xhandle.projects",
        sourceData: { id: "functional-removed", name: "Removed haulage" },
      },
      {
        id: "cba-active",
        name: "Active code project",
        sourceStore: "localStorage:xhandle.codeArchitectureProjects",
        sourceData: { id: "cba-active", name: "Active code project" },
      },
      { id: "unrelated", name: "Unrelated workspace record", sourceStore: "other" },
    ];

    expect(classifyStoredWorkspaceProjects(
      records,
      [{ id: "functional-active" }],
      [{ id: "cba-active" }],
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "functional-active", workspaceType: "functional", active: true, recoverable: false }),
      expect.objectContaining({ id: "functional-removed", workspaceType: "functional", active: false, recoverable: true }),
      expect.objectContaining({ id: "cba-active", workspaceType: "code-architecture", active: true, recoverable: false }),
    ]));
    expect(classifyStoredWorkspaceProjects(records, [], [])).toHaveLength(3);
  });
});

describe("browser storage capacity summary", () => {
  it("uses measured xHandle data when the browser under-reports usage and calculates available quota", () => {
    const summary = buildBrowserStorageSummary({
      usageBytes: 0,
      quotaBytes: 1000,
      items: [
        { id: "projects", label: "Project records", bytes: 250 },
        { id: "reviews", label: "Workspace reviews", bytes: 150 },
      ],
    });
    expect(summary.usedBytes).toBe(400);
    expect(summary.availableBytes).toBe(600);
    expect(summary.segments.reduce((total, segment) => total + segment.bytes, 0)).toBe(400);
  });

  it("reports unavailable capacity separately from measured usage", () => {
    expect(buildBrowserStorageSummary({ items: [{ label: "Other", bytes: 50 }] })).toEqual(expect.objectContaining({
      usedBytes: 50,
      quotaBytes: 0,
      availableBytes: null,
    }));
  });
});
