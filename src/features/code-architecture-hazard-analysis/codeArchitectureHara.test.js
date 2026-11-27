import { PROJECT_HARA_HEADERS } from '../project-hazard-analysis/projectHara';
import { CODE_HARA_COLUMNS, codeHaraColumnLabel, expandCodeHaraSheet } from './codeArchitectureHara';
import { fastHazardSheets } from './fastHazardRunner';
import { validateFastAssessment } from './fastHazardSchema';
import { answer } from './fastHazardTestFixtures';

const source = { id:'HA-1', action:'Apply torque', from:'Planner', to:'Actuator', phrase:'Not provided' };
const input = {
  sheets:{'Functional Decomposition':[['Function'],['Planner']]},
  tableRows:[{fromFunction:'Planner', controlAction:'Apply torque', toFunction:'Actuator',
    guidePhrase:'Not provided', operationalContextId:'drive', operationalScenario:'Urban driving',
    operationalMode:'Automatic', operatingConditions:'Wet road', traceability:{traceId:'function-1'}}],
};

test('Code HARA includes shared risk fields without adopting the Projects Item configuration or duplicate aliases', () => {
  for(const header of PROJECT_HARA_HEADERS.filter(header=>!['Item ID','Item'].includes(header))) expect(CODE_HARA_COLUMNS).toContain(codeHaraColumnLabel(header));
  expect(CODE_HARA_COLUMNS).not.toContain('Item');expect(CODE_HARA_COLUMNS).not.toContain('Item ID');
  expect(new Set(CODE_HARA_COLUMNS).size).toBe(CODE_HARA_COLUMNS.length);
});

test('older HARA results expose new columns without inferring ratings or timing', () => {
  const old=[['Item / Function','Malfunction','Severity','Safety Goal'],['Planner','Lost torque','S2','Prevent loss of torque.']];
  const original=JSON.stringify(old), expanded=expandCodeHaraSheet(old);
  expect(JSON.stringify(old)).toBe(original);
  for(const header of ['Safe State','Fault Tolerant Time Interval','FTTI Rationale','Safety Goal ASIL','Assessment Status']) {
    expect(expanded[1][expanded[0].indexOf(header)]).toBe('');
  }
  expect(expanded[0].filter(header=>codeHaraColumnLabel(header)==='Function')).toHaveLength(1);
  expect(expandCodeHaraSheet(expanded)).toBe(expanded);
});

test('generated HARA preserves separate rationales, timing evidence and traceable safety goals in exports', () => {
  const assessment={...answer('HARA','HA-1'), safeState:'Controlled standstill', ftti:'100 ms',
    fttiRationale:'The supplied hazard timing analysis sets 100 ms before crossing entry.',
    itemDefinition:'Automated braking item: controller and brake actuator; no driver.', gaps:''};
  const sheets=fastHazardSheets('HARA',input,[assessment]), [headers,row]=sheets.Summary;
  const cell=header=>row[headers.indexOf(header)];
  expect(cell('ASIL')).toBe('ASIL D');
  expect(cell('Safety Goal ASIL')).toBe('ASIL D');
  expect(cell('Severity Rationale')).toBe(assessment.severityRationale);
  expect(cell('Exposure Rationale')).toBe(assessment.exposureRationale);
  expect(cell('Controllability Rationale')).toBe(assessment.controllabilityRationale);
  expect(cell('Fault Tolerant Time Interval')).toBe('100 ms');
  expect(cell('FTTI Rationale')).toBe(assessment.fttiRationale);
  expect(cell('Safe State')).toBe(assessment.safeState);
  expect(cell('Assessment Status')).toBe('Complete');
  expect(cell('Hazardous Event ID')).toMatch(/^HE-/);
  expect(cell('Safety Goal ID')).toMatch(/^SG-/);
  expect(sheets['Safety Goals'][1]).toEqual(expect.arrayContaining([cell('Safety Goal ID'),cell('Hazardous Event ID'),'100 ms']));
});

test('missing FTTI and safe-state evidence remain blank and are flagged for review', () => {
  const [headers,row]=fastHazardSheets('HARA',input,[answer('HARA','HA-1')]).Summary;
  expect(row[headers.indexOf('Fault Tolerant Time Interval')]).toBe('');
  expect(row[headers.indexOf('Safe State')]).toBe('');
  expect(row[headers.indexOf('Assessment Gaps')]).toContain('FTTI');
  expect(row[headers.indexOf('Assessment Status')]).toBe('Complete');
  expect(row[headers.indexOf('Assessment Gaps')]).toMatch(/safe state|FTTI/i);
  expect(row[headers.indexOf('Safety Goal ASIL')]).toBe(row[headers.indexOf('ASIL')]);
});

test('HARA requires separate rating rationales and a basis for any provided FTTI', () => {
  const good=answer('HARA','HA-1');
  expect(validateFastAssessment('HARA',good,source,{structuralOnly:true})).toEqual([]);
  expect(validateFastAssessment('HARA',{...good,exposureRationale:''},source,{structuralOnly:true})).toContain('Missing applicable exposureRationale');
  expect(validateFastAssessment('HARA',{...good,ftti:'100 ms'},source,{structuralOnly:true})).toContain('A supplied FTTI requires its evidence-based rationale');
});
