import {
  generateUnsafeControlActionsSheet,
  populateUCATimingColumnsWithLLM,
  generateCausalFactorsSheet,
  generateTextbookCausalFactorsSheet,
  generateMitigationStrategiesSheet,
  generateSystemRequirementsSheet,
  generateBatchedRequirementsSheet,
  generateHazardMappingsSheet,
  generateLossMappingsSheet,
  generateSummarySheetFromMappings,
  generateTextbookSummarySheetFromMappings,
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
} from "./aiAnalysisWhatIf";

import {
  generateHaraAnalysisSheets,
  generateFhaAnalysisSheets,
} from "./aiAnalysisHaraFha";

import {
  generateStandardCodeHazardAnalysisSheets,
} from "./aiAnalysisCodeHazardStandard";

/* ------------------- NEW: STPA-SEC imports ------------------- */
import {
  generateVulnerableControlActionsSheet_STPASEC,
  populateVCAThreatColumnsWithLLM_STPASEC,
  // downstream STPA-SEC steps chain internally from the functions above
} from "./aiAnalysisSTPASEC";
/* -------------------------------------------------------------- */

import {
  CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
  traceabilityToSheetCells,
} from "../features/code-architecture-hazard-analysis/codeArchitectureHazardUtils";

function getCellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "object" && "value" in cell) return String(cell.value);
  return String(cell);
}

export async function runLiteAIAnalysis({
  tableRows,
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
  setProgress,
  hazardMethod = "STPA",
  fhaGenerationMode = "standard",
  hazardGenerationMode = fhaGenerationMode,
  operationalContext = "",
  analysisContext = null,
  contextSources = null,
  omitConsolidatedRequirement = false,
}) {
  const totalSteps = 9;
  let step = 0;
  const updateProgress = (patch = {}) => setProgress?.({ step, total: totalSteps, ...patch });
  const updateGeneratorProgress = (patch = {}) => setProgress?.({
    step: patch.step ?? step,
    total: patch.total ?? totalSteps,
    message: patch.message,
    completed: patch.completed,
  });
  const selectedHazardGenerationMode = hazardGenerationMode || fhaGenerationMode || "standard";

  const existingDecomposition = sheets?.["Functional Decomposition"];
  const decompositionSheet = Array.isArray(existingDecomposition) && existingDecomposition.length > 1
    ? existingDecomposition
    : [
      ["Function (From)", "Control Action", "Function (To)", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS],
      ...tableRows.map((row) => [
        getCellText(row.fromFunction),
        getCellText(row.controlAction),
        getCellText(row.toFunction),
        ...traceabilityToSheetCells(row.traceability || {}),
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

  if (
    hazardMethod === "FMEA" ||
    hazardMethod === "FMEA-Textbook" ||
    hazardMethod === "FMEA_TEXTBOOK" ||
    hazardMethod === "FMEA_TEXTBOOK_APPROACH"
  ) {
    if (selectedHazardGenerationMode === "standard") {
      step = 1;
      updateProgress();
      updatedSheets = (await generateStandardCodeHazardAnalysisSheets({
        sheets: updatedSheets,
        setFolders,
        currentFolder,
        method: "FMEA",
        operationalContext,
        analysisContext,
        contextSources,
        onProgress: updateGeneratorProgress,
        omitConsolidatedRequirement,
      })) || updatedSheets;
      step = 9;
      updateProgress();
      return updatedSheets;
    }

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

  } else if (
    hazardMethod === "WhatIf" ||
    hazardMethod === "WhatIf-Textbook" ||
    hazardMethod === "WHATIF_TEXTBOOK" ||
    hazardMethod === "WHAT_IF_TEXTBOOK" ||
    hazardMethod === "WHAT_IF_TEXTBOOK_APPROACH"
  ) {
    if (selectedHazardGenerationMode === "standard") {
      step = 1;
      updateProgress();
      updatedSheets = (await generateStandardCodeHazardAnalysisSheets({
        sheets: updatedSheets,
        setFolders,
        currentFolder,
        method: "WhatIf",
        operationalContext,
        analysisContext,
        contextSources,
        onProgress: updateGeneratorProgress,
        omitConsolidatedRequirement,
      })) || updatedSheets;
      step = 9;
      updateProgress();
      return updatedSheets;
    }

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

  } else if (hazardMethod === "STPA-Textbook" || hazardMethod === "STPA_TEXTBOOK" || hazardMethod === "STPA_TEXTBOOK_APPROACH") {
    if (selectedHazardGenerationMode === "standard") {
      step = 1;
      updateProgress();
      updatedSheets = (await generateStandardCodeHazardAnalysisSheets({
        sheets: updatedSheets,
        setFolders,
        currentFolder,
        method: "STPA",
        operationalContext,
        analysisContext,
        contextSources,
        onProgress: updateGeneratorProgress,
        omitConsolidatedRequirement,
      })) || updatedSheets;
      step = 9;
      updateProgress();
      return updatedSheets;
    }

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

    if (!omitConsolidatedRequirement) {
      step = 6;
      updateProgress();
      updatedSheets = (await generateBatchedRequirementsSheet({
        sheets: updatedSheets,
        setFolders,
        currentFolder,
      })) || updatedSheets;
    }

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
    updatedSheets = (await generateTextbookSummarySheetFromMappings({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
    })) || updatedSheets;

  } else if (hazardMethod === "HARA") {
    step = 1;
    updateProgress();

    step = 2;
    updateProgress();
    updatedSheets = (await generateHaraAnalysisSheets({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      haraGenerationMode: selectedHazardGenerationMode,
      operationalContext,
      analysisContext,
      contextSources,
      onProgress: updateGeneratorProgress,
    })) || updatedSheets;

    step = 9;
    updateProgress();

  } else if (hazardMethod === "FHA") {
    step = 1;
    updateProgress();

    step = 2;
    updateProgress();
    updatedSheets = (await generateFhaAnalysisSheets({
      sheets: updatedSheets,
      setFolders,
      currentFolder,
      fhaGenerationMode: selectedHazardGenerationMode,
      operationalContext,
      analysisContext,
      contextSources,
      onProgress: updateGeneratorProgress,
    })) || updatedSheets;

    step = 9;
    updateProgress();

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

    if (!omitConsolidatedRequirement) {
      step = 6;
      updateProgress();
      updatedSheets = (await generateBatchedRequirementsSheet({
        sheets: updatedSheets,
        setFolders,
        currentFolder,
      })) || updatedSheets;
    }

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
      omitConsolidatedRequirement,
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
