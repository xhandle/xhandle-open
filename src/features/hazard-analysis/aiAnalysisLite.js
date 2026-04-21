/**
 * xHandle: Lite hazard-analysis pipeline.
 * This file contains one of xHandle's AI-assisted safety-analysis pipelines. It prepares prompt inputs from functional decomposition or worksheet data, calls the backend chat proxy, and normalizes the returned analysis into spreadsheet-friendly structures.
 * These modules are the bridge between system architecture data and the domain-specific artifacts that xHandle uses for hazard identification, control-action analysis, causal reasoning, mitigations, and derived requirements.
 * Related files: src/App.js, src/lib/api/backendConfig.js, src/lib/storage/indexedDB.js, src/components/generateAgenticReport.js.
 */

import {
  generateUnsafeControlActionsSheet,
  populateUCATimingColumnsWithLLM,
  generateCausalFactorsSheet,
  generateMitigationStrategiesSheet,
  generateSystemRequirementsSheet,
  generateBatchedRequirementsSheet,
  generateHazardMappingsSheet,
  generateLossMappingsSheet,
  generateSummarySheetFromMappings,
  generateTextbookCausalFactorsSheet,
  generateTextbookTraceabilityMatrix,
} from "./aiAnalysisSTPA";

import {
  generateWhatIfSeedSheet as generateHRSeedSheet,
  populateWhatIfScenariosWithLLM as populateHRScenariosWithLLM,
  generateWhatIfCausalFactorsSheet as generateHRCausalFactorsSheet,
  generateMitigationStrategiesSheet as generateHRMitigationStrategiesSheet,
  generateSystemRequirementsSheet as generateHRSystemRequirementsSheet,
  generateBatchedRequirementsSheet as generateHRBatchedRequirementsSheet,
  generateHazardMappingsSheet as generateHRHazardMappingsSheet,
  generateLossMappingsSheet as generateHRLossMappingsSheet,
  generateSummarySheetFromMappings as generateHRSummarySheet,
} from "./aiAnalysisWhatIfHR";

import {
  generateFailureModeSeedSheet,
  populateFMEAColumnsWithLLM,
  generateMitigationStrategiesSheet as generateFMEAMitigationStrategiesSheet,
  generateSystemRequirementsSheet as generateFMEASystemRequirementsSheet,
  generateBatchedRequirementsSheet as generateFMEABatchedRequirementsSheet,
  generateHazardMappingsSheet as generateFMEAHazardMappingsSheet,
  generateLossMappingsSheet as generateFMEALossMappingsSheet,
  generateSummarySheetFromMappings as generateFMEASummarySheet,
  generateFMEACausalFactorsSheet,
  generateTextbookTraceabilityMatrix as generateFMEATextbookTraceabilityMatrix,
} from "./aiAnalysisFMEA";

import {
  generateWhatIfSeedSheet,
  populateWhatIfScenariosWithLLM,
  generateWhatIfCausalFactorsSheet,
  generateMitigationStrategiesSheet as generateWhatIfMitigationStrategiesSheet,
  generateSystemRequirementsSheet as generateWhatIfSystemRequirementsSheet,
  generateBatchedRequirementsSheet as generateWhatIfBatchedRequirementsSheet,
  generateHazardMappingsSheet as generateWhatIfHazardMappingsSheet,
  generateLossMappingsSheet as generateWhatIfLossMappingsSheet,
  generateSummarySheetFromMappings as generateWhatIfSummarySheet,
  generateTextbookWhatIfSeedSheet,
  populateTextbookWhatIfScenariosWithLLM,
  generateTextbookWhatIfCausalFactorsSheet,
  generateTextbookWhatIfMitigationStrategiesSheet,
  generateTextbookWhatIfTraceabilityMatrix,
} from "./aiAnalysisWhatIf";

/* ------------------- NEW: STPA-SEC imports ------------------- */
import {
  generateVulnerableControlActionsSheet_STPASEC,
  populateVCAThreatColumnsWithLLM_STPASEC,
  // downstream STPA-SEC steps chain internally from the functions above
} from "./aiAnalysisSTPASEC";
/* -------------------------------------------------------------- */

function getCellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "object" && "value" in cell) return String(cell.value);
  return String(cell);
}

/**
 * runLiteAIAnalysis executes one step of the hazard-analysis pipeline. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param tableRows Input consumed by this step of the xHandle workflow.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @param setChatPrompt UI state setter used to expose the generated prompt for user review.
 * @param setChatResponse UI state setter used to surface model output or analysis progress.
 * @param setProgress React state setter supplied by the parent workflow.
 * @param hazardMethod Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function runLiteAIAnalysis({
  tableRows,
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
  setProgress,
  hazardMethod = "STPA",
}) {
  const totalSteps = ["STPA-Textbook", "FMEA-Textbook", "WhatIf-Textbook"].includes(hazardMethod) ? 4 : 9;
  let step = 0;
  const updateProgress = () => setProgress?.({ step, total: totalSteps });

  const decompositionSheet = [
    ["Function (From)", "Control Action", "Function (To)"],
    ...tableRows.map((row) => [
      getCellText(row.fromFunction),
      getCellText(row.controlAction),
      getCellText(row.toFunction),
    ]),
  ];

  sheets["Functional Decomposition"] = decompositionSheet;

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      "Functional Decomposition": decompositionSheet,
    },
  }));

  let updatedSheets = sheets;

  if (hazardMethod === "FMEA-Textbook") {
    step = 1;
    updateProgress();
    updatedSheets = (await generateFailureModeSeedSheet({ sheets: updatedSheets, setFolders, currentFolder })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateFMEAColumnsWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateFMEACausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;
    updatedSheets = (await generateFMEAMitigationStrategiesSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateFMEATextbookTraceabilityMatrix({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  } else if (hazardMethod === "FMEA") {
    step = 1;
    updateProgress();
    updatedSheets = (await generateFailureModeSeedSheet({ sheets: updatedSheets, setFolders, currentFolder })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateFMEAColumnsWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateFMEACausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateFMEAMitigationStrategiesSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 5;
    updateProgress();
    updatedSheets = (await generateFMEASystemRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 6;
    updateProgress();
    updatedSheets = (await generateFMEABatchedRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 7;
    updateProgress();
    updatedSheets = (await generateFMEAHazardMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 8;
    updateProgress();
    updatedSheets = (await generateFMEALossMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 9;
    updateProgress();
    updatedSheets = (await generateFMEASummarySheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  } else if (hazardMethod === "HRWhatIf") {
    step = 1;
    updateProgress();
    updatedSheets = (await generateHRSeedSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateHRScenariosWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateHRCausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateHRMitigationStrategiesSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 5;
    updateProgress();
    updatedSheets = (await generateHRSystemRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 6;
    updateProgress();
    updatedSheets = (await generateHRBatchedRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 7;
    updateProgress();
    updatedSheets = (await generateHRHazardMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 8;
    updateProgress();
    updatedSheets = (await generateHRLossMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 9;
    updateProgress();
    updatedSheets = (await generateHRSummarySheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  } else if (hazardMethod === "WhatIf-Textbook") {
    step = 1;
    updateProgress();
    updatedSheets = (await generateTextbookWhatIfSeedSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateTextbookWhatIfScenariosWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateTextbookWhatIfCausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;
    updatedSheets = (await generateTextbookWhatIfMitigationStrategiesSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateTextbookWhatIfTraceabilityMatrix({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  } else if (hazardMethod === "WhatIf") {
    step = 1;
    updateProgress();
    updatedSheets = (await generateWhatIfSeedSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateWhatIfScenariosWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateWhatIfCausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateWhatIfMitigationStrategiesSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 5;
    updateProgress();
    updatedSheets = (await generateWhatIfSystemRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 6;
    updateProgress();
    updatedSheets = (await generateWhatIfBatchedRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 7;
    updateProgress();
    updatedSheets = (await generateWhatIfHazardMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 8;
    updateProgress();
    updatedSheets = (await generateWhatIfLossMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 9;
    updateProgress();
    updatedSheets = (await generateWhatIfSummarySheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  /* ------------------- NEW: STPA-SEC branch ------------------- */
  } else if (hazardMethod === "STPA-SEC" || hazardMethod === "STPASEC" || hazardMethod === "SEC") {
    // Step 1: Generate VCA seed sheet
    step = 1;
    updateProgress();
    updatedSheets = (await generateVulnerableControlActionsSheet_STPASEC({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    // Step 2: Populate VCA columns (downstream STPA-SEC steps chain internally)
    step = 2;
    updateProgress();
    updatedSheets = (await populateVCAThreatColumnsWithLLM_STPASEC({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatResponse,
    })) || updatedSheets;

    // Jump progress to done (the rest of STPA-SEC runs inside the above call chain)
    step = 9;
    updateProgress();
  /* ------------------------------------------------------------ */

  } else if (hazardMethod === "STPA-Textbook") {
    step = 1;
    updateProgress();
    updatedSheets = (await generateUnsafeControlActionsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateUCATimingColumnsWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateTextbookCausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateTextbookTraceabilityMatrix({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  } else {
    step = 1;
    updateProgress();
    updatedSheets = (await generateUnsafeControlActionsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 2;
    updateProgress();
    updatedSheets = (await populateUCATimingColumnsWithLLM({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      setChatPrompt,
      setChatResponse,
    })) || updatedSheets;

    step = 3;
    updateProgress();
    updatedSheets = (await generateCausalFactorsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 4;
    updateProgress();
    updatedSheets = (await generateMitigationStrategiesSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 5;
    updateProgress();
    updatedSheets = (await generateSystemRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 6;
    updateProgress();
    updatedSheets = (await generateBatchedRequirementsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 7;
    updateProgress();
    updatedSheets = (await generateHazardMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 8;
    updateProgress();
    updatedSheets = (await generateLossMappingsSheet({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

    step = 9;
    updateProgress();
    updatedSheets = (await generateSummarySheetFromMappings({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;
  }

  // Normalize Summary name so downstream views can rely on "Summary"
  if (updatedSheets["Summary (HR)"]) {
    updatedSheets = {
      ...updatedSheets,
      Summary: updatedSheets["Summary (HR)"],
    };
    await setFolders((prev) => ({
      ...prev,
      [currentFolder]: {
        ...prev[currentFolder],
        Summary: updatedSheets["Summary (HR)"],
      },
    }));
  }

  // NEW: Map STPA-SEC final table to "Summary" if present
  if (updatedSheets["Security Summary"]) {
    updatedSheets = {
      ...updatedSheets,
      Summary: updatedSheets["Security Summary"],
    };
    await setFolders((prev) => ({
      ...prev,
      [currentFolder]: {
        ...prev[currentFolder],
        Summary: updatedSheets["Security Summary"],
      },
    }));
  }

  return updatedSheets;
}
