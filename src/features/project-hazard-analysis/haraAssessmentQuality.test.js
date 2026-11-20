import { guardGeneratedHaraAssessment, generatedHaraDecisionErrors, haraRowFindings, missingEvidenceExclusion, HARA_QUALITY_GUIDANCE, haraSuppliedEvidence } from './haraAssessmentQuality';
import { PROJECT_HARA_HEADERS, refreshProjectHaraSheets, alignGeneratedHaraCell } from './projectHara';

const findings=fields=>haraRowFindings(name=>fields[name]||'').join('\n');
test('exposure excludes acknowledgment failure probability even when the rationale recites the correct rule',()=>{
  expect(findings({'Exposure Rationale':'Exposure is the operational situation, not failure probability. E3 because not all transmissions will fail.'})).toContain('EXPOSURE_FAILURE_BASIS');
  expect(findings({'Exposure Rationale':'Frequent occupied crossings; never the malfunction/failure probability.'})).not.toContain('EXPOSURE_FAILURE_BASIS');
});
test.each([
  'E4 reflects frequent urban operation, not the probability of communication failure.',
  'Exposure reflects how often urban trips occur, excluding packet loss probability.',
  'E3 reflects the operational situation frequency, independent of malfunction probability.',
])('explicitly excluding failure probability is not an exposure failure basis: %s', rationale => {
  expect(findings({ 'Exposure Rationale': rationale })).not.toContain('EXPOSURE_FAILURE_BASIS');
});
test('an explicit exclusion cannot hide a separate affirmative failure-frequency argument', () => {
  expect(findings({ 'Exposure Rationale': 'Exposure excludes the probability of communication failure. E3 because network failure rates are moderate.' })).toContain('EXPOSURE_FAILURE_BASIS');
  expect(findings({ 'Exposure Rationale': 'Exposure is not malfunction probability, but E3 because network failure rates are moderate.' })).toContain('EXPOSURE_FAILURE_BASIS');
});
test('severity cannot be downgraded because fatal harm is uncertain or fallback might work',()=>{
  expect(findings({Severity:'S2','Severity Rationale':'Severe injury or death is possible but death is not certain if fallback mechanisms activate.'})).toContain('SEVERITY_MITIGATION_CREDIT');
  expect(findings({Severity:'S3','Severity Rationale':'Life-threatening injuries with uncertain survival.'})).not.toContain('SEVERITY_MITIGATION_CREDIT');
});
test('internal fault detection alone does not establish C3',()=>{
  expect(findings({Controllability:'C3','Controllability Rationale':'Passengers cannot detect or repair the internal audio processing failure.'})).toContain('CONTROLLABILITY_HARM_AVOIDANCE');
  expect(findings({Controllability:'C3','Controllability Rationale':'Pedestrians cannot avoid the collision in the supplied stopping distance.'})).not.toContain('CONTROLLABILITY_HARM_AVOIDANCE');
});
test('missing interface evidence is uncertainty, while an established pulse semantics exclusion remains valid',()=>{
  expect(missingEvidenceExclusion('No interface evidence is provided to establish a continuous update.')).toBe(true);
  expect(missingEvidenceExclusion('The documented pulse has no duration; stopped too soon is inapplicable.')).toBe(false);
  expect(findings({'Guide Phrase Applicable':'No','Guide Phrase Applicability Rationale':'No interface evidence is provided.','Verification Method':'Inject a dropped emergency report.'})).toMatch(/APPLICABILITY_EVIDENCE[\s\S]*EXCLUDED_VERIFICATION/);
});
test('missed emergencies and false alerts require separate assessments; suppressing alerts is not automatically safe',()=>{
  const issues=findings({'Hazardous Event':'A missed emergency or false emergency alert delays assistance.','Safe State':'Suppress all alerts.'});
  expect(issues).toContain('OUTCOME_SPLIT');expect(issues).toContain('SAFE_RESPONSE_CONFLICT');
});
test('unsound risk arguments require a repaired decision rather than an empty result',()=>{
  const errors=generatedHaraDecisionErrors({exposure:'E3',exposureRationale:'E3 because network failure rates are high.',severity:'S2',severityRationale:'Death is not certain if fallback mechanisms activate.',ftti:'200 ms',fttiRationale:'Covers 2 consecutive frames.'});
  expect(errors.join('\n')).toMatch(/EXPOSURE_FAILURE_BASIS/);expect(errors.join('\n')).toMatch(/SEVERITY_MITIGATION_CREDIT/);expect(errors.join('\n')).toMatch(/fault-to-hazard/);
  const result=guardGeneratedHaraAssessment({exposure:'E2',severity:'S3',controllability:'C3',safeState:'Required emergency operation.',ftti:'2 s'},'Emergency mode is active.');
  expect(result.exposure).toBe('E2');expect(result.severity).toBe('S3');expect(result.ftti).toBe('2 s');expect(result.safeState).toBe('Required emergency operation.');
  expect(result.decisionBasis).toBe('Engineering judgment');expect(result.assumptions).toContain('engineering estimate');
});
test('supported qualitative exposure and hazard timing are retained without inventing ASIL',()=>{
  const evidence='Occupied crossings are encountered frequently. Recorded hazard timing analysis establishes 100 ms from fault occurrence to crossing entry. The vehicle has independent braking to a standstill.';
  const result=guardGeneratedHaraAssessment({severity:'S3',severityRationale:'A collision may be fatal.',exposure:'E4',exposureEvidence:'Occupied crossings are encountered frequently.',exposureRationale:'Crossings are frequent in this operating domain.',safeState:'Standstill',safeStateJustification:'Independent braking prevents crossing entry.',safeStateEvidence:'The vehicle has independent braking to a standstill.',ftti:'100 ms',fttiEvidence:'Recorded hazard timing analysis establishes 100 ms from fault occurrence to crossing entry.',fttiRationale:'The recorded fault-to-hazard interval bounds detection and independent braking.',assumptions:'No additional assumptions.'},evidence);
  expect(result.exposure).toBe('E4');expect(result.ftti).toBe('100 ms');expect(result.safeState).toBe('Standstill');expect(result.asil).toBeUndefined();
  expect(result.decisionBasis).toBe('Source-supported');expect(result.assumptions).toBe('');
});
const headers=[...new Set([...PROJECT_HARA_HEADERS,'Operational Scenario','Operational Mode','Operating Conditions','Raw Analysis Row ID'])];
const row=fields=>headers.map(header=>fields[header]||'');
const read=(s,i,h)=>s.Summary[i][headers.indexOf(h)];
test('global exposure conflicts are visible without selecting an arbitrary class or losing original IDs',()=>{
  const common={'Operational Scenario':'Active emergency call in noise','Operational Mode':'Emergency','Operating Conditions':'Siren','Guide Phrase Applicable':'Yes',Severity:'S3',Controllability:'C3','Safety Goal':'The item shall prevent missed emergency reports.'};
  const result=refreshProjectHaraSheets({Summary:[headers,row({...common,Exposure:'E2','Raw Analysis Row ID':'raw-a'}),row({...common,Exposure:'E3','Raw Analysis Row ID':'raw-b'})]});
  expect(read(result,1,'Exposure')).toBe('E2');expect(read(result,2,'Exposure')).toBe('E3');
  expect(read(result,1,'HARA Review Findings')).toContain('EXPOSURE_CONFLICT');expect(read(result,2,'Assessment Status')).toBe('Inconsistent exposure');
  expect(read(result,1,'Raw Analysis Row ID')).toBe('raw-a');expect(result['Safety Goals'][1][2]).toBe('ASIL C');
  expect(result['HARA Coverage']).toContainEqual(['Operational scenarios','1']);expect(result['HARA Coverage'][3][1]).toContain('Scenario-specific');
});
test('pure nominal performance concerns are retained for SOTIF and do not receive a HARA ASIL',()=>{
  const result=refreshProjectHaraSheets({Summary:[headers,row({'Guide Phrase Applicable':'Yes','Evidence Basis':'SOTIF concern',Severity:'S3',Exposure:'E3',Controllability:'C3'})]});
  expect(read(result,1,'ASIL')).toBe('Not assigned');expect(read(result,1,'HARA Review Findings')).toContain('SCOPE_SOTIF');
});
test('guidance distinguishes timing and outcome scope rather than prescribing default ratings',()=>{
  for(const term of ['uncertain survival','operational situation','people at risk','candidateRequirements','candidateTiming','SOTIF','Mismatch:'])expect(HARA_QUALITY_GUIDANCE).toContain(term);
});
test('App alignment retains deliberate HARA blanks instead of resurrecting unsupported previous values',()=>{
  for(const name of ['Exposure','Severity','Safe State','Fault Tolerant Time Interval','Safety Goal'])expect(alignGeneratedHaraCell(name,'','previous unsupported value',{hara:true,sourceExists:true})).toBe('');
  expect(alignGeneratedHaraCell('Operating Conditions','','Wet pavement',{hara:true,sourceExists:false})).toBe('Wet pavement');
  expect(alignGeneratedHaraCell('Hazard','','Existing STPA hazard',{hara:false,sourceExists:true})).toBe('Existing STPA hazard');
});
test('architecture assumptions cannot corroborate a fallback or hazard timing claim',()=>{
  const evidence=JSON.stringify(haraSuppliedEvidence({functionalRow:{fromDetails:'Audio capture sends PCM frames.',contextAssumptions:'Cellular fallback is operational.'},context:'Operating conditions: High noise.\nAssumptions: FTTI is 200 ms.'}));
  expect(evidence).not.toContain('200 ms');expect(evidence).not.toContain('Cellular fallback');expect(evidence).toContain('PCM frames');
  const result=guardGeneratedHaraAssessment({safeState:'Cellular fallback',safeStateEvidence:'Cellular fallback is operational.',safeStateJustification:'Calls emergency services.',ftti:'200 ms',fttiEvidence:'FTTI is 200 ms.'},evidence);
  expect(result.ftti).toBe('200 ms');expect(result.safeState).toBe('Cellular fallback');
  expect(result.decisionBasis).toBe('Engineering judgment');expect(result.assumptions).toContain('not a measured or validated timing bound');
});
test('canonical mismatch corrections preserve the original mapping and raw identity',()=>{
  const result=refreshProjectHaraSheets({Summary:[headers,row({
    'Guide Phrase Applicable':'Yes','Raw Analysis Row ID':'audio-capture-row',
    'Hazard':'Dispatch receipt acknowledgement missing','Mapped Canonical Hazard':'Dispatch receipt acknowledgement missing','Canonical Hazard ID':'H-dispatch',
    'Vehicle-Level Hazard':'An occupant emergency is not communicated because audio capture is lost.',
    'Canonical Mapping Review':'Mismatch: this event concerns audio capture loss before dispatch transmission.',
    Severity:'S3',Exposure:'E2',Controllability:'C3',
  })]});
  expect(read(result,1,'Source Canonical Hazard ID')).toBe('H-dispatch');
  expect(read(result,1,'Source Canonical Hazard')).toBe('Dispatch receipt acknowledgement missing');
  expect(read(result,1,'Raw Analysis Row ID')).toBe('audio-capture-row');
  expect(read(result,1,'Hazard')).toContain('audio capture');
  expect(read(result,1,'Canonical Hazard ID')).not.toBe('H-dispatch');
});
test('an applicable result needs people at risk and an actual safety goal',()=>{
  const errors=generatedHaraDecisionErrors({safetyGoal:'Prevent unsafe behavior'});
  expect(errors).toContain('Write the safety goal as a complete item-level shall statement.');
  expect(errors.some(error=>error.includes('personsAtRisk'))).toBe(true);
});
