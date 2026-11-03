import { normalizeHazardOperationalContexts } from '../project-hazard-analysis/hazardOperationalContexts';
import { summarySheetToHazardSummaryRows } from './codeArchitectureHazardUtils';

// A reusable row transform lets streaming imports share the same context policy
// without retaining the full table or rebuilding context indexes per row.
export function createImportedHazardContextAssigner(sourceHeaders, contexts) {
  const normalized = normalizeHazardOperationalContexts(contexts);
  const fields = ['Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Context Assumptions'];
  const headers = [...sourceHeaders];
  fields.forEach(header => { if (!headers.includes(header)) headers.push(header); });
  const indices = new Map(headers.map((header, index) => [header, index]));
  const contextsById = new Map(normalized.map(context => [context.id, context]));
  return {headers, contexts:normalized, assign(original, previous) {
    const get = header => String(original[indices.get(header)] || '').trim();
    const id = get('Operational Context ID');
    const unspecified = (!id || id === 'context-unspecified')
      && (!get('Operational Scenario') || get('Operational Scenario') === 'Unspecified scenario')
      && (!get('Operational Mode') || get('Operational Mode') === 'Unspecified mode');
    const context = unspecified && normalized.length === 1 ? normalized[0] : contextsById.get(id);
    if (!context) return {row:original, preprocessing:previous, changed:false};
    const values = [context.id, context.scenario, context.mode, context.conditions, context.assumptions];
    if (fields.every((field, index) => get(field) === values[index])) return {row:original, preprocessing:previous, changed:false};
    const row = headers.map((_, index) => original[index] ?? '');
    fields.forEach((field, index) => {row[indices.get(field)] = values[index];});
    return {row, changed:true, preprocessing:previous && {...previous,
      // Retain the scenario/mode basis so reassignment requires review.
      basis:{...previous.basis, 'Operational Context ID':context.id},
      context:{...previous.context, ...Object.fromEntries(fields.map((field,i)=>[field,values[i]]))},
      conflicts:[...new Set([...(previous.conflicts || []),'Operational context changed; imported assessments require review.'])],
    }};
  }};
}

export function assignImportedHazardContext(run, contexts) {
  if (!run?.csvImportPreviousSummary) return run;
  const source = run.generatedSheets?.Summary;
  if (!source?.length) return run;
  const assigner = createImportedHazardContextAssigner(source[0], contexts);
  const ownership = {...run.userPreprocessing};
  const idColumn = source[0].indexOf('Raw Analysis Row ID');
  let changed = false;
  const rows = source.slice(1).map(original => {
    const rowId = String(original[idColumn] || '').trim();
    const result = assigner.assign(original, ownership[rowId]);
    changed ||= result.changed;
    if (result.preprocessing) ownership[rowId] = result.preprocessing;
    return result.row;
  });
  if (!changed) return run;
  const summary = [assigner.headers,...rows];
  return {...run, userPreprocessing:ownership,
    userPreprocessingConflicts:Object.entries(ownership).flatMap(([id,item])=>(item.conflicts || []).map(message=>`${id}: ${message}`)),
    generatedSheets:{...run.generatedSheets,Summary:summary}, summaryRows:summarySheetToHazardSummaryRows(summary),
    operationalContexts:assigner.contexts, analysisOperationalContexts:assigner.contexts, updatedAt:new Date().toISOString()};
}
