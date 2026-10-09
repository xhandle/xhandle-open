import { normalizeHazardOperationalContexts } from '../project-hazard-analysis/hazardOperationalContexts';
import { summarySheetToHazardSummaryRows } from './codeArchitectureHazardUtils';

// Imported preprocessing can belong to a draft or an existing analysis.
// Attach its unassigned rows only when the
// user's configured context is unambiguous; leave unimported AI runs alone.
export function assignImportedHazardContext(run, contexts) {
  if (!run?.csvImportPreviousSummary) return run;
  const normalized = normalizeHazardOperationalContexts(contexts);
  const source = run.generatedSheets?.Summary;
  if (!source?.length) return run;
  const headers = [...source[0]];
  const fields = ['Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Context Assumptions'];
  fields.forEach(header => { if (!headers.includes(header)) headers.push(header); });
  const ownership = {...run.userPreprocessing};
  let changed = false;
  const rows = source.slice(1).map(original => {
    const row = headers.map((_, index) => original[index] ?? '');
    const get = header => String(row[headers.indexOf(header)] || '').trim();
    const id = get('Operational Context ID');
    const unspecified = (!id || id === 'context-unspecified')
      && (!get('Operational Scenario') || get('Operational Scenario') === 'Unspecified scenario')
      && (!get('Operational Mode') || get('Operational Mode') === 'Unspecified mode');
    const context = unspecified && normalized.length === 1 ? normalized[0]
      : normalized.find(entry => entry.id === id);
    if (!context) return original;
    const values = [context.id, context.scenario, context.mode, context.conditions, context.assumptions];
    if (fields.every((field, index) => get(field) === values[index])) return original;
    changed = true;
    fields.forEach((field, index) => {row[headers.indexOf(field)] = values[index];});
    const rowId = get('Raw Analysis Row ID');
    const previous = ownership[rowId];
    if (previous) {
      ownership[rowId] = {...previous,
        // Keep the old scenario/mode basis: the decision is retained, not
        // silently certified for a newly supplied operational scenario.
        basis: {...previous.basis, 'Operational Context ID':context.id},
        context: {...previous.context, ...Object.fromEntries(fields.map((field,i)=>[field,values[i]]))},
        conflicts:[...new Set([...(previous.conflicts || []),'Operational context changed; imported assessments require review.'])],
      };
    }
    return row;
  });
  if (!changed) return run;
  const summary = [headers,...rows];
  return {...run, userPreprocessing:ownership,
    userPreprocessingConflicts:Object.entries(ownership).flatMap(([id,item])=>(item.conflicts || []).map(message=>`${id}: ${message}`)),
    generatedSheets:{...run.generatedSheets,Summary:summary}, summaryRows:summarySheetToHazardSummaryRows(summary),
    operationalContexts:normalized, analysisOperationalContexts:normalized, updatedAt:new Date().toISOString()};
}
