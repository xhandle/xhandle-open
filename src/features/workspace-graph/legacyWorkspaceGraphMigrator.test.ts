import {
  migrateLegacyStorageToWorkspaceGraph,
  migrateLegacyStorageToWorkspaceGraphIfStale,
} from "./legacyWorkspaceGraphMigrator";
import { upsertArtifacts, upsertRelationships } from "./workspaceGraphRepository";

jest.mock("./workspaceGraphRepository", () => ({
  upsertArtifacts: jest.fn(async (rows) => rows),
  upsertEvidence: jest.fn(async (row) => row),
  upsertFolder: jest.fn(async (row) => row),
  upsertProject: jest.fn(async (row) => row),
  upsertRelationships: jest.fn(async (rows) => rows),
  upsertReview: jest.fn(async (row) => row),
  upsertRun: jest.fn(async (row) => row),
  upsertSourceFile: jest.fn(async (row) => row),
}));

function installIndexedDbMock(databases: Record<string, Record<string, any[]>> = {}) {
  const indexedDBMock = {
    databases: jest.fn(async () => Object.keys(databases).map((name) => ({ name }))),
    open: jest.fn((name: string) => {
      const request: any = {};
      const dbStores = databases[name] || {};
      const db = {
        objectStoreNames: {
          contains: (storeName: string) => Object.prototype.hasOwnProperty.call(dbStores, storeName),
        },
        transaction: (storeName: string) => ({
          objectStore: () => ({
            getAll: () => {
              const getAllRequest: any = {};
              setTimeout(() => {
                getAllRequest.result = dbStores[storeName] || [];
                getAllRequest.onsuccess?.();
              }, 0);
              return getAllRequest;
            },
          }),
        }),
        close: jest.fn(),
      };
      setTimeout(() => {
        request.result = db;
        request.onsuccess?.();
      }, 0);
      return request;
    }),
  };
  Object.defineProperty(global, "indexedDB", {
    value: indexedDBMock,
    configurable: true,
  });
}

describe("migrateLegacyStorageToWorkspaceGraph", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    installIndexedDbMock();
  });

  it("converts xhandle.projectData rows into functional decomposition artifacts", async () => {
    localStorage.setItem("xhandle.projects", JSON.stringify([{ id: "p1", name: "Project One" }]));
    localStorage.setItem("xhandle.projectData", JSON.stringify({
      p1: {
        responseRows: [
          { fromFunction: "Sense", toFunction: "Decide", controlAction: "signal" },
        ],
      },
    }));

    await migrateLegacyStorageToWorkspaceGraph();

    const artifacts = (upsertArtifacts as jest.Mock).mock.calls[0][0];
    const relationships = (upsertRelationships as jest.Mock).mock.calls[0][0];
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "functional_decomposition_row",
        projectId: "p1",
        sourceStore: "localStorage:xhandle.projectData",
        sourceKey: "xhandle.projectData.p1.responseRows",
      }),
    ]));
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "contains" }),
    ]));
  });

  it("converts individually generated guide-phrase drafts into hazard-analysis artifacts", async () => {
    const headers = [
      "Function (From)",
      "Control Action",
      "Function (To)",
      "Guide Phrase",
      "Unsafe Control Action",
    ];
    localStorage.setItem("xhandle.projects", JSON.stringify([{ id: "p1", name: "Project One" }]));
    localStorage.setItem("xhandle.projectData", JSON.stringify({
      p1: {
        riskMethod: "STPA-Textbook",
        draftHazardHeaders: headers,
        draftHazardRowsByIndex: {
          "0:guide:3": {
            generated: true,
            row: ["Plan Motion", "Issue trajectory", "Control Motion", "Provided too late", "Trajectory arrives after the safe braking point"],
          },
          "0:guide:4": {
            generated: false,
            row: ["Plan Motion", "Issue trajectory", "Control Motion", "Provided in the wrong order", ""],
          },
        },
      },
    }));

    await migrateLegacyStorageToWorkspaceGraph();

    const artifacts = (upsertArtifacts as jest.Mock).mock.calls[0][0];
    const hazardArtifacts = artifacts.filter((artifact: any) => artifact.type === "hazard_analysis_row");
    expect(hazardArtifacts).toHaveLength(1);
    expect(hazardArtifacts[0]).toEqual(expect.objectContaining({
      projectId: "p1",
      sourceKey: "xhandle.projectData.p1.draftHazardRowsByIndex",
      sourceId: "p1:draftHazardRowsByIndex:0:guide:3",
      structuredData: expect.objectContaining({
        rowIndex: 3,
        guidePhraseIndex: 3,
        columns: headers,
        draft: true,
      }),
    }));
  });

  it("assigns distinct artifact rows to contextual hazard variants", async () => {
    const headers = ["Function (From)", "Control Action", "Function (To)", "Operational Scenario", "Operational Mode", "Guide Phrase", "Hazard"];
    localStorage.setItem("xhandle.projects", JSON.stringify([{ id: "p1", name: "Project One" }]));
    localStorage.setItem("xhandle.projectData", JSON.stringify({
      p1: {
        riskMethod: "STPA-Textbook",
        hazardOperationalContexts: [
          { id: "urban", scenario: "Urban intersection", mode: "Autonomous" },
          { id: "highway", scenario: "Highway cruise", mode: "Autonomous" },
        ],
        draftHazardHeaders: headers,
        draftHazardRowsByIndex: {
          "0:guide:3:context:urban": { generated: true, row: ["Plan", "Command", "Control", "Urban intersection", "Autonomous", "Late", "Urban hazard"] },
          "0:guide:3:context:highway": { generated: true, row: ["Plan", "Command", "Control", "Highway cruise", "Autonomous", "Late", "Highway hazard"] },
        },
      },
    }));

    await migrateLegacyStorageToWorkspaceGraph();

    const artifacts = (upsertArtifacts as jest.Mock).mock.calls[0][0];
    const hazards = artifacts.filter((artifact: any) => artifact.type === "hazard_analysis_row");
    expect(hazards).toHaveLength(2);
    expect(hazards.map((artifact: any) => artifact.structuredData.rowIndex)).toEqual([6, 7]);
    expect(hazards.map((artifact: any) => artifact.structuredData.contextId)).toEqual(["urban", "highway"]);
    expect(new Set(hazards.map((artifact: any) => artifact.id)).size).toBe(2);
  });

  it("converts copilot_baseline CBA rows into code architecture edge artifacts", async () => {
    installIndexedDbMock({
      xhandle: {
        copilot_baseline: [
          {
            key: "cba:p1:repo1",
            value: [
              { traceId: "edge-1", from: "Controller", to: "Actuator", fromFile: "src/controller.ts", toFile: "src/actuator.ts" },
            ],
          },
        ],
      },
    });

    await migrateLegacyStorageToWorkspaceGraph();

    const artifacts = (upsertArtifacts as jest.Mock).mock.calls[0][0];
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "code_architecture_edge",
        projectId: "p1",
        sourceStore: "indexedDB:xhandle/copilot_baseline",
        sourceKey: "cba:p1:repo1",
      }),
      expect.objectContaining({
        type: "source_file",
        title: "src/controller.ts",
      }),
    ]));
  });

  it("skips cached migration when legacy storage is fresh and refreshes when stale", async () => {
    localStorage.setItem("xhandle.projects", JSON.stringify([{ id: "cache-project", name: "Cache Project" }]));

    const first = await migrateLegacyStorageToWorkspaceGraphIfStale({ force: true, maxAgeMs: 60000 });
    const second = await migrateLegacyStorageToWorkspaceGraphIfStale({ maxAgeMs: 60000 });
    localStorage.setItem("xhandle.projectData", JSON.stringify({ "cache-project": { responseRows: [{ from: "A", to: "B" }] } }));
    const third = await migrateLegacyStorageToWorkspaceGraphIfStale({ maxAgeMs: 60000 });

    expect(first.skipped).toBeUndefined();
    expect(second.skipped).toBe(true);
    expect(third.skipped).toBeUndefined();
    expect(upsertArtifacts).toHaveBeenCalledTimes(2);
  });
});
