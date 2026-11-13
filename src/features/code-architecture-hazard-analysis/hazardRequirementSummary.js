import { PAGED_HAZARD } from './hazardRowIndex';
import { streamHazardSummary } from './streamHazardSummary';

// Never close over the full run: its source snapshot and narrative may dwarf
// the Summary needed by requirements derivation.
export function projectHazardRequirementSummary(run) {
  if (!run) return null;
  const result = {};
  for (const key of ['id', 'projectId', 'repoId', 'hazardMethod', 'createdAt', 'updatedAt',
    'architectureSnapshotHash', 'functionalModelSnapshotHash', 'analysisAbstraction', 'organizationProfileProvenance',
    'runState', 'finalSavePending', PAGED_HAZARD]) {
    if (run[key] !== undefined) result[key] = run[key];
  }
  const summary = run.generatedSheets?.Summary || run.analysisResult?.Summary;
  if (summary) result.generatedSheets = { Summary: summary };
  else if (run.summaryRows) result.summaryRows = run.summaryRows;
  return result;
}

export function createHazardRequirementSource(run) {
  const source = projectHazardRequirementSummary(run);
  if (!source?.[PAGED_HAZARD]) return source;
  const omitted = source[PAGED_HAZARD].omittedMetadata || [];
  if (omitted.some(key => ['organizationProfileProvenance', 'architectureSnapshotHash', 'functionalModelSnapshotHash', 'analysisAbstraction', 'runState', 'finalSavePending'].includes(key))) {
    throw new Error('Saved hazard metadata is incomplete. Open and save the hazard analysis before deriving requirements.');
  }
  source.readSummaryBatches = (signal, onProgress) => streamHazardSummary(source, { signal, onProgress });
  return source;
}
