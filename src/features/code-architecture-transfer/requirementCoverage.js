import { splitIds as ids } from '../code-architecture-assurance/artifactUtils';

const covers = (expected, actual) => expected.length > 0 && expected.every(id => actual.has(id));

// Cache acceptance is deliberately stricter than rendering/fallback. A partial
// answer may be displayed, but must not suppress future attempts to finish work.
export function hasCompleteRequirementCoverage(payload, rows, responseKey = 'requirements') {
  if (!Array.isArray(rows) || !rows.length) return false;
  if (payload.task === 'derive_software_requirements_from_functional_decomposition_batch') {
    const sources = payload.functionalDecomposition || [];
    return sources.length > 0 && rows.length === sources.length && sources.every((source, index) =>
      String(rows[index]?.sourceTraceId || '') === String(source.traceId || source.rowRef) && Boolean(rows[index]?.requirementText?.trim()));
  }
  if (payload.task === 'rewrite_code_echo_software_requirements') {
    const sources = payload.requirements || [];
    return sources.length > 0 && rows.length === sources.length && sources.every((source, index) =>
      rows[index]?.id === source.id && rows[index]?.sourceTraceId === source.sourceTraceId && Boolean(rows[index]?.requirementText?.trim()));
  }
  const field = ['parentSwRequirement', 'parentSystemRequirement', 'parentRequirement'].find(name =>
    Object.hasOwn(payload.schema?.[responseKey]?.[0] || {}, name));
  if (!field) return false; // Unknown contracts cannot safely be marked complete.
  const sourceKey = ['sourceRequirements', 'draftCategories', 'hazardSoftwareRequirements',
    'softwareRequirementCategories', 'systemRequirementCategories', 'subsystemRequirementCategories',
    'candidateSystemRequirements', 'candidateSubsystemRequirements', 'candidateDesignElements'].find(key => Array.isArray(payload[key]));
  if (!sourceKey) return false;
  const sources = payload[sourceKey];
  const expected = source => ids(['sourceRequirements', 'hazardSoftwareRequirements'].includes(sourceKey) ? source.id : source[field]);
  const actual = row => new Set(ids(row?.[field]));
  if (sourceKey === 'hazardSoftwareRequirements' || sourceKey.endsWith('RequirementCategories')) {
    // These callers consume responses positionally, so union coverage is insufficient.
    return sources.length > 0 && rows.length === sources.length && sources.every((source, index) => covers(expected(source), actual(rows[index])));
  }
  // Categorization and consolidation allow fewer outputs, but must preserve every parent.
  return covers(sources.flatMap(expected), new Set(rows.flatMap(row => ids(row?.[field]))));
}
