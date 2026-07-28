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
