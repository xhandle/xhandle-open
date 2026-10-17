import { constrainPreprocessedInput, reconcileUserPreprocessing } from '../project-hazard-analysis/hazardUserPreprocessing';

const headers = ['Function (From)', 'Control Action', 'Function (To)', 'Guide Phrase', 'Operational Context ID', 'Operational Scenario', 'Operational Mode', 'Operating Conditions'];
const values = row => [row.fromFunction, row.controlAction, row.toFunction, row.guidePhrase, row.operationalContextId, row.operationalScenario, row.operationalMode, row.operatingConditions].map(value => String(value || '').trim());
const cell = (sheet, row, header) => String(row[sheet[0].indexOf(header)] || '').trim();

// Persist only identity columns for owned rows; narrative cells are not needed
// to restore governed edits after a manifest-only reload.
export function hazardPreprocessingIdentitySheet(run) {
  const columns=[...headers,'Raw Analysis Row ID','Trace ID'];
  const summary=run?.generatedSheets?.Summary;
  const retained=run?.preprocessingIdentitySheet;
  if(!summary?.[0] && !retained?.[0])return null;
  const ownedRows=sheet=>sheet?.[0]?sheet.slice(1)
    .filter(row=>run.userPreprocessing?.[cell(sheet,row,'Raw Analysis Row ID')])
    .map(row=>columns.map(header=>cell(sheet,row,header))):[];
  const current=ownedRows(summary);
  const idColumn=columns.indexOf('Raw Analysis Row ID');
  const retainedRows=ownedRows(retained);
  const retainedById=new Map(retainedRows.map(row=>[row[idColumn],row]));
  const traceColumn=columns.indexOf('Trace ID');
  for(const row of current){
    // Excluded output can contain a display placeholder instead of its trace.
    // Recover the original trace without replacing other current identity fields.
    const saved=retainedById.get(row[idColumn]);
    if(saved && /^(?:not applicable|n\/a)?$/i.test(row[traceColumn]))row[traceColumn]=saved[traceColumn];
  }
  const currentIds=new Set(current.map(row=>row[idColumn]));
  // Partial output has identities only for completed rows. Keep the other
  // owned identities, while allowing current output to update completed ones.
  return [columns,...current,...retainedRows.filter(row=>!currentIds.has(row[idColumn]))];
}

export function prepareCodeHazardPreprocessing(input, previousRun) {
  if (!Object.values(previousRun?.userPreprocessing || {}).some(entry => entry?.values && Object.keys(entry.values).length)) return input;
  const summary = hazardPreprocessingIdentitySheet(previousRun);
  if (!summary?.[0]) throw new Error('Saved user preprocessing is missing its row identities. Restore the prior analysis or review these edits before continuing.');
  const archived = {...previousRun.archivedUserPreprocessing};
  if (/^(HARA|FHA)$/i.test(previousRun.hazardMethod || '') && input.tableRows.some(row => !['','Functional malfunction','Functional degradation or loss'].includes(row.guidePhrase || ''))) {
    const active = {...previousRun.userPreprocessing};
    for (const row of summary.slice(1)) {
      const id=cell(summary,row,'Raw Analysis Row ID');
      if (active[id] && ['','Functional malfunction','Functional degradation or loss'].includes(cell(summary,row,'Guide Phrase'))) {
        archived[id]={...active[id], sourceRunId:previousRun.id, reason:'Legacy whole-function assessment retained; new guide phrases require independent assessment.'};
        delete active[id];
      }
    }
    previousRun={...previousRun,userPreprocessing:active};
  }
  const tableRows = input.tableRows.map(originalRow => {
    // Older HARA/FHA sheets had no explicit guide phrase. Retain that identity
    // for their owned decisions; a display-label addition must not invalidate them.
    const legacy = /^(HARA|FHA)$/i.test(previousRun.hazardMethod || '')
      && ["", "Functional malfunction", "Functional degradation or loss"].includes(originalRow.guidePhrase || "")
      && summary.slice(1).some(previous => {
      const owned = previousRun.userPreprocessing[cell(summary, previous, 'Raw Analysis Row ID')];
      return owned && !cell(summary, previous, 'Guide Phrase')
        && cell(summary, previous, 'Trace ID') === originalRow.traceId
        && String(owned.basis?.['Operational Context ID'] || '') === String(originalRow.operationalContextId || '');
    });
    const row = legacy ? {...originalRow, guidePhrase:''} : originalRow;
    const current = values(row);
    const candidates = summary.slice(1).filter(previous => {
      const id = cell(summary, previous, 'Raw Analysis Row ID');
      const preprocessing = previousRun.userPreprocessing[id];
      if (!preprocessing) return false;
      const trace = cell(summary, previous, 'Trace ID');
      const sameInterface = trace && row.traceId ? trace === row.traceId
        : headers.slice(0, 3).every((header, index) => cell(summary, previous, header) === current[index]);
      return sameInterface && cell(summary, previous, 'Guide Phrase') === current[3]
        && String(preprocessing.basis?.['Operational Context ID'] || '') === current[4];
    });
    if (candidates.length !== 1) return row;
    const id = cell(summary, candidates[0], 'Raw Analysis Row ID');
    const preprocessing = previousRun.userPreprocessing[id];
    const constrained = constrainPreprocessedInput(row, preprocessing, headers, current);
    // A user-supplied No is an exclusion even when its review basis changed.
    // Keep the basis conflict visible, but do not send this row to STPA.
    const excluded = /^no$/i.test(String(preprocessing.values?.['Guide Phrase Applicable'] || '').trim());
    return { ...constrained,
      ...(excluded ? {
        guidePhraseApplicable: 'No',
        guidePhraseApplicabilityRationale: preprocessing.values['Guide Phrase Applicability Rationale'] || '',
      } : {}),
      userPreprocessing: preprocessing, userPreprocessingId: id, userPreprocessingBasis: current };
  });
  const matchedIds = new Set(tableRows.map(row => row.userPreprocessingId).filter(Boolean));
  const unmatched = Object.entries(previousRun.userPreprocessing).filter(([id, assessment]) => {
    if (!Object.keys(assessment?.values || {}).length || matchedIds.has(id)) return false;
    return input.selectedOperationalContextId === 'all' || !input.selectedOperationalContextId
      || assessment.basis?.['Operational Context ID'] === input.selectedOperationalContextId;
  });
  if (unmatched.length) throw new Error(`User preprocessing needs review: ${unmatched.length} assessment row(s) no longer match the architecture, method or context. Review or clear those assessments before generating.`);
  const decomposition = input.sheets['Functional Decomposition'];
  const detailsIndex = decomposition[0].indexOf('Control Action Details');
  return { ...input, archivedUserPreprocessing:archived, tableRows, sheets: { ...input.sheets, 'Functional Decomposition': decomposition.map((row, index) => {
    if (!index || !tableRows[index - 1]?.userPreprocessing) return row;
    const source = tableRows[index - 1];
    const next = [...row]; next[detailsIndex] = source.controlDetails;
    headers.forEach((header, column) => {
      const target = decomposition[0].indexOf(header);
      if (target >= 0) next[target] = values(source)[column];
    });
    const applicabilityIndex = decomposition[0].indexOf('Guide Phrase Applicable');
    const rationaleIndex = decomposition[0].indexOf('Guide Phrase Applicability Rationale');
    const reviewStatusIndex = decomposition[0].indexOf('Guide Phrase Applicability Review Status');
    if (source.guidePhraseApplicabilityReviewStatus === 'Reviewed' || source.guidePhraseApplicable === 'No') {
      if (applicabilityIndex >= 0) next[applicabilityIndex] = source.guidePhraseApplicable;
      if (rationaleIndex >= 0) next[rationaleIndex] = source.guidePhraseApplicabilityRationale;
      if (reviewStatusIndex >= 0 && source.guidePhraseApplicabilityReviewStatus === 'Reviewed') next[reviewStatusIndex] = 'Reviewed';
    }
    return next;
  }) } };
}

export function reconcileCodeHazardPreprocessing(sheets, tableRows) {
  const owned = tableRows.filter(row => row.userPreprocessing);
  if (!owned.length || !sheets?.Summary?.[0]) return { sheets, conflicts: [], ownership: {} };
  const summary = sheets.Summary;
  const conflicts = [];
  const ownership = {};
  const rows = summary.slice(1).map(row => {
    const rowId=row[summary[0].indexOf('Raw Analysis Row ID')];
    const exact=owned.filter(source=>source.userPreprocessingId===rowId);
    const matches = exact.length===1?exact:owned.filter(source => headers.slice(0, 5).every((header, index) => {
      const column = summary[0].indexOf(header);
      return column < 0 || String(row[column] || '').trim() === values(source)[index];
    }));
    if (matches.length !== 1) return row;
    const source = matches[0];
    const basis = summary[0].map(header => source.userPreprocessingBasis[headers.indexOf(header)] || '');
    const result = reconcileUserPreprocessing(summary[0], row, source.userPreprocessing, basis);
    const idIndex = summary[0].indexOf('Raw Analysis Row ID');
    if (idIndex >= 0) result.row[idIndex] = source.userPreprocessingId;
    if (source.guidePhraseApplicable === 'No') {
      const applicabilityIndex = summary[0].indexOf('Guide Phrase Applicable');
      if (applicabilityIndex >= 0) result.row[applicabilityIndex] = 'No';
    }
    ownership[source.userPreprocessingId] = { ...source.userPreprocessing, pending: false, conflicts: result.conflicts };
    conflicts.push(...result.conflicts.map(message => `${source.userPreprocessingId}: ${message}`));
    return result.row;
  });
  return { sheets: { ...sheets, Summary: [summary[0], ...rows] }, conflicts, ownership };
}
