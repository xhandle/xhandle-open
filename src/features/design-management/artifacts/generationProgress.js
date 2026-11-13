export const generationStageLabel = stage => ({ preparing: 'Preparing sources', reviewing: 'Reviewing shared evidence', synthesizing: 'Writing concise section', generating: 'Generating content', retrying: 'Retrying request', saving: 'Saving draft', verifying: 'Checking completed draft', complete: 'Ready for review', paused: 'Paused', error: 'Needs attention' }[stage] || 'Starting generation');
export function generationProgressSummary(details = {}) {
  const parts = [];
  if (Number.isFinite(details.totalDocuments)) parts.push(`${details.completedDocuments || 0} of ${details.totalDocuments} documents ready`);
  if (Number.isFinite(details.totalSections)) parts.push(`${details.completedSections || 0} of ${details.totalSections} sections saved`);
  if (details.reviewGroup && details.stage === 'reviewing') parts.push(`Evidence group ${details.reviewGroup} of ${details.reviewGroups}`);
  if (Number.isFinite(details.requestsMade)) parts.push(`${details.requestsMade} AI requests this run`);
  if (details.savedParts) parts.push(`${details.savedParts} partial ${details.savedParts === 1 ? 'part' : 'parts'} saved`);
  return parts.join(' · ');
}
