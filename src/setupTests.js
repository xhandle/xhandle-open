try {
  require("@testing-library/jest-dom");
} catch {
  // The app does not currently declare jest-dom; keep non-DOM tests runnable.
}

jest.mock('./features/design-management/artifacts/createArtifactWorker', () => ({ __esModule: true, default: jest.fn(() => { throw new Error('Provide an artifact worker mock for this DOM test.'); }) }));

// Browser worker construction is exercised by the disposable Electron diagnostic.
jest.mock("./features/code-architecture-hazard-analysis/createHazardRowsWorker", () => ({__esModule:true,default:()=>{throw new Error("Provide a worker mock for this DOM test.");}}));
jest.mock("./features/code-architecture-hazard-analysis/createHazardCsvImportWorker", () => ({__esModule:true,default:()=>{throw new Error("Provide a CSV worker mock for this DOM test.");}}));
jest.mock("./features/workspace-graph/createWorkspaceGraphWorker", () => ({__esModule:true,default:()=>{throw new Error("Provide a workspace index worker mock for this DOM test.");}}));
jest.mock('./features/workspace-graph/createWorkspaceReadWorker',()=>({__esModule:true,default:()=>{throw new Error('Provide a workspace read worker mock for this DOM test.');}}));

jest.mock('./lib/createHazardStorageWorker', () => ({ __esModule: true, default: jest.fn(() => { throw new Error('Provide a hazard storage worker mock for this DOM test.'); }) }));
