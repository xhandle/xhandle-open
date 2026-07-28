import { replaceModuleRequirements } from "./requirementsState";

export async function populateRequirementModule({ moduleId, rows = [], folderId } = {}) {
  return replaceModuleRequirements({ moduleId, rows, folderId, author: "xHandle Collaborator" });
}

export default populateRequirementModule;
