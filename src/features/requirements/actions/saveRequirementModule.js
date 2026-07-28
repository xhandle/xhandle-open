import { focusModule } from "./requirementsState";

export async function saveRequirementModule({ moduleId, folderId } = {}) {
  return focusModule(moduleId, { folderId });
}

export default saveRequirementModule;
