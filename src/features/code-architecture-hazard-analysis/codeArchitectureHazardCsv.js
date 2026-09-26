import { ensureHazardAnalysisRowIds } from '../project-hazard-analysis/classificationResolutionStatus';
import {
  buildCodeArchitectureHazardInput, HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
  traceabilityObjectToSummaryFields, normalizeCodeArchitectureHazardRun,
  makeCodeArchitectureHazardId,
} from './codeArchitectureHazardUtils';

// Build the same eligible interfaces, guide phrases and contexts as the AI runner,
// without generating analysis or persisting a run merely to export it.
export function buildCodeArchitectureHazardCsvDraft(options, hazardHeaders) {
  const input = buildCodeArchitectureHazardInput({ ...options, selectedOperationalContextId: 'all' });
  const headers = [...new Set([...hazardHeaders, ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS])];
  const rows = input.tableRows.map(row => {
    const values = {
      ...traceabilityObjectToSummaryFields(row.traceability),
      'Function (From)': row.fromFunction, 'Control Action': row.controlAction,
      'Function (To)': row.toFunction, 'Item / Function': row.fromFunction,
      Function: row.fromFunction, 'Guide Phrase': row.guidePhrase,
      'Subsystem Allocation': row.traceability?.subsystem || '',
      'Operational Context ID': row.operationalContextId,
      'Operational Scenario': row.operationalScenario, 'Operational Mode': row.operationalMode,
      'Operating Conditions': row.operatingConditions, 'Context Assumptions': row.contextAssumptions,
    };
    return headers.map(header => values[header] || '');
  });
  const id = makeCodeArchitectureHazardId('cba-hazard-csv');
  return normalizeCodeArchitectureHazardRun({
    ...input, id, sourceRunId: id, hazardMethod: options.method,
    hazardEligibilitySummary: input.eligibilitySummary,
    operationalContexts: input.configuredOperationalContexts,
    generatedSheets: { ...input.sheets, Summary: ensureHazardAnalysisRowIds([headers, ...rows]) },
  }, { repoMeta: options.repoMeta });
}
