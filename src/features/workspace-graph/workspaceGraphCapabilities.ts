// Shared by retrieval and the prompt scope filter so natural capability names
// include the same artifacts in both Projects and Code-Based Architecture.
export const SCOPE_ARTIFACT_TYPES: Record<string, ReadonlySet<string>> = {
  projects: new Set(["project", "folder", "requirements_project", "repository"]),
  source: new Set(["source_file", "repository"]),
  design: new Set(["sysml_model", "sysml_element", "sysml_requirement", "code_architecture_design_element"]),
  notes: new Set(["note", "summary_artifact"]),
  requirements: new Set(["requirement", "sysml_requirement", "code_architecture_software_requirement", "code_architecture_system_requirement", "code_architecture_subsystem_requirement"]),
  risk: new Set(["risk", "hazard_analysis_row", "code_architecture_hazard_row", "safety_finding", "safety_case", "safety_case_node", "safety_issue_report"]),
  cba: new Set(["code_architecture_edge", "code_architecture_hazard_row", "code_architecture_software_requirement", "code_architecture_system_requirement", "code_architecture_subsystem_requirement", "code_architecture_design_element", "safety_finding", "patch_proposal", "review_decision", "verification_run", "implementation_evidence", "repository", "source_file"]),
  functional: new Set(["functional_decomposition_row", "code_architecture_edge", "sysml_element"]),
  review: new Set(["review_item", "patch_proposal"]),
  reports: new Set(["generated_report", "safety_issue_report"]),
  testing: new Set(["test_case", "test_result", "verification_run", "implementation_evidence"]),
};

export function artifactTypesForAreas(areas: string[] = []): Set<string> | null {
  const types = new Set<string>();
  areas.forEach(area => SCOPE_ARTIFACT_TYPES[area]?.forEach(type => types.add(type)));
  return types.size ? types : null;
}
