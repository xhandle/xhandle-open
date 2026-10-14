import {hasUnresolvedHazardText,hasLockedApplicabilityRationale} from './hazardFieldContract';
export const FAST_HAZARD_VERSION = 'compact-hazard-v7-grounded-results-first';
export const FAST_HAZARD_COLUMNS = {
  STPA: ['Function','Operational Scenario','Operational Mode','Operating Conditions','Guide Phrase','Guide Phrase Applicable','Unsafe Control Action','Loss','Hazard','Causal Scenario','Safety Constraint','Verification','Safety Classification'],
  HARA: ['Function','Operational Scenario','Operational Mode','Operating Conditions','Guide Phrase','Guide Phrase Applicable','Malfunctioning Behavior','Hazardous Event','Severity','Exposure','Controllability','ASIL','Safety Goal','Safety Classification'],
  FHA: ['Function (From)','Control Action','Function (To)','Operational Context','Guide Phrase','Guide Phrase Applicable','Mishap','Severity Category','Severity Rationale','Software Control Category','Software Control Category Rationale','Software Criticality Index','SWCI Rationale / Derivation','Safety Classification','Verification'],
};
export const fastMethod = method => /^STPA(?:[-_]TEXTBOOK(?:_APPROACH)?)?$/i.test(method || '') ? 'STPA' : /^(HARA|FHA)$/i.test(method || '') ? method.toUpperCase() : null;
export const COMMON_FIELDS = ['applicable','applicabilityRationale','classification','classificationRationale','assumptions'];
export const ASSESSMENT_FIELDS = {
  STPA: ['uca','loss','hazard','causalScenario','causalFactor','safetyConstraint','softwareRequirement','verification'],
  HARA: ['malfunction','hazardousEvent','severity','exposure','controllability','ratingRationale','safetyGoal','softwareRequirement','verification'],
  FHA: ['mishap','severity','severityRationale','scc','sccRationale','softwareRequirement','verification'],
};
const text = value => typeof value === 'string' ? value.trim() : '';
const unresolved = hasUnresolvedHazardText;
const evidenceStrings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(evidenceStrings) : [];
const normalizedQuote = value => text(value).replace(/\s+/g,' ');
export const classificationValues = ['Safety — Direct','Safety — Related','Mission/Reliability'];

// ISO 26262 risk graph: zero classes imply QM; positive S/E/C classes
// progress one ASIL per step above sum 6. Ratings are never inferred here.
export function deriveFastAsil(severity, exposure, controllability) {
  if(!/^S[0-3]$/.test(severity) || !/^E[0-4]$/.test(exposure) || !/^C[0-3]$/.test(controllability)) return null;
  const ratings=[severity,exposure,controllability].map(value=>Number(value.slice(1)));
  if(ratings.includes(0)) return 'QM';
  return ['QM','ASIL A','ASIL B','ASIL C','ASIL D'][Math.max(0,ratings.reduce((a,b)=>a+b,0)-6)];
}
// Same MIL-STD-882E software criticality matrix used by the legacy FHA.
export function deriveFastSwci(severity,scc) {
  const index=['I','II','III','IV'].indexOf(severity);
  const matrix={'1':[1,1,3,4],'2':[1,2,3,4],'3':[2,3,4,4],'4':[3,4,4,4],'5':[5,5,5,5]};
  return index<0 || !matrix[scc] ? null : `SwCI ${matrix[scc][index]}`;
}
export function validateFastAssessment(method,row,source,{structuralOnly=false}={}) {
  const errors=[];
  const unresolvedAnswer=value=>{
    let prose=value;
    if(typeof prose==='string')for(const label of [source.action,source.from,source.to,source.phrase]){
      if(typeof label==='string' && label)prose=prose.split(`“${label}”`).join('source element');
    }
    return unresolved(prose);
  };
  if(!row || row.id!==source.id)return ['Incorrect row identity'];
  if(!['Yes','No'].includes(row.applicable))errors.push('applicable must be Yes or No');
  if(source.screenedApplicability && row.applicable!==source.screenedApplicability)errors.push('Screened applicability is read-only');
  if(source.reviewedApplicability && row.applicable!==source.reviewedApplicability)errors.push('Reviewed applicability is read-only');
  for(const field of COMMON_FIELDS)if(!(field==='applicabilityRationale' && hasLockedApplicabilityRationale(row,source)) && unresolvedAnswer(row[field]))errors.push(`Missing or unresolved ${field}`);
  if(row.applicable==='No'){
    if(row.classification!=='Not applicable')errors.push('Excluded rows require Not applicable classification');
    return errors;
  }
  if(!structuralOnly){
  if(!['None','Overlap'].includes(row.executionDependency))errors.push('executionDependency must be None or Overlap');
  if(!['None','Interactive operator'].includes(row.operatorDependency))errors.push('operatorDependency must be None or Interactive operator');
  if(row.executionDependency==='Overlap'){
    const quote=normalizedQuote(row.executionEvidenceQuote);
    const concurrency=/\b(?:asynchronous|async|concurrent|parallel|background|thread|spawn|fork|popen|nonblocking|non-blocking)\b|Promise\.all\s*\(|(?:^|[^&])&\s*(?:$|\n)/i;
    if(quote.length<16 || !evidenceStrings(source.evidence).some(value=>normalizedQuote(value).includes(quote)) || !concurrency.test(quote) || /\b(?:no|not|without)\s+(?:asynchronous|async|concurrent|parallel|background)\b/i.test(quote))errors.push('Overlap requires a supplied source quote demonstrating asynchronous/concurrent execution; missing exit-status checks do not establish overlap. Reassess sequential delay or failure propagation instead.');
  }
  if(row.operatorDependency==='Interactive operator'){
    const context=evidenceStrings(source.context).join(' ');
    const excludesInteraction=/\bunattended\b|\b(?:no|without|absence of)\s+(?:(?:an?|any)\s+)?(?:engineer|human|operator|user)\s+interaction\b/i;
    const quote=normalizedQuote(row.operatorContextQuote);
    if(excludesInteraction.test(context))errors.push('Interactive operator dependency conflicts with the unattended/no-interaction operational context. Assess automated outputs or artifacts instead; do not invent an engineer awaiting a display.');
    else if(quote.length<16 || !evidenceStrings(source.context).some(value=>normalizedQuote(value).includes(quote)))errors.push('Interactive operator dependency requires operatorContextQuote copied from the operational context establishing the interaction.');
  }
  if(source.action && row.assessedAction!==source.action)errors.push('assessedAction must exactly match the source control action; assess this action, not another workflow step');
  if(!['Source-supported','Hypothesis'].includes(row.causalBasis))errors.push('Specify causalBasis as Source-supported or Hypothesis');
  if(unresolved(row.causalEvidence))errors.push('Provide causalEvidence: a specific supporting source excerpt or an explicit causal assumption and its verification');
  if(row.causalBasis==='Source-supported'){
    const quote=normalizedQuote(row.evidenceQuote);
    if(quote.length<16 || !evidenceStrings(source.evidence).some(value=>normalizedQuote(value).includes(quote)))errors.push('Source-supported causation requires evidenceQuote copied from supplied source evidence; otherwise explicitly label the cause Hypothesis');
  }
  if(row.causalBasis==='Hypothesis' && !/\b(?:assum\w*|hypothes\w*|potential|possible)\b/i.test(text(row.causalEvidence)))errors.push('Explicitly label the causal assumption in causalEvidence');
  if(method==='STPA' && row.causalBasis==='Hypothesis' && !/\b(?:assum\w*|hypothes\w*|potential|possible)\b/i.test(text(row.causalFactor)))errors.push('Describe causalFactor as an assumed or hypothetical fault, not a proven defect');
  }
  if(source.action && structuralOnly && row.assessedAction!==source.action)errors.push('assessedAction must exactly match the source control action');
  if(!classificationValues.includes(row.classification))errors.push('Invalid safety classification');
  const governedClassification=source.reviewedValues?.['Safety Classification'];
  if(classificationValues.includes(governedClassification) && governedClassification!==row.classification)errors.push('Reviewed safety classification is read-only');
  const governedSignificance=source.reviewedValues?.['Safety Significant'];
  if(['Yes','No'].includes(governedSignificance) && governedSignificance!==(row.classification==='Mission/Reliability'?'No':'Yes'))errors.push('Classification conflicts with reviewed safety significance');
  for(const field of ASSESSMENT_FIELDS[method])if(unresolvedAnswer(row[field]) || /^not applicable\b/i.test(text(row[field])))errors.push(`Missing applicable ${field}`);
  if(method==='HARA' && !deriveFastAsil(row.severity,row.exposure,row.controllability))errors.push('Invalid S/E/C rating');
  if(method==='FHA' && !deriveFastSwci(row.severity,row.scc))errors.push('Invalid severity/SCC rating');
  if(row.applicable==='Yes' && !/\bshall\b/i.test(text(row.softwareRequirement)))errors.push('Provide a software-allocated shall requirement');
  return errors;
}
