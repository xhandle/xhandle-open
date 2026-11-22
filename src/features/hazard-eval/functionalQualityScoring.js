// Fixed, versioned benchmark rubric. Judge confidence is not a score input.
export const QUALITY_RUBRIC_VERSION='functional-stpa-quality-v1';
export const QUALITY_WEIGHTS=Object.freeze({grounding:0.20,applicability:0.15,causality:0.20,requirements:0.20,verification:0.20,coverage:0.05});

export function gradeFunctionalQuality({sources,assessments,verdicts,coverageChecks,expectedCoverage,localErrors=[]}) {
  const failures=[...localErrors], ids=new Set(sources.map(source=>source.id));
  if(new Set(assessments.map(row=>row.id)).size!==assessments.length || assessments.length!==sources.length) failures.push('Missing or duplicate generated assessments.');
  if(new Set(verdicts.map(row=>row.id)).size!==verdicts.length || verdicts.length!==sources.length || verdicts.some(row=>!ids.has(row.id))) failures.push('Judge omitted, duplicated or invented assessment IDs.');
  const byId=new Map(assessments.map(row=>[row.id,row])), dimensions={}, findings=[];
  for(const key of Object.keys(QUALITY_WEIGHTS).filter(key=>key!=='coverage')) {
    const values=[];
    for(const verdict of verdicts) {
      const row=byId.get(verdict.id);
      if(!row)continue;
      if(row.applicable==='No' && key!=='applicability')continue;
      const score=verdict.scores?.[key];
      if(!Number.isFinite(score) || score<0 || score>10) {failures.push(`Invalid ${key} score for ${verdict.id}.`);continue;}
      values.push(score);
    }
    dimensions[key]=values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  }
  for(const verdict of verdicts) {
    if(!Array.isArray(verdict.findings)) {failures.push(`Missing findings for ${verdict.id}.`);continue;}
    for(const issue of verdict.findings) {
      if(!['critical','major','minor'].includes(issue.severity) || !issue.field || !issue.claim || !issue.evidence || !issue.reason || !issue.fix) {
        failures.push(`Unsubstantiated judge finding for ${verdict.id}.`);continue;
      }
      findings.push({id:verdict.id,...issue});
    }
  }
  const expected=new Set(expectedCoverage.map(check=>check.id)), seen=new Set();let covered=0;
  for(const check of coverageChecks) {
    if(!expected.has(check.id) || seen.has(check.id)) {failures.push('Invalid or duplicate coverage check.');continue;}
    seen.add(check.id);
    if(typeof check.covered!=='boolean' || !check.reason || !Array.isArray(check.rowIds)) {failures.push(`Invalid coverage verdict ${check.id}.`);continue;}
    if(check.covered) {
      if(!check.rowIds.length || check.rowIds.some(id=>byId.get(id)?.applicable!=='Yes')) failures.push(`Coverage ${check.id} lacks applicable supporting assessments.`);
      else covered++;
    } else if(expectedCoverage.find(value=>value.id===check.id)?.critical) failures.push(`Missing critical failure-theme coverage: ${check.id}.`);
  }
  if(seen.size!==expected.size)failures.push('Judge omitted coverage expectations.');
  dimensions.coverage=expected.size?10*covered/expected.size:0;
  if(!assessments.some(row=>row.applicable==='Yes')) failures.push('No applicable hazards were assessed.');
  if(findings.some(issue=>issue.severity==='critical')) failures.push('Critical source/safety contradiction found.');
  const score=Object.entries(QUALITY_WEIGHTS).reduce((total,[key,weight])=>total+dimensions[key]*weight,0);
  const passed=score>=9 && Object.entries(dimensions).every(([key,value])=>key==='coverage' || value>=8) && failures.length===0;
  return {rubricVersion:QUALITY_RUBRIC_VERSION,score,passed,dimensions,findings,failures,
    scoringBasis:'Automated independent-prompt review plus source checks; not engineer-approved safety assurance.'};
}
