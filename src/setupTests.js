try {
  require("@testing-library/jest-dom");
} catch {
  // The app does not currently declare jest-dom; keep non-DOM tests runnable.
}

// Browser worker construction is exercised by the disposable Electron diagnostic.
jest.mock("./features/code-architecture-hazard-analysis/createHazardRowsWorker", () => ({__esModule:true,default:()=>{throw new Error("Provide a worker mock for this DOM test.");}}));
