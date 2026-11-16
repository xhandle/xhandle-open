import { PROJECT_HARA_HEADERS, refreshProjectHaraSheets } from '../project-hazard-analysis/projectHara';
import { HARA_QUALITY_FIELDS, HARA_QUALITY_GUIDANCE } from '../project-hazard-analysis/haraAssessmentQuality';

const DISPLAY_NAMES = {
  'Item / Function': 'Function',
  Malfunction: 'Malfunctioning Behavior',
  'Verification Method': 'Verification',
};
const DISPLAY_ALIASES = Object.fromEntries(Object.entries(DISPLAY_NAMES).map(([header,label])=>[header.toLowerCase(),label]));
export const codeHaraColumnLabel = header => DISPLAY_ALIASES[String(header || '').trim().toLowerCase()] || header;
export const CODE_HARA_COLUMNS = [...new Set([
  'Function', 'Operational Scenario', 'Operational Mode', 'Operating Conditions',
  'Guide Phrase', 'Guide Phrase Applicable',
  ...PROJECT_HARA_HEADERS.map(codeHaraColumnLabel), 'Safety Classification',
])];

export const HARA_ADDITIONAL_FIELDS = {
  potentialHarm: 'Potential Harm', personsAtRisk: 'Persons at Risk',
  severityRationale: 'Severity Rationale', exposureRationale: 'Exposure Rationale',
  controllabilityRationale: 'Controllability Rationale', safeState: 'Safe State',
  ftti: 'Fault Tolerant Time Interval', fttiRationale: 'FTTI Rationale',
  itemDefinition: 'Item Definition', gaps: 'Assessment Gaps',
  ...HARA_QUALITY_FIELDS,
};
// Missing timing, safe-state and item-boundary evidence must remain explicit
// gaps. These fields are part of every response but may contain an empty value.
export const HARA_OPTIONAL_FIELDS = new Set(['safeState', 'ftti', 'fttiRationale', 'itemDefinition', 'gaps', ...Object.keys(HARA_QUALITY_FIELDS)]);
export const HARA_GENERATION_GUIDANCE = `HARA: return separate malfunction, hazardousEvent, potentialHarm, personsAtRisk, uca, loss, hazard, causalScenario, safetyConstraint and itemDefinition. Use severity S0-S3, exposure E0-E4 and controllability C0-C3 with separate rationales; ratingRationale is their concise summary. ASIL and event/goal IDs are calculated locally.
${HARA_QUALITY_GUIDANCE}`;

/** Add missing columns without changing saved values or inferring old ratings. */
export function expandCodeHaraSheet(sheet) {
  if (!Array.isArray(sheet?.[0])) return sheet;
  const existing = new Set(sheet[0].map(header=>String(codeHaraColumnLabel(header)).trim().toLowerCase()));
  const missing = CODE_HARA_COLUMNS.filter(header => !existing.has(header.toLowerCase()));
  if (!missing.length) return sheet;
  return [[...sheet[0], ...missing], ...sheet.slice(1).map(row => [
    ...sheet[0].map((_, index) => row?.[index] ?? ''), ...missing.map(() => ''),
  ])];
}

/** Use the Projects calculator for newly generated, reconciled HARA results. */
export function finalizeCodeHaraSheets(sheets) {
  const summary = expandCodeHaraSheet(sheets?.Summary);
  if (!Array.isArray(summary?.[0])) return sheets;
  const headers = summary[0];
  const canonical = Object.fromEntries(Object.entries(DISPLAY_NAMES).map(([key, value]) => [value, key]));
  const canonicalHeaders = headers.map(header => canonical[header] && !headers.includes(canonical[header]) ? canonical[header] : header);
  const calculated = refreshProjectHaraSheets({ ...sheets, Summary: [canonicalHeaders, ...summary.slice(1)] });
  const result = [headers, ...calculated.Summary.slice(1)];
  return { ...calculated, Summary: result, HARA: result };
}
