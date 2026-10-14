import {usableHazardInputs} from './hazardCompletionSupport';
import {classificationValues,validateFastAssessment} from './fastHazardSchema';

// Local, bounded completion when a provider cannot return an assessment. These
// are conditional bounding scenarios, never fabricated observations or citations.
export function assumptionHazardFallback(method,source,decision) {
 const {usable,retained}=usableHazardInputs(source.reviewedValues || {},method);
 source={...source,reviewedValues:usable};
 const applicable=source.reviewedApplicability || decision?.applicable || 'Yes';
 const rationale=source.reviewedRationale || decision?.rationale || 'Included under the stated bounding assumptions so this guide phrase is assessed rather than silently excluded.';
 if(applicable==='No')return {id:source.id,applicable,applicabilityRationale:rationale,classification:'Not applicable',classificationRationale:'Guide phrase excluded.',assumptions:'Not applicable'};
 const action=source.action || 'the specified action',target=source.to || 'the receiving function';
 const phrase=String(source.phrase || 'deviation from the intended action');
 const deviation=/not providing|not provided|omission|no function/i.test(phrase)?'is omitted when required':/too early/i.test(phrase)?'occurs before its required preconditions hold':/too late/i.test(phrase)?'occurs after the required response boundary':/wrong order/i.test(phrase)?'occurs outside the required sequence':/stopped too soon/i.test(phrase)?'ends before its required completion condition':/too long/i.test(phrase)?'persists beyond its required termination condition':/providing|provided/i.test(phrase)?'occurs when its enabling conditions do not hold':`deviates according to the guide phrase “${phrase}”`;
 const values=source.reviewedValues || {};
 const classification=classificationValues.includes(values['Safety Classification'])?values['Safety Classification']:values['Safety Significant']==='No'?'Mission/Reliability':'Safety — Related';
 const mission=classification==='Mission/Reliability',direct=classification==='Safety — Direct';
 const premise=mission
  ?`Assume the effects of “${action}” are confined to the mission output of “${target}”, with no physical-harm propagation in this assessment scenario.`
  :direct?`For this conservative bounding scenario, assume the deviation in “${action}” directly produces a physical state at “${target}” capable of fatal injury. This physical allocation and consequence are assessment premises, not observed source facts.`:`For this conservative bounding scenario, assume “${target}” has an allocated protective role and the deviation in “${action}” can defeat that role, permitting a fatal physical-harm outcome. This allocation and consequence are assessment premises, not observed source facts.`;
 const effect=mission?`The required mission output of “${target}” is unavailable or invalid.`:direct?`The assumed directly hazardous physical state at “${target}” occurs.`:`The assumed protective function of “${target}” is unavailable when demanded.`;
 const loss=mission?'Loss of the required mission output.':'Fatal injury in the assumed physical-harm scenario.';
 const constraint=`The controller shall permit “${action}” only under its specified enabling conditions, sequence, and completion or termination criteria.`;
 const result={id:source.id,assessedAction:source.action,applicable,applicabilityRationale:rationale,classification,
  classificationRationale:mission?`Under the mission-only premise, propagation ends at the output of “${target}”.`:classification==='Safety — Direct'?`The retained classification assumes a direct physical-harm path from “${action}”.`:`Under the stated protective-allocation premise, “${action}” contributes through “${target}” to the physical-harm outcome.`,
  assumptions:`${premise} Assume the selected guide phrase has a meaningful enabling, ordering, timing, or duration condition for this action. Those conditions must be specified by the system contract; no numerical thresholds, concurrency, or human intervention are assumed. Existing safeguards are not assumed absent. The causal mechanism below is hypothetical.`,
  assessmentBasis:'Assumption-based bounding assessment generated locally after bounded recovery. Conclusions and ratings depend on the premises in Assumptions; no source-supported defect or verified safety rating is claimed.',
  causalBasis:'Hypothesis',causalEvidence:'Assume an action-condition enforcement fault; verify the allocation and action contract and exercise the stated deviation.',evidenceQuote:'No source quote — causal hypothesis',
  executionDependency:'None',operatorDependency:'None',executionEvidenceQuote:'Not applicable — no concurrent execution assumed',operatorContextQuote:'Not applicable — no operator intervention assumed',
  uca:`Under the stated premises, “${action}” ${deviation}, affecting “${target}”.`,loss,hazard:`Under the stated premises: ${effect}`,
  causalScenario:`Assume an action-condition enforcement fault: “${action}” ${deviation}. Under the stated premises, this produces the described system state and can lead to ${loss.toLowerCase()}`,
  causalFactor:`Hypothesis: enforcement of the specified action condition for “${action}” fails.`,safetyConstraint:constraint,
  malfunction:`“${action}” ${deviation}.`,hazardousEvent:`Under the stated premises, the action deviation produces this operating condition: ${effect} The resulting consequence is ${loss.toLowerCase()}`,
  safetyGoal:`Prevent the stated consequence of the deviation in “${action}” through enforcement of the allocated action contract.`,mishap:`Under the stated premises: ${effect}`,
  softwareRequirement:`The software shall enforce the specified enabling conditions, sequence, and completion or termination criteria for “${action}”, and report a detected violation before its output is accepted by “${target}”.`,
  verification:`Establish the action contract and the stated allocation premises. Inject the selected deviation in “${action}”; verify that “${target}” does not accept the violating output and that the violation is reported. Exercise permitted operation to verify that valid output is accepted.`,
  fallbackAssessment:{version:1,kind:'assumption-based'},
 };
 if(method==='HARA')Object.assign(result,{severity:mission?'S0':'S3',exposure:mission?'E1':'E4',controllability:mission?'C0':'C3',ratingRationale:mission?'S0 assumes no injuries in the mission-only scenario; E1 assumes infrequent exposure to that scenario; C0 reflects the no-injury premise.':'Bounding premises: S3 assumes fatal injury is possible; E4 assumes frequent exposure to the operational situation; C3 assumes recovery cannot prevent the harm. These premises do not estimate software failure probability.'});
 if(method==='FHA')Object.assign(result,{severity:mission?'IV':'I',severityRationale:mission?'Severity IV assumes negligible safety consequences under the mission-only premise.':'Severity I bounds the assumed fatal physical-harm outcome.',scc:mission?'5':'1',sccRationale:mission?'SCC 5 assumes no safety role under the mission-only premise.':'SCC 1 assumes autonomous software control of the protective function, with no independent control credited in this bounding scenario.'});
 
 
 // User-owned fields are not repaired by inventing replacements. Contradictory
 // governed values still surface as a data conflict, rather than being hidden.
 const headers={Severity:'severity',...(method==='FHA'?{'Severity Category':'severity'}:{}),Exposure:'exposure',Controllability:'controllability','Software Control Category':'scc','Rating Rationale':'ratingRationale','Severity Rationale':'severityRationale','Software Control Category Rationale':'sccRationale'};
 for(const [header,field] of Object.entries(headers))if(values[header])result[field]=values[header];
 if(method==='HARA' && ['Severity','Exposure','Controllability'].some(h=>values[h]) && !values['Rating Rationale'])
  result.ratingRationale=`Retained reviewed ratings: severity ${result.severity}, exposure ${result.exposure}, controllability ${result.controllability}. Treat each selected rating category as a premise for this assessment; unreviewed categories use the bounding assumptions.`;
 if(method==='FHA' && (values['Severity Category'] || values.Severity) && !values['Severity Rationale'])
  result.severityRationale=`Retained reviewed severity ${result.severity}; the consequence category is a premise of this assessment.`;
 if(method==='FHA' && values['Software Control Category'] && !values['Software Control Category Rationale'])
  result.sccRationale=`Retained reviewed SCC ${result.scc}; the control-role category is a premise of this assessment.`;
 if(method==='HARA')result.assumptions+=` Selected ratings: ${result.severity}/${result.exposure}/${result.controllability}. ${Object.keys(headers).some(h=>values[h])?'Reviewed ratings are retained; unreviewed ratings use the bounding premises.':result.ratingRationale}`;
 if(method==='FHA')result.assumptions+=` Selected ratings: ${result.severity}/SCC ${result.scc}. ${Object.keys(headers).some(h=>values[h])?'Reviewed ratings are retained; unreviewed ratings use the bounding premises.':result.severityRationale+' '+result.sccRationale}`;
 if(Object.keys(headers).some(h=>values[h]))result.assumptions+=' Explicitly reviewed rating fields take precedence over the bounding defaults; their retained rationale supplies the rating premise.';
 if(Object.keys(retained).length){
  result.retainedUserInputs=retained;
  result.assessmentBasis+=' Original imported values requiring normalization or replacement are retained separately; this assessment uses the stated premises instead.';
 }
 const errors=validateFastAssessment(method,result,{...source,screenedApplicability:decision?.applicable,screenedRationale:decision?.rationale},{structuralOnly:true});
 if(errors.length)throw new Error(`Cannot reconcile governed values for ${source.id}: ${errors.join('; ')}`);
 return result;
}
