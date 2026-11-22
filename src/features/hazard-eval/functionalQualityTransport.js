import {sourceEvidenceReferences} from '../code-architecture-hazard-analysis/sourceEvidenceReferences';
// Lossless transport normalization. Never select a better score or drop a finding.
export function normalizeQualityVerdicts(rows,sources) {
  if(!Array.isArray(rows))throw Error('Quality verdicts must be an array.');
  const expected=new Set(sources.map(row=>row.id)),byId=new Map();
  for(const row of rows) {
    if(!expected.has(row?.id))throw Error('Independent evaluator invented an ID.');
    const prior=byId.get(row.id);
    if(!prior){byId.set(row.id,row);continue;}
    const keys=[...new Set([...Object.keys(prior.scores || {}),...Object.keys(row.scores || {})])];
    if(keys.some(key=>prior.scores?.[key]!==row.scores?.[key]))throw Error('Duplicate evaluator verdicts have conflicting scores.');
    const union=values=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];
    byId.set(row.id,{...prior,support:union([...(prior.support || []),...(row.support || [])]),findings:union([...(prior.findings || []),...(row.findings || [])])});
  }
  if(byId.size!==expected.size)throw Error('Independent evaluator omitted an ID.');
  return sources.map(source=>{
    const verdict=byId.get(source.id),scores={...verdict.scores},ceilings=[];
    for(const finding of verdict.findings || []) {
      const ceiling=finding.severity==='critical'?4:finding.severity==='major'?7:10;
      const value=scores[finding.dimension];
      if(Number.isFinite(value) && value>=0 && value<=10 && value>ceiling){ceilings.push({dimension:finding.dimension,original:value,ceiling});scores[finding.dimension]=ceiling;}
    }
    return ceilings.length?{...verdict,scores,appliedScoreCeilings:[...(verdict.appliedScoreCeilings || []),...ceilings]}:verdict;
  });
}

export function compactQualitySources(sources,sharedSource) {
  return sourceEvidenceReferences(sources,sharedSource);
}
