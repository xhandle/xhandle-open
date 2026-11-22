// A source-consistency gate on generated assessments. Source/model inputs stay
// governed; only failed generated assessments can be corrected.
import {withGeneratedCaseFamilies,relatedGeneratedContext} from './generatedSiblingContext';
export async function enforceSourceConformance({method,sources,context,results,checkpoint,review,correct,onProgress=()=>{}}) {
  if(method!=='STPA' || !context.sourceBehaviorEvidence?.length)return;
  // Related-case edits can invalidate a previously accepted sibling. Allow a
  // third bounded correction pass for that dependency propagation; every final
  // issue must still clear the same review gate.
  for(let pass=0;pass<4;pass++) {
    const entries=sources.filter(source=>results.get(source.id)?.applicable==='Yes').map(source=>({source,assessment:results.get(source.id)}));
    if(!entries.length)return;
    // Carry complete small-project requirement contracts across review batches.
    // Never truncate a ledger to fit, and never add it to the source model.
    const contracts=entries.filter(entry=>entry.assessment.softwareRequirement).map(({source,assessment})=>({id:source.id,softwareRequirement:assessment.softwareRequirement}));
    const sourceContext={...context,sourceConformanceOnly:true};
    const contractContext=contracts.length && JSON.stringify(contracts).length<=24000?{...sourceContext,generatedRequirementContracts:contracts}:sourceContext;
    const reviewContext=withGeneratedCaseFamilies(contractContext,sources,results);
    const bases=entries.map(entry=>({stage:'source-conformance-v3-related-cases',method,context:relatedGeneratedContext(reviewContext,[entry.source]),...entry}));
    const saved=await checkpoint.readMany(bases),findings={};
    const pending=entries.filter((entry,index)=>{
      if(Array.isArray(saved[index]?.issues) && saved[index].issues.every(issue=>typeof issue==='string')){findings[entry.source.id]=saved[index].issues;return false;}
      return true;
    });
    if(pending.length) {
      onProgress({message:`Checking source consistency before publication: ${pending.length} assessments…`});
      const verdicts=await review(pending,reviewContext);
      for(const entry of pending) {
        const issues=verdicts[entry.source.id];
        if(!Array.isArray(issues) || issues.some(issue=>typeof issue!=='string' || !issue.trim()))throw Object.assign(Error('Source conformance review is incomplete; generated results remain unpublished.'),{sourceConformanceFindings:[{id:entry.source.id,issues:['Source conformance review unavailable.']}]});
        findings[entry.source.id]=issues;
        await checkpoint.write(bases[entries.indexOf(entry)],{issues});
      }
    }
    const failed=entries.filter(entry=>findings[entry.source.id].length).map(entry=>({...entry,issues:findings[entry.source.id]}));
    if(!failed.length)return;
    if(pass===3)throw Object.assign(new Error('Generated assessments still contradict source after correction; results remain incomplete.'),{sourceConformanceFindings:failed.map(({source,issues})=>({id:source.id,issues}))});
    onProgress({message:`Correcting ${failed.length} source-inconsistent assessments; source and functional model unchanged…`});
    await correct(failed,reviewContext);
  }
}
