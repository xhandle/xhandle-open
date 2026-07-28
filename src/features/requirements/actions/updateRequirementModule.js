import { updateModuleRecord } from "./requirementsState";

export async function updateRequirementModule({ moduleId, patch = {}, folderId } = {}) {
  return updateModuleRecord({ moduleId, patch, folderId });
}

export default updateRequirementModule;
