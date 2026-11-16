const requirements = ['safety-requirements', 'system-spec', 'subsystem-spec', 'software-spec', 'hardware-spec', 'interface-spec'];
const atomicRequirements = ['safety-requirements', 'software-spec', 'hardware-spec'];

export const isRequirementsArtifact = templateId => requirements.includes(templateId);
export const usesAtomicRequirements = templateId => atomicRequirements.includes(templateId);
