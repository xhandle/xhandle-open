import { runLiteAIAnalysis } from "./aiAnalysisLite";
import { generateStandardCodeHazardAnalysisSheets } from "./aiAnalysisCodeHazardStandard";
import { generateFhaAnalysisSheets, generateHaraAnalysisSheets } from "./aiAnalysisHaraFha";

jest.mock("./aiAnalysisCodeHazardStandard", () => ({
  generateStandardCodeHazardAnalysisSheets: jest.fn(async ({ sheets }) => sheets),
}));

jest.mock("./aiAnalysisHaraFha", () => ({
  generateFhaAnalysisSheets: jest.fn(async ({ sheets }) => sheets),
  generateHaraAnalysisSheets: jest.fn(async ({ sheets }) => sheets),
}));

const baseInput = () => ({
  tableRows: [{ fromFunction: "Source", controlAction: "Command", toFunction: "Target" }],
  sheets: {},
  setFolders: async (updater) => updater({}),
  currentFolder: "TestProject",
  setChatPrompt: () => {},
  setChatResponse: () => {},
  setProgress: () => {},
  operationalContext: "OPERATIONAL-CONTEXT-TOKEN",
  organizationContext: "ORGANIZATION-PROFILE-TOKEN",
});

beforeEach(() => {
  jest.clearAllMocks();
});

test.each([
  ["STPA-Textbook", "STPA"],
  ["FMEA-Textbook", "FMEA"],
  ["WhatIf-Textbook", "WhatIf"],
])("forwards organization calibration independently through %s generation", async (hazardMethod, expectedMethod) => {
  await runLiteAIAnalysis({
    ...baseInput(),
    hazardMethod,
    hazardGenerationMode: "standard",
  });

  expect(generateStandardCodeHazardAnalysisSheets).toHaveBeenCalledWith(expect.objectContaining({
    method: expectedMethod,
    operationalContext: "OPERATIONAL-CONTEXT-TOKEN",
    organizationContext: "ORGANIZATION-PROFILE-TOKEN",
  }));
});

test.each([
  ["HARA", generateHaraAnalysisSheets],
  ["FHA", generateFhaAnalysisSheets],
])("forwards organization calibration independently through %s generation", async (hazardMethod, generator) => {
  await runLiteAIAnalysis({
    ...baseInput(),
    hazardMethod,
    hazardGenerationMode: "standard",
  });

  expect(generator).toHaveBeenCalledWith(expect.objectContaining({
    operationalContext: "OPERATIONAL-CONTEXT-TOKEN",
    organizationContext: "ORGANIZATION-PROFILE-TOKEN",
  }));
});
