// ISO 26262-3 concept-phase assessment. The lookup is deterministic; an AI
// response may propose S/E/C with rationale, but never supplies the ASIL.
// Public cross-check: NHTSA DOT HS 812 574, section 5.1.2, Table 21.
import { HARA_QUALITY_FIELDS, haraKey, haraRowFindings, outcomeKinds } from './haraAssessmentQuality';
export const PROJECT_HARA_HEADERS = [
  'Hazardous Event ID', 'Item / Function', 'Unsafe Control Action', 'Malfunction',
  'Loss', 'Hazard', 'Hazardous Event', 'Potential Harm', 'Persons at Risk',
  'Raw Loss Candidate', 'Raw Hazard Candidate', 'Canonical Loss ID', 'Canonical Hazard ID',
  'Severity', 'Severity Rationale', 'Exposure', 'Exposure Rationale',
  'Controllability', 'Controllability Rationale', 'ASIL', 'ASIL Rationale',
  'Safety Goal ID', 'Safety Goal', 'Safety Goal ASIL', 'Safe State',
  'Fault Tolerant Time Interval', 'FTTI Rationale', 'Safety Constraint',
  'Causal Scenario', 'Verification Method', 'Item Definition',
  'Assessment Assumptions', 'Assessment Gaps', 'Assessment Status',
  'Guide Phrase Applicable', 'Guide Phrase Applicability Rationale',
  'Safety Significant', 'Safety Significance Rationale',
  ...Object.values(HARA_QUALITY_FIELDS), 'Mapped Canonical Hazard', 'Excluded Candidate Verification', 'HARA Review Findings',
  'Source Canonical Hazard ID','Source Canonical Hazard',
];

const ASILS = [
  [['QM','QM','QM'], ['QM','QM','QM'], ['QM','QM','A'], ['QM','A','B']],
  [['QM','QM','QM'], ['QM','QM','A'], ['QM','A','B'], ['A','B','C']],
  [['QM','QM','A'], ['QM','A','B'], ['A','B','C'], ['B','C','D']],
];
export const haraText = value => String(value && typeof value === 'object' && 'value' in value ? value.value ?? '' : value ?? '').trim();
const HARA_GENERATED_COLUMNS=new Set(PROJECT_HARA_HEADERS);
// An intentionally empty generated cell must not be restored from a previous
// analysis during the App's column alignment. Ownership reconciliation
// still protects explicit user edits after generated values are aligned.
export function alignGeneratedHaraCell(header,value,fallback,{hara=false,sourceExists=false}={}) {
  return hara && sourceExists && HARA_GENERATED_COLUMNS.has(header) ? value ?? '' : value || fallback || '';
}
export const PROJECT_HARA_DERIVED_HEADERS = new Set(['Hazardous Event ID','ASIL','ASIL Rationale','Safety Goal ID','Safety Goal ASIL','Assessment Status','HARA Review Findings']);
export function normalizeHaraRating(value, prefix, maximum) {
  const match = haraText(value).toUpperCase().match(new RegExp(`^${prefix}([0-${maximum}])(?:\\s*[-–—:()]\\s*.*)?$`));
  return match ? `${prefix}${match[1]}` : '';
}
export function calculateProjectHaraAsil(severity, exposure, controllability) {
  const s = normalizeHaraRating(severity, 'S', 3);
  const e = normalizeHaraRating(exposure, 'E', 4);
  const c = normalizeHaraRating(controllability, 'C', 3);
  if (s === 'S0' || e === 'E0' || c === 'C0') return 'Not assigned';
  if (!s || !e || !c) return 'Not assessed';
  const value = ASILS[Number(s[1])-1][Number(e[1])-1][Number(c[1])-1];
  return value === 'QM' ? 'QM' : `ASIL ${value}`;
}
function stableId(prefix, text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}-${(hash >>> 0).toString(36).toUpperCase()}`;
}
function haraColumnIndex(headers) {
  const columns = new Map();
  headers.forEach((name, index) => { if (!columns.has(name)) columns.set(name, index); });
  return columns;
}
export function recalculateProjectHaraRow(headers, input, columns = haraColumnIndex(headers)) {
  const row = headers.map((_,index)=>input[index]??'');
  const get = name => haraText(row[columns.get(name)]);
  const put = (name, value) => { const i = columns.get(name); if (i !== undefined) row[i] = value; };
  const applicable = get('Guide Phrase Applicable');
  if (/^no$/i.test(applicable)) {
    for (const name of ['Severity','Exposure','Controllability','ASIL','ASIL Rationale','Safety Goal ID','Safety Goal','Safety Goal ASIL','Safe State','Fault Tolerant Time Interval']) put(name, 'Not applicable');
    const findings=haraRowFindings(get);
    put('HARA Review Findings',findings.join('\n'));
    put('Assessment Status','Not applicable');
    return row;
  }
  const asil = calculateProjectHaraAsil(get('Severity'), get('Exposure'), get('Controllability'));
  put('ASIL', asil);
  put('ASIL Rationale', asil === 'Not assessed' ? 'Analysis is incomplete: an S/E/C decision has not been generated.'
    : asil === 'Not assigned' ? 'S0, E0 or C0 applies: no ASIL assignment is required.'
      : `${get('Severity')} / ${get('Exposure')} / ${get('Controllability')}: ISO 26262-3 assessment lookup.`);
  if(/^SOTIF concern$/i.test(get('Evidence Basis'))){
    put('ASIL','Not assigned');put('ASIL Rationale','Nominal functional insufficiency is a SOTIF concern outside the E/E malfunction scope of this HARA.');
  }
  if(/^Mismatch:/i.test(get('Canonical Mapping Review')) && get('Vehicle-Level Hazard')){
    put('Source Canonical Hazard ID',get('Source Canonical Hazard ID')||get('Canonical Hazard ID'));
    put('Source Canonical Hazard',get('Source Canonical Hazard')||get('Mapped Canonical Hazard')||get('Hazard'));
    put('Hazard',get('Vehicle-Level Hazard'));put('Mapped Canonical Hazard',get('Vehicle-Level Hazard'));
    put('Canonical Hazard ID',stableId('H',haraKey(get('Vehicle-Level Hazard'))));
    put('Canonical Mapping Review',`Supported: mapped to the assessed vehicle-level hazardous state. Original mapping retained in source columns. ${get('Canonical Mapping Review')}`);
  }
  put('Hazardous Event ID', get('Hazardous Event ID') || stableId('HE', [get('Raw Analysis Row ID') || [get('Function (From)'), get('Control Action'), get('Function (To)')].join('|'), get('Guide Phrase'), get('Operational Context ID')].join('|')));
  const goal = get('Safety Goal');
  // Equivalent event descriptions share the consolidated objective. Retain the
  // materially different emergency outcome families without keying on prose.
  const outcomes=outcomeKinds(get('Hazard Outcome')+' '+get('Hazardous Event')).sort();
  const goalKey=outcomes.length?JSON.stringify([haraKey(goal),outcomes]):haraKey(goal);
  put('Safety Goal ID', goal && !/^(not applicable|not provided|unknown|needs review)/i.test(goal) ? stableId('SG',goalKey) : '');
  const gaps = [];
  if (asil === 'Not assessed') gaps.push('Provide valid S0–S3, E0–E4 and C0–C3 classifications.');
  for (const name of ['Severity Rationale','Exposure Rationale','Controllability Rationale','Item Definition','Hazardous Event','Potential Harm','Safety Goal']) {
    if (!get(name) || /^(unknown|not provided|needs review)/i.test(get(name))) gaps.push(`Provide ${name.toLowerCase()}.`);
  }
  if (!get('Operational Scenario') || /^unspecified|^generic/i.test(get('Operational Scenario'))) gaps.push('Define the operational situation before confirming ratings.');
  if (!get('Safe State') || /^(unknown|not provided|needs review)/i.test(get('Safe State'))) gaps.push('Define and validate a safe state or emergency operation.');
  if (!get('Fault Tolerant Time Interval') || !get('FTTI Rationale')) gaps.push('Define whether an FTTI is applicable and justify any timing bound.');
  const prior = get('Assessment Gaps').split('\n').filter(Boolean).filter(line => !/^Provide |^Define |^(none|no gaps|no known gaps|not applicable)\.?$/i.test(line));
  const findings=haraRowFindings(get);
  put('HARA Review Findings',findings.join('\n'));
  put('Assessment Gaps', [...new Set([...prior, ...gaps])].join('\n'));
  put('Assessment Status',asil==='Not assessed'?'In progress':'Complete');
  return row;
}
const ASIL_ORDER = ['Not assigned', 'QM', 'ASIL A', 'ASIL B', 'ASIL C', 'ASIL D'];
export function refreshProjectHaraSheets(sheets) {
  const summary = sheets?.Summary;
  if (!summary?.[0]?.includes('Hazardous Event ID')) return sheets;
  const headers = [...summary[0], ...PROJECT_HARA_HEADERS.filter(name=>!summary[0].includes(name))];
  const columns = haraColumnIndex(headers);
  const rows = summary.slice(1).map(row => recalculateProjectHaraRow(headers, row, columns));
  const goals = new Map();
  const get = (row, name) => haraText(row[columns.get(name)]);
  const exposures=new Map();
  for(const row of rows){
    if(/^no$/i.test(get(row,'Guide Phrase Applicable')))continue;
    const situation=get(row,'Operational Situation')||get(row,'Operational Scenario');
    if(!situation)continue;
    const key=JSON.stringify([haraKey(situation),haraKey(get(row,'Operational Mode')),haraKey(get(row,'Operating Conditions'))]);
    if(!exposures.has(key))exposures.set(key,{rows:[],ratings:new Set()});
    const group=exposures.get(key);group.rows.push(row);
    if(normalizeHaraRating(get(row,'Exposure'),'E',4))group.ratings.add(normalizeHaraRating(get(row,'Exposure'),'E',4));
  }
  for(const group of exposures.values())if(group.ratings.size>1){
    for(const row of group.rows){
      if(columns.has('HARA Review Findings'))row[columns.get('HARA Review Findings')]=[get(row,'HARA Review Findings'),`EXPOSURE_CONFLICT: Equivalent operational situations have ${[...group.ratings].sort().join('/')} proposals; reconcile using one supported frequency basis, or document the distinct sub-situation.`].filter(Boolean).join('\n');
      row[columns.get('Assessment Status')]='Inconsistent exposure';
    }
  }
  for (const row of rows) {
    const id = get(row, 'Safety Goal ID');
    if (!id || /^not applicable/i.test(id)) continue;
    if (!goals.has(id)) goals.set(id, { id, text: get(row, 'Safety Goal'), asil: 'Not assigned', incomplete: false, events: [], safeStates: new Set(), fttis: new Set() });
    const goal = goals.get(id), asil = get(row, 'ASIL');
    if (ASIL_ORDER.indexOf(asil) > ASIL_ORDER.indexOf(goal.asil)) goal.asil = asil;
    if (asil === 'Not assessed') goal.incomplete = true;
    goal.events.push(get(row, 'Hazardous Event ID'));
    if (get(row, 'Safe State')) goal.safeStates.add(get(row, 'Safe State'));
    if (get(row, 'Fault Tolerant Time Interval')) goal.fttis.add(get(row, 'Fault Tolerant Time Interval'));
  }
  for (const row of rows) {
    const goal = goals.get(get(row, 'Safety Goal ID'));
    if (goal) row[columns.get('Safety Goal ASIL')] = goal.incomplete ? 'Not assessed' : goal.asil;
  }
  const scenarios=[...new Set(rows.map(row=>get(row,'Operational Scenario')||get(row,'Operational Situation')).filter(Boolean))];
  const coverage=[['Coverage','Value'],['Assessment rows',String(rows.length)],['Operational scenarios',String(scenarios.length)],['Scope',scenarios.length===1?'Scenario-specific HARA for the selected operational scenario.':'HARA for the selected operational scenarios.'],...scenarios.map((scenario,index)=>[`Scenario ${index+1}`,scenario])];
  const review=[['Hazardous Event ID','Raw Analysis Row ID','Findings','Status'],...rows.filter(row=>get(row,'HARA Review Findings')).map(row=>[get(row,'Hazardous Event ID'),get(row,'Raw Analysis Row ID'),get(row,'HARA Review Findings'),get(row,'Assessment Status')])];
  const candidates=[['Hazardous Event ID','Raw Analysis Row ID','Safety Goal ID','Candidate Requirements','Candidate Timing','Proposed Mitigations','Excluded Candidate Verification'],...rows.filter(row=>['Candidate Safety Requirements','Candidate Timing Requirements','Proposed Mitigations','Excluded Candidate Verification'].some(name=>get(row,name))).map(row=>[get(row,'Hazardous Event ID'),get(row,'Raw Analysis Row ID'),get(row,'Safety Goal ID'),get(row,'Candidate Safety Requirements'),get(row,'Candidate Timing Requirements'),get(row,'Proposed Mitigations'),get(row,'Excluded Candidate Verification')])];
  const assessed = [headers, ...rows];
  return { ...sheets, Summary: assessed, HARA: assessed, 'HARA Coverage':coverage, 'HARA Quality Review':review, 'Candidate Safety Requirements':candidates,
    'Safety Goals': [['Safety Goal ID','Safety Goal','ASIL','Hazardous Event IDs','Safe State','Fault Tolerant Time Interval','Status'],
      ...[...goals.values()].map(goal => [goal.id, goal.text, goal.incomplete ? 'Not assessed' : goal.asil, goal.events.join('; '), [...goal.safeStates].join('\n'), [...goal.fttis].join('\n'), goal.incomplete?'In progress':'Complete'])],
  };
}
