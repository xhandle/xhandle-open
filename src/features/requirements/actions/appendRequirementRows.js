import { appendModuleRequirements } from "./requirementsState";

export async function appendRequirementRows({ moduleId, rows = [], folderId } = {}) {
  return appendModuleRequirements({ moduleId, rows, folderId });
}

export default appendRequirementRows;
