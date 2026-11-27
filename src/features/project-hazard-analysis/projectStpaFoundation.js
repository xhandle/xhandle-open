import { hazardContentFingerprint } from './hazardContentFingerprint';
import { needsPracticalStpaCompletion } from './stpaAcceptance';

export const STPA_BASIS = 'stpaFoundationBasis';
const value = cell => String(cell && typeof cell === 'object' && 'value' in cell ? cell.value ?? '' : cell ?? '').trim();
const aliases = {
  from: ['Function (From)', 'fromFunction', 'from'], fromDetails: ['Function (From) Details', 'fromDetails', 'fromFunctionDetails'],
  action: ['Control Action', 'controlAction', 'action'], actionDetails: ['Control Action Details', 'controlDetails', 'controlActionDetails'],
  to: ['Function (To)', 'toFunction', 'to'], toDetails: ['Function (To) Details', 'toDetails', 'toFunctionDetails'],
  guide: ['Guide Phrase', 'guidePhrase'], context: ['Operational Context ID', 'hazardContextId', 'operationalContextId'],
  scenario: ['Operational Scenario', 'operationalScenario'], mode: ['Operational Mode', 'operationalMode'],
  conditions: ['Operating Conditions', 'operatingConditions'], assumptions: ['Context Assumptions', 'contextAssumptions'],
};
export function stpaSource(row = {}) {
  return Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, value(names.map(name => row[name]).find(cell => value(cell)))]));
}
export const stpaSourceKey = row => JSON.stringify(['from','action','to','guide','context','scenario','mode'].map(key => stpaSource(row)[key]));
const cells = (headers, row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
const coreAliases = {
  Losses:'Loss', Hazards:'Hazard', 'Unsafe Control Actions':'Unsafe Control Action',
  'Causal Factors':'Causal Factor', 'Safety Requirements/Constraints':'Safety Constraint',
};
function canonicalSummary(summary) {
  if (!summary?.[0]) return summary;
  const original=summary[0], names=original.map(header=>coreAliases[header]||header), headers=[...new Set(names)];
  const indices=headers.map(header=>names.map((name,index)=>name===header?index:-1).filter(index=>index>=0));
  return [headers,...summary.slice(1).map(row=>indices.map(columns=>columns.map(index=>row[index]).find(cell=>value(cell))??''))];
}
const signature = input => hazardContentFingerprint(input).signature;
const profile = options => options.stpaProfileProvenance?.effectiveContextIdentity || signature(options.organizationContext || '');
export function projectStpaSources(sheets = {}, sourceRows = []) {
  const [headers = [], ...rows] = sheets['Functional Decomposition'] || [];
  return rows.map((row, index) => {
    const fd = stpaSource(cells(headers, row)), original = stpaSource(sourceRows[index]);
    return Object.fromEntries(Object.entries(aliases).map(([key, names]) => [names[0], names.some(name => Object.prototype.hasOwnProperty.call(sourceRows[index] || {}, name)) ? original[key] : fd[key]]));
  });
}
function basis(source, options) {
  return signature({ source: stpaSource(source), profile: profile(options),
    // Row-level context permits reuse of a selected subset of a prior run.
    context: stpaSource(source).scenario ? '' : options.operationalContext || '' });
}
function sourceBasis(source, options = {}) {
  return signature({source:stpaSource(source),context:stpaSource(source).scenario?'':options.operationalContext||''});
}
export function annotateProjectStpaFoundation(result, sources, options = {}) {
  const entries = {},sourceEntries={},profileIdentities={};
  for (const source of sources) {
    const key=stpaSourceKey(source);
    entries[key]=basis(source,options);sourceEntries[key]=sourceBasis(source,options);profileIdentities[key]=profile(options);
  }
  return { ...result, [STPA_BASIS]: { version: 2, entries,sourceEntries,profileIdentities } };
}
export function mergeProjectStpaFoundations(previous, next) {
  if (next?.Summary?.[0]) next={...next,Summary:canonicalSummary(next.Summary)};
  if (previous?.Summary?.[0]) previous={...previous,Summary:canonicalSummary(previous.Summary)};
  if (!previous?.Summary?.[0]) return next;
  if (!next?.Summary?.[0]) return previous;
  const headers = [...new Set([...previous.Summary[0], ...next.Summary[0]])];
  const rows = new Map();
  for (const sheet of [previous.Summary, next.Summary]) for (const row of sheet.slice(1)) {
    const record = cells(sheet[0], row); rows.set(stpaSourceKey(record), headers.map(header => record[header] ?? ''));
  }
  const fdHeaders = [...new Set([...(previous['Functional Decomposition']?.[0] || []), ...(next['Functional Decomposition']?.[0] || [])])];
  const fdRows = new Map();
  for (const sheet of [previous['Functional Decomposition'],next['Functional Decomposition']]) if (sheet?.[0]) for (const row of sheet.slice(1)) { const record=cells(sheet[0],row);fdRows.set(stpaSourceKey(record),fdHeaders.map(header=>record[header]??'')); }
  return { ...previous, ...next, ...(fdHeaders.length ? {'Functional Decomposition':[fdHeaders,...fdRows.values()]} : {}), Summary: [headers, ...rows.values()], [STPA_BASIS]: { version: 2,
    entries: { ...previous[STPA_BASIS]?.entries, ...next[STPA_BASIS]?.entries },
    sourceEntries:{...previous[STPA_BASIS]?.sourceEntries,...next[STPA_BASIS]?.sourceEntries},
    profileIdentities:{...previous[STPA_BASIS]?.profileIdentities,...next[STPA_BASIS]?.profileIdentities} } };
}

// HARA consumes completed STPA as source work. A policy edit does not revoke
// that work or authorize repeating STPA. Only changed/missing source work needs
// generation. Keep its original calibration identity separately from reuse.
export function reusableProjectStpaRows(record, sources, options = {}) {
  const result = record?.analysisResult || record;
  const [headers, ...rows] = canonicalSummary(result?.Summary) || [];
  if (!headers) return sources.map(() => null);
  const sourceMap = new Map(projectStpaSources(result).map(source => [stpaSourceKey(source), source]));
  const byKey = new Map();
  for (const row of rows) {
    const key = stpaSourceKey(cells(headers, row));
    byKey.set(key, byKey.has(key) ? null : row);
  }
  const drafts = Object.values(record?.draftHazardRowsByIndex || {});
  return sources.map(source => {
    const key = stpaSourceKey(source), row = byKey.get(key);
    if (!row || needsPracticalStpaCompletion(headers, row)) return null;
    const savedSourceBasis = result[STPA_BASIS]?.sourceEntries?.[key];
    if (savedSourceBasis ? savedSourceBasis !== sourceBasis(source, options) : !legacyMatches()) return null;
    return { headers, row };
    function legacyMatches() {
      const original = sourceMap.get(key);
      if (!original || signature(stpaSource(original)) !== signature(stpaSource(source))) return false;
      // Explicit row context and saved functional inputs establish compatibility
      // even for a version-1 record calibrated under a different profile.
      if(stpaSource(source).scenario)return true;
      // Older records may have depended on global context absent from the row.
      // Verify that context with the original profile, never today's profile.
      const originalIdIndex=result.Summary[0].indexOf('Raw Analysis Row ID');
      const idIndex=headers.indexOf('Raw Analysis Row ID');
      const saved = idIndex>=0&&originalIdIndex>=0 ? drafts.find(draft => draft.row?.[originalIdIndex] === row[idIndex])?.organizationProfileProvenance : null;
      const originalProfile=result[STPA_BASIS]?.profileIdentities?.[key]||saved?.effectiveContextIdentity;
      const savedBasis=result[STPA_BASIS]?.entries?.[key];
      return Boolean(savedBasis&&originalProfile&&savedBasis===basis(source,{...options,stpaProfileProvenance:{effectiveContextIdentity:originalProfile}}));
    }
  });
}

// A HARA view can show its existing STPA basis before any HARA assessment has
// been generated. Project only common columns: ratings, goals, event IDs and
// completion state remain owned by HARA. Keep the HARA draft's row identity.
const haraCommonStpaColumns = new Set([
  'Function (From)', 'Control Action', 'Function (To)', 'Subsystem Allocation',
  'Guide Phrase', 'Guide Phrase Applicable', 'Guide Phrase Applicability Rationale',
  'Safety Significant', 'Safety Significance Rationale', 'Safety Classification',
  'Loss', 'Hazard', 'Raw Loss Candidate', 'Raw Hazard Candidate',
  'Canonical Loss ID', 'Canonical Hazard ID', 'Unsafe Control Action',
  'Causal Scenario', 'Causal Factor', 'Safety Constraint', 'Verification Method',
  'Operational Context ID', 'Operational Scenario', 'Operational Mode',
  'Operating Conditions', 'Context Assumptions',
]);
export function projectHaraStpaDisplayRows(record, sources, headers, fallbackRows, options = {}) {
  const result = record?.analysisResult || record;
  const [savedHeaders, ...rows] = canonicalSummary(result?.Summary) || [];
  const legacyByKey = new Map();
  // Older method snapshots may contain only the displayed Summary. They can
  // still be displayed by interface/guide/context, without asserting that their
  // source provenance is sufficient to skip generation validation.
  if (savedHeaders && !result?.['Functional Decomposition'] && !result?.[STPA_BASIS]) {
    for (const row of rows) {
      const key = stpaSourceKey(cells(savedHeaders, row));
      legacyByKey.set(key, legacyByKey.has(key) ? null : {headers: savedHeaders, row});
    }
  }
  return reusableProjectStpaRows(record, sources, options).map((reused, index) => {
    const saved = reused || legacyByKey.get(stpaSourceKey(sources[index]));
    if (!saved) return null;
    const common = cells(saved.headers, saved.row);
    return headers.map((header, column) => {
      if (header === 'STPA Source Row ID') return common['Raw Analysis Row ID'] || '';
      if (header === 'Functional Safety Requirements') return common['System Requirement'] || common['Safety Constraint'] || '';
      return haraCommonStpaColumns.has(header) && value(common[header])
        ? common[header] : fallbackRows[index]?.[column] ?? '';
    });
  });
}

export async function resolveProjectStpaFoundation({ sheets, stpaSourceRows = [], stpaFoundationRecord, generate, ...options }) {
  const sources = projectStpaSources(sheets, stpaSourceRows);
  const reused = reusableProjectStpaRows(stpaFoundationRecord, sources, options);
  const missing = sources.map((source, index) => ({source,index})).filter(({index}) => !reused[index]);
  options.onProgress?.({message: `Reusing ${sources.length - missing.length} of ${sources.length} completed STPA assessments; ${missing.length ? `generating ${missing.length} remaining assessments` : 'generating HARA outputs only'}.`});
  let generated;
  if (missing.length) {
    const fd = sheets['Functional Decomposition'];
    generated = await generate({ ...sheets, 'Functional Decomposition': [fd[0], ...missing.map(({index}) => fd[index + 1])] });
  }
  const generatedHeaders = generated?.Summary?.[0] || [];
  const headers = [...new Set([...reused.flatMap(item => item?.headers || []), ...generatedHeaders])];
  let cursor = 1;
  const rows = sources.map((source, index) => {
    const item = reused[index] || {headers: generatedHeaders, row: generated.Summary[cursor++]};
    const record = cells(item.headers, item.row);
    return headers.map(header => record[header] ?? '');
  });
  const result=annotateProjectStpaFoundation({ ...generated, 'Functional Decomposition': sheets['Functional Decomposition'], Summary: [headers, ...rows] }, sources, options);
  const previous=stpaFoundationRecord?.analysisResult||stpaFoundationRecord;
  const drafts=Object.values(stpaFoundationRecord?.draftHazardRowsByIndex||{});
  for(let index=0;index<sources.length;index++){
    const item=reused[index];if(!item)continue;
    const key=stpaSourceKey(sources[index]),savedBasis=previous?.[STPA_BASIS];
    if(savedBasis?.entries?.[key])result[STPA_BASIS].entries[key]=savedBasis.entries[key];
    else delete result[STPA_BASIS].entries[key];
    const originalHeaders=previous?.Summary?.[0]||[],idColumn=originalHeaders.indexOf('Raw Analysis Row ID');
    const id=item.row[item.headers.indexOf('Raw Analysis Row ID')];
    const draft=idColumn>=0?drafts.find(draft=>draft.row?.[idColumn]===id):null;
    result[STPA_BASIS].profileIdentities[key]=savedBasis?.profileIdentities?.[key]||draft?.organizationProfileProvenance?.effectiveContextIdentity||null;
  }
  return result;
}

export function reconcileStpaFoundationDrafts(record, next) {
  const previous=record?.analysisResult,[headers,...rows]=previous?.Summary||[];
  if(!headers || !next?.Summary?.[0])return record?.draftHazardRowsByIndex||{};
  const idIndex=headers.indexOf('Raw Analysis Row ID');
  if(idIndex<0)return record?.draftHazardRowsByIndex||{};
  const byId=new Map(rows.map(row=>[row[idIndex],cells(headers,row)]));
  const nextHeaders=next.Summary[0],incoming=new Map(next.Summary.slice(1).map(row=>{const source=cells(nextHeaders,row);return [stpaSourceKey(source),source];}));
  return Object.fromEntries(Object.entries(record.draftHazardRowsByIndex||{}).map(([key,draft])=>{
    const original=byId.get(draft.row?.[idIndex]),sourceKey=original&&stpaSourceKey(original),updated=incoming.get(sourceKey);
    if(!updated)return [key,draft];
    const oldBasis=previous[STPA_BASIS]?.entries?.[sourceKey],newBasis=next[STPA_BASIS]?.entries?.[sourceKey];
    const changed=oldBasis && newBasis && oldBasis!==newBasis || headers.some(header=>header in updated && value(original[header])!==value(updated[header]));
    if(!changed)return [key,draft];
    // Display the newly generated Summary while retaining analyst-owned inputs
    // and review history for reconciliation against the changed source basis.
    const retained={...draft};delete retained.organizationProfileProvenance;
    return [key,{...retained,generated:false,...(draft.userPreprocessing?{userPreprocessing:{...draft.userPreprocessing,pending:true}}:{})}];
  }));
}
