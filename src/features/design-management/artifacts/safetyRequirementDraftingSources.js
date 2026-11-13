export const SAFETY_REQUIREMENT_DRAFTING_SCOPE = 'actionable-issues-and-constraints-v1';

// Draft from the consolidated concern and its recorded protective constraints.
// Keep the complete HTL snapshot in the saved manifest for traceability, but do
// not send scenario, loss, classification or verification inventories to the AI.
export function safetyRequirementDraftingSources(manifest) {
  return { ...manifest, entries: manifest.entries.map(source => {
    if (source.sourceType !== 'hazard-tracking-record' || source.reviewSourceId || source.content?.format === 'hazard-tracking-evidence-fragment') return source;
    const { id, sourceType, artifactId, artifactTitle, revision, recordId, title, text, ownerProjects } = source;
    return { id, sourceType, artifactId, artifactTitle, revision, recordId, title, text, ownerProjects,
      attributes: { HTR: recordId || source.attributes?.HTR, 'Safety Constraint': source.attributes?.['Safety Constraint'] || [] } };
  }) };
}
