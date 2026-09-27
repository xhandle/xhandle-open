import { inspectClassificationResolution } from './classificationResolutionStatus';
import { reconcileRegeneratedGuidePhraseReview } from './hazardRegenerationReview';

const text = value => String(value ?? '').trim();
const basisFields = ['Function (From)', 'Control Action', 'Function (To)', 'Guide Phrase',
  'Operational Context ID', 'Operational Scenario', 'Operational Mode', 'Operating Conditions'];
const contextProperties = { 'Operational Context ID': 'operationalContextId', 'Operational Scenario': 'operationalScenario', 'Operational Mode': 'operationalMode', 'Operating Conditions': 'operatingConditions' };
const excluded = new Set([...basisFields, 'Raw Analysis Row ID', 'Classification Resolution Status',
  'Trace ID', 'From Node ID', 'Control Edge ID', 'To Node ID', 'Architecture Row Ref',
  'Architecture Element ID', 'Related Source File(s)', 'Source Symbols', 'Source Line Ranges',
  'Subsystem', 'Subsystem Allocation', 'CSCI', 'CSC', 'CSU', 'Lifecycle Phase', 'Interface Type',
  'Hazard Analysis Eligibility', 'Eligibility Rationale', 'Eligibility Source']);
const substantive = value => Boolean(text(value)) && !/^(needs review|unknown|undetermined|uncertain|tbd|pending|not evaluated)$/i.test(text(value));
const record = (headers, row) => Object.fromEntries(headers.map((header, index) => [header, text(row?.[index])]));

export function recordUserPreprocessing(previous, headers, row, changedHeaders, basisRow = row) {
  const values = { ...previous?.values };
  const context = { ...previous?.context };
  const cells = record(headers, row);
  changedHeaders.forEach(header => {
    if (contextProperties[header]) context[header] = cells[header];
    if (excluded.has(header)) return;
    if (substantive(cells[header])) values[header] = cells[header];
    else delete values[header];
  });
  if (!Object.keys(values).length) return undefined;
  const basis = record(headers, basisRow);
  return { values, context, updatedAt: new Date().toISOString(), basis: previous?.basis || Object.fromEntries(basisFields.map(header => [header, basis[header] || ''])), pending: true };
}

export function preprocessingBasisChanged(preprocessing, headers, basisRow) {
  if (!preprocessing) return false;
  const current = record(headers, basisRow);
  return basisFields.some(header => text(preprocessing.basis?.[header]) !== text(current[header]));
}

export function constrainPreprocessedInput(functionalRow, preprocessing, headers, basisRow) {
  if (!preprocessing || !Object.keys(preprocessing.values || {}).length) return functionalRow;
  const changed = preprocessingBasisChanged(preprocessing, headers, basisRow);
  const instructions = changed
    ? 'Prior user assessments require review because their architecture/context basis changed. Do not silently treat them as validated.'
    : 'Preserve these user-provided assessments. Complete the remaining analysis consistently with them. If evidence conflicts, explain the conflict rather than silently overriding the decision.';
  const next = { ...functionalRow, controlDetails: [functionalRow.controlDetails || '', instructions,
    JSON.stringify(preprocessing.values)].filter(Boolean).join('\n') };
  if (!changed) {
    Object.entries(preprocessing.context || {}).forEach(([header, value]) => {
      if (contextProperties[header]) next[contextProperties[header]] = value;
      if (header === 'Operational Context ID') next.hazardContextId = value;
    });
  }
  if (!changed && /^(yes|no)$/i.test(preprocessing.values['Guide Phrase Applicable'] || '')) {
    next.guidePhraseApplicable = preprocessing.values['Guide Phrase Applicable'];
    next.guidePhraseApplicabilityRationale = preprocessing.values['Guide Phrase Applicability Rationale'] || '';
    next.guidePhraseApplicabilityReviewStatus = 'Reviewed';
  }
  return next;
}

export function reconcileUserPreprocessing(headers, generatedRow, preprocessing, basisRow) {
  if (!preprocessing || !Object.keys(preprocessing.values || {}).length) return { row: generatedRow, conflicts: [] };
  const row = [...generatedRow];
  const changed = preprocessingBasisChanged(preprocessing, headers, basisRow);
  const conflicts = changed ? ['User preprocessing requires review: architecture or operational context changed.'] : [];
  for (const [header, value] of Object.entries(preprocessing.values)) {
    const index = headers.indexOf(header);
    if (index < 0) continue;
    const generated = text(row[index]);
    if (!changed && substantive(generated) && generated.toLowerCase() !== value.toLowerCase()
      && ['Guide Phrase Applicable', 'Safety Significant', 'Safety Classification'].includes(header)) {
      conflicts.push(`${header}: user assessment "${value}" conflicts with generated assessment "${generated}".`);
    }
    row[index] = value;
  }
  const write = (header, value) => { const index = headers.indexOf(header); if (index >= 0) row[index] = value; };
  if (changed) {
    write('Guide Phrase Applicable', 'Needs Review');
  } else if (/^no$/i.test(preprocessing.values['Guide Phrase Applicable'] || '')) {
    const result = reconcileRegeneratedGuidePhraseReview({ headers, previousRow: row, currentBasisRow: row, regeneratedRow: row,
      reviewItem: { currentContent: { columns: headers, row } } });
    result.row.forEach((value, index) => { row[index] = value; });
  }
  if (!changed) {
    for (const [header, value] of Object.entries(preprocessing.values)) {
      const index = headers.indexOf(header);
      if (index >= 0 && text(row[index]) !== value) {
        conflicts.push(`${header}: user assessment conflicts with the applicability policy; retained for review.`);
        row[index] = value;
      }
    }
  }
  if (headers.includes('Safety Classification')) {
    const resolution = inspectClassificationResolution(headers, row);
    write('Classification Resolution Status', resolution.status);
  }
  if (conflicts.length) write('Classification Resolution Status', 'Needs Review');
  return { row, conflicts };
}

/** Match preprocessed results independently of AI output order. */
export function matchPreprocessedGeneratedRow(headers, rows, basisHeaders, basisRow) {
  const source = record(basisHeaders, basisRow);
  const idIndex = headers.indexOf('Raw Analysis Row ID');
  const byId = idIndex < 0 ? [] : rows.filter(row => text(row[idIndex]) && text(row[idIndex]) === source['Raw Analysis Row ID']);
  if (byId.length === 1) return byId[0];
  const identity = basisFields.filter(header => headers.includes(header) && basisHeaders.includes(header));
  if (!['Function (From)', 'Control Action', 'Function (To)'].every(header => identity.includes(header))) return null;
  const matches = rows.filter(row => identity.every(header => text(row[headers.indexOf(header)]) === source[header]));
  return matches.length === 1 ? matches[0] : null;
}

/** A later governed review supersedes earlier preprocessing of that decision. */
export function respectNewerHazardReviews(preprocessing, reviews = []) {
  if (!preprocessing) return preprocessing;
  const values = { ...preprocessing.values };
  const groups = {
    guidePhraseApplicable: ['Guide Phrase Applicable', 'Guide Phrase Applicability Rationale'],
    safetySignificant: ['Safety Significant', 'Safety Significance Rationale'],
    safetyClassification: ['Safety Classification', 'Safety Classification Rule', 'Classification Evidence', 'Classification Confidence'],
  };
  reviews.filter(Boolean).forEach(review => {
    const reviewedAt = Date.parse(review.reviewedAt || review.updatedAt || 0) || 0;
    if (reviewedAt <= (Date.parse(preprocessing.updatedAt || 0) || 0)) return;
    (groups[review.vibeReview?.reviewTarget] || []).forEach(header => { delete values[header]; });
  });
  return Object.keys(values).length ? { ...preprocessing, values } : undefined;
}

export function preprocessingGenerationBasis(headers, basisRow, preprocessing) {
  if (!preprocessing || preprocessingBasisChanged(preprocessing, headers, basisRow)) return basisRow;
  return headers.map((header, index) => preprocessing.context?.[header] ?? basisRow[index]);
}
