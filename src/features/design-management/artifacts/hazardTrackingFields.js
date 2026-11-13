export const HAZARD_TRACKING_COLUMNS = ['Hazard', 'Function', 'Operational Scenario', 'Operational Mode', 'Operating Conditions', 'Guide Phrase', 'Guide Phrase Applicable', 'Unsafe Control Action', 'Loss', 'Causal Scenario', 'Safety Constraint', 'Verification', 'Safety Classification'];
// HTR identifies a consolidated record; it is derived from saved row identity,
// rather than imported as an extra hazard-analysis field or edited as a cell.
export const HAZARD_TRACKING_DERIVED_COLUMNS = ['HTR', 'Actionable Safety Issue Title', 'Actionable Safety Issue Description'];
export const HAZARD_TRACKING_TABLE_COLUMNS = [...HAZARD_TRACKING_DERIVED_COLUMNS, ...HAZARD_TRACKING_COLUMNS];
const key = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const text = value => typeof value === 'string' ? value.trim() : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const aliases = {
  'Operational Scenario': ['Operational Scenario', 'Scenario'], 'Operational Mode': ['Operational Mode', 'Mode'],
  'Operating Conditions': ['Operating Conditions', 'Operational Conditions', 'Conditions'],
  'Guide Phrase': ['Guide Phrase', 'Guide Word', 'Guideword'], 'Guide Phrase Applicable': ['Guide Phrase Applicable', 'Guide Word Applicable'],
  'Unsafe Control Action': ['Unsafe Control Action', 'Unsafe Control Actions', 'UCA'], Loss: ['Loss', 'Losses'], Hazard: ['Hazard', 'Hazards'],
  'Causal Scenario': ['Causal Scenario', 'Causal Scenarios'], 'Safety Constraint': ['Safety Constraint', 'Safety Constraints', 'Safety Requirements/Constraints'],
  Verification: ['Verification', 'Verification Method', 'Verification Methods', 'Verification Approach'], 'Safety Classification': ['Safety Classification'],
};

// Resolve header aliases once per table, then read only the selected cells.
// Stable source IDs remain metadata, never extra document columns.
export function hazardTrackingProjection(headers) {
  const positions = new Map(headers.map((header, index) => [key(header), index]));
  const indices = labels => labels.map(label => positions.get(key(label))).filter(index => index !== undefined);
  const columns = HAZARD_TRACKING_COLUMNS.map(column => [column, indices(aliases[column] || [column])]);
  const from = indices(['Function (From)', 'From Function', 'Controller', 'From']);
  const action = indices(['Control Action', 'Action']);
  const to = indices(['Function (To)', 'To Function', 'Controlled Process', 'To']);
  const identity = indices(['Raw Analysis Row ID', 'Raw Row ID', 'Analysis Row ID', 'Row ID', 'ID']);
  const first = (row, candidates) => { for (const index of candidates) { const value = text(row[index]); if (value) return value; } return ''; };
  return row => {
    const attributes = {};
    for (const [column, candidates] of columns) {
      const value = first(row, candidates) || (column === 'Function' ? [first(row, from), first(row, action), first(row, to)].filter(Boolean).join(' → ') : '');
      if (value) attributes[column] = value;
    }
    return { attributes, sourceRowId: first(row, identity) };
  };
}
export function projectHazardTrackingFields(attributes = {}) {
  return hazardTrackingProjection(Object.keys(attributes))(Object.values(attributes)).attributes;
}
export function hazardTrackingText(attributes = {}) {
  return HAZARD_TRACKING_COLUMNS.filter(column => attributes[column] !== undefined && attributes[column] !== '').map(column => `${column}: ${attributes[column]}`).join('\n');
}
// A manual change to the event or reviewed context invalidates only that
// assessment's semantic grouping. Original source values are never rewritten.
export const hazardEquivalenceSignature = attributes => JSON.stringify(['Hazard', 'Function', 'Loss', 'Operational Scenario', 'Operational Mode', 'Operating Conditions'].map(column => text(attributes?.[column]).replace(/\s+/g, ' ').toLowerCase()));
