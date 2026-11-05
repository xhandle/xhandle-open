const stages = {
  opening: 'Opening saved project information',
  waiting: 'Waiting for access to saved project information',
  projects: 'Reading the project catalog',
  projectData: 'Preparing functional diagram information',
  generatedReports: 'Preparing saved reports',
  durableProjectAnalysis: 'Preparing saved project analyses',
  requirements: 'Preparing saved requirements',
  codeArchitecture: 'Preparing saved code architecture',
  codeArchitectureAssurance: 'Preparing architecture analysis results',
  codeIndex: 'Preparing source references',
  sysml: 'Preparing design models',
  traceability: 'Preparing traceability information',
  verificationTests: 'Preparing validation information',
  indexedFeatureStores: 'Preparing saved analysis information',
  reconciliation: 'Checking the prepared information for changes',
  projection: 'Preparing searchable project information',
  searching: 'Finding relevant saved information',
  relationships: 'Checking related project information',
};

// Counts are completed local index records, not percentages or AI reasoning.
export function formatRetrievalProgress({ step, recordsPrepared } = {}) {
  const label = stages[step] || 'Preparing saved project information';
  return Number.isFinite(recordsPrepared) && recordsPrepared > 0
    ? `${label}… ${Math.floor(recordsPrepared).toLocaleString()} records prepared so far.`
    : `${label}…`;
}
