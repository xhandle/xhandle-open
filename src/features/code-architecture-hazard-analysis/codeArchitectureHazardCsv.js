import { ensureHazardAnalysisRowIds } from '../project-hazard-analysis/classificationResolutionStatus';
import {
  buildCodeArchitectureHazardInput, HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
  traceabilityObjectToSummaryFields, normalizeCodeArchitectureHazardRun,
  makeCodeArchitectureHazardId,
} from './codeArchitectureHazardUtils';

// Build the same eligible interfaces, guide phrases and contexts as the AI runner,
// without generating analysis or persisting a run merely to export it.
export function buildCodeArchitectureHazardCsvDraft(options, hazardHeaders, onProgress) {
  onProgress?.(0);
  const input = buildCodeArchitectureHazardInput({ ...options, selectedOperationalContextId: 'all' }, percent => onProgress?.(Math.max(1, Math.floor(percent * 0.8))));
  onProgress?.(80);
  const headers = [...new Set([...hazardHeaders, ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS])];
  const rows = input.tableRows.map((row, index) => {
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
    const cells = headers.map(header => values[header] || '');
    // Reserve completion for normalization and receipt of the finished draft.
    onProgress?.(80 + Math.floor(((index + 1) / input.tableRows.length) * 15));
    return cells;
  });
  const id = makeCodeArchitectureHazardId('cba-hazard-csv');
  onProgress?.(95);
  const result = normalizeCodeArchitectureHazardRun({
    ...input, id, sourceRunId: id, hazardMethod: options.method,
    hazardEligibilitySummary: input.eligibilitySummary,
    operationalContexts: input.configuredOperationalContexts,
    generatedSheets: { ...input.sheets, Summary: ensureHazardAnalysisRowIds([headers, ...rows]) },
  }, { repoMeta: options.repoMeta });
  onProgress?.(99);
  return result;
}
