import { createModuleRecord } from "./requirementsState";

export async function createRequirementModule({ name, description = "", type = "Requirement", folderId } = {}) {
  return createModuleRecord({ name, description, type, folderId });
}

export default createRequirementModule;
