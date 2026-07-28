export const CODE_ARCHITECTURE_HAZARD_SOURCE_TYPE = "code_based_architecture";

export const CODE_ARCHITECTURE_HAZARD_REVIEW_STATUSES = {
  DRAFT_AI_GENERATED: "draft_ai_generated",
  HUMAN_REVIEWED: "human_reviewed",
  SUPERSEDED: "superseded",
};

export const CODE_ARCHITECTURE_HAZARD_METHOD_OPTIONS = [
  { value: "STPA-Textbook", label: "STPA" },
  { value: "HARA", label: "HARA" },
  { value: "FHA", label: "FHA" },
];

export const CODE_ARCHITECTURE_HAZARD_GENERATION_MODE_OPTIONS = [
  { value: "standard", label: "Standard", description: "Single prompt by default; chunks automatically if needed" },
  { value: "detailed", label: "Detailed", description: "Multi-step/cell-level analysis, slowest but most detailed" },
];

export const CODE_ARCHITECTURE_FHA_GENERATION_MODE_OPTIONS = CODE_ARCHITECTURE_HAZARD_GENERATION_MODE_OPTIONS;

export const CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE = "code_architecture_hazard_summary_table";
