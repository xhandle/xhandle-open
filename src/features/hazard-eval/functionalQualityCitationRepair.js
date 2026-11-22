import {validateJudgeEvidence} from './functionalQualityJudge';
const strings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];

export function qualityCitationDiagnostics({verdicts,sources,assessments,facts,sharedSource=[]}) {
  const anchor=[...facts,...strings(sharedSource),...sources.flatMap(source=>strings(source.evidence))].find(value=>value.length>=12);
  if(!anchor)throw Error('Citation diagnostics need external source evidence.');
  const args={sources,assessments,facts,sharedSource};
  const traceable=verdict=>!validateJudgeEvidence({...args,verdicts:[verdict]}).some(error=>/not traceable/.test(error));
  return verdicts.map(verdict=>({id:verdict.id,
    support:(verdict.support || []).map(item=>({valid:!validateJudgeEvidence({...args,verdicts:[{...verdict,support:[item],findings:[]}]}).some(error=>/support/.test(error))})),
    findings:verdict.findings.map((finding,index)=>{
      const base={...verdict,support:[{quote:anchor,source:'Diagnostic source anchor'}]};
      const assessment=assessments.find(row=>row.id===verdict.id);
      return {index,evidencePolicy:['causality','requirements','verification'].includes(finding.dimension)?'External source/fact or a different field of this assessment.':'External source/fact REQUIRED; assessment fields are not admitted for this dimension.',claimValid:traceable({...base,findings:[{...finding,evidence:anchor}]}),
        evidenceValid:traceable({...base,findings:[{...finding,claim:assessment?.[finding.field] || '[missing field]'}]})};
    })}));
}

// Repairs only invalid quotation fields. Judgments stay immutable.
export function applyQualityCitationRepairs(verdicts,repairs,diagnostics=[]) {
  if(!Array.isArray(repairs) || new Set(repairs.map(row=>row.id)).size!==repairs.length)throw Error('Invalid citation repair IDs.');
  const known=new Set(verdicts.map(row=>row.id));
  for(const repair of repairs) {
    if(!known.has(repair.id) || Object.keys(repair).some(key=>!['id','support','findings'].includes(key)))throw Error('Citation repair attempted to change a judgment.');
  }
  return verdicts.map(verdict=>{
    const repair=repairs.find(row=>row.id===verdict.id);if(!repair)return verdict;
    const diagnostic=diagnostics.find(row=>row.id===verdict.id);
    const result={...verdict,findings:verdict.findings.map(row=>({...row}))};
    if(repair.support!==undefined) {
      if(!Array.isArray(repair.support) || repair.support.some(row=>Object.keys(row).some(key=>!['quote','source'].includes(key))))throw Error('Invalid support citation repair.');
      result.support=[...(diagnostic?(verdict.support || []).filter((_,index)=>diagnostic.support[index]?.valid):[]),...repair.support]
        .filter((item,index,all)=>all.findIndex(other=>JSON.stringify(other)===JSON.stringify(item))===index);
    }
    const indexes=new Set();
    for(const item of repair.findings || []) {
      if(!Number.isInteger(item.index) || !result.findings[item.index] || indexes.has(item.index) || Object.keys(item).some(key=>!['index','claim','evidence'].includes(key)))throw Error('Citation repair attempted to change a finding.');
      indexes.add(item.index);
      const check=diagnostic?.findings.find(row=>row.index===item.index);
      for(const key of ['claim','evidence'])if(item[key]!==undefined && !check?.[key+'Valid'])result.findings[item.index][key]=item[key];
    }
    return result;
  });
}

export function qualityCitationRepairPrompt({verdicts,sources,assessments,facts,sharedSource,errors,diagnostics=[]}) {
  return `Repair quotation formatting only for an independent STPA audit whose exact-citation checks failed. Preserve every score, severity, dimension, field, substantive reason and fix. Do not reassess quality or remove findings. Return only a JSON array [{id,support:[{quote,source}],findings:[{index,claim,evidence}]}]. A finding index is its zero-based index in the supplied verdict. Omit unchanged citation fields. Never return scores or other judgment fields.
Support quotes and grounding evidence must be contiguous verbatim supplied source/fact excerpts of at least 12 characters; no ellipses or stitching, and never quote the evaluation instructions/rubric. For an internal inconsistency in causality/requirements/verification, evidence may quote a DIFFERENT assessment field verbatim; this never proves implementation behavior or replaces external support. Remove a rubric quote from support while retaining a real supporting source quote. claim must be a contiguous exact substring of that row's actual offending field; a shorter precise substring is preferable to a paraphrase. Keep its meaning the same. If a finding cannot be supported, leave it unchanged so the check fails; never fabricate a quote to make it pass.
Diagnostics identify the invalid citation field precisely. Preserve every field marked valid. Do not copy a reason into claim or the offending field into evidence. Prefer a short exact source substring over invented variable prefixes or stitched expressions.
Follow each finding's evidencePolicy. Applicability and grounding findings REQUIRE an external source/fact quote, even when the reason compares assessment fields. An assumptions-field quote cannot validate those dimensions. To demonstrate ordering use actual supplied caller statements; do not shorten the same inadmissible assessment quote and try again.
Diagnostics: ${JSON.stringify(diagnostics)}
Errors: ${JSON.stringify(errors)}
Original verdicts: ${JSON.stringify(verdicts)}
Sources: ${JSON.stringify(sources)}
Assessments: ${JSON.stringify(assessments)}
Facts: ${JSON.stringify(facts)}
Full unmodified source: ${JSON.stringify(sharedSource)}`;
}
