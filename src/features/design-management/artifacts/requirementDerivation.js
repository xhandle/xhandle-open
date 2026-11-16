// The engineering direction follows the selected source, not the artifact label.
// Persist it on derived configurations, which intentionally omit raw diagrams.
export function requirementDerivationMode(config = {}) {
  if (config.requirementDerivation) return config.requirementDerivation;
  const diagrams = config.architectureSources || [];
  const owners = config.owners || config.ownerProjects || [{ workspaceType: config.workspaceType }];
  const code = diagrams.length ? diagrams.some(source => source.workspaceType === 'code-architecture')
    : config.workspaceType ? config.workspaceType === 'code-architecture' : owners.length > 0 && owners.every(owner => owner.workspaceType === 'code-architecture');
  return code ? 'code-first' : 'system-first';
}
export function upstreamRequirementTemplate(config) {
  if (config.templateId === 'hardware-spec') return 'system-spec';
  if (config.templateId === 'software-spec' && requirementDerivationMode(config) === 'system-first') return 'system-spec';
  if (config.templateId === 'system-spec' && requirementDerivationMode(config) === 'code-first') return 'software-spec';
  return null;
}
export function requirementDiagramSources(config) {
  const sources = config.architectureSources || [];
  if (requirementDerivationMode(config) !== 'code-first') return upstreamRequirementTemplate(config) ? [] : sources;
  if (config.templateId === 'system-spec') return sources.filter(source => source.workspaceType === 'functional');
  if (config.templateId === 'software-spec') return sources.filter(source => source.workspaceType === 'code-architecture');
  return upstreamRequirementTemplate(config) ? [] : sources;
}
export function requirementPrerequisites(artifacts, config) {
  const result = [...artifacts];
  for (let index = 0; index < result.length; index++) {
    const parent = upstreamRequirementTemplate({ ...config, templateId: result[index].templateId });
    if (parent && !result.some(item => item.templateId === parent)) result.push({ templateId: parent });
  }
  return result;
}
export const requirementDerivationFlow = config => requirementDerivationMode(config) === 'code-first'
  ? 'Code-Based Architecture → Software Requirements → System Requirements → Hardware Requirements'
  : 'Projects decomposition → System Requirements → Software and Hardware Requirements';
