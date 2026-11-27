import {preferredHazardFailure} from './hazardDeferredFailures';
export const STPA_COMPLETION_POLICY = 'minimum-usable-assessment-v1';
export const STPA_QUALIFICATION_ATTEMPTS = 2;
export const STPA_COMPLETION_GUIDANCE = `Practical STPA stopping rule: produce the best usable assessment from the modeled action and operating context. Connect UCA, hazard, loss and causal scenario, and provide a useful constraint and verification proposal. Source substantiation and exhaustive evidence are not prerequisites for completing this AI-generated draft. Make a best engineering judgment where details are limited. Do not return information requests, assessment-failure statuses, special evidence-gap conclusions or boilerplate caveats. Use ordinary assessment fields, including Assumptions where relevant. Preserve analyst decisions and explicit operating scope. Never fabricate source quotations, executed verification results or a claim of verified system safety. Once an assessment is usable, retain it rather than repeatedly seeking hypothetical improvement.`;
const text=value=>typeof value==='string'?value.trim():'';
const classifications=['Safety — Direct','Safety — Related','Mission/Reliability'];
const fields=['uca','loss','hazard','causalScenario','causalFactor','safetyConstraint','softwareRequirement','verification'];
const placeholder=value=>!text(value) || /^(?:TBD|TBC|TODO|unknown|unresolved|pending|needs? review|not generated|n\/a)(?:$|\s*[:—-])/i.test(text(value));
export const isStpaCompletionPlaceholder = placeholder;
const evidenceStrings=value=>typeof value==='string'?[value]:value && typeof value==='object'?Object.values(value).flatMap(evidenceStrings):[];
export function prepareStpaDraft(row,source,context={}) {
 if(!row || typeof row!=='object')return row;
 const draft={...row};
 if(source.reviewedApplicability){draft.applicable=source.reviewedApplicability;draft.applicabilityRationale=source.reviewedRationale || draft.applicabilityRationale;}
 const governed=source.reviewedValues?.['Safety Classification'];
 if(classifications.includes(governed) && draft.applicable==='Yes')draft.classification=governed;
 else if(draft.applicable==='Yes' && source.reviewedValues?.['Safety Significant']==='Yes' && draft.classification==='Mission/Reliability')draft.classification='Safety — Related';
 else if(draft.applicable==='Yes' && source.reviewedValues?.['Safety Significant']==='No')draft.classification='Mission/Reliability';
 if(draft.causalBasis==='Source-supported'){
  const quote=text(draft.evidenceQuote).replace(/\s+/g,' ');
  if(quote.length<16 || !evidenceStrings([source.evidence,context.sharedSourceCorpus]).some(value=>value.replace(/\s+/g,' ').includes(quote))){draft.causalBasis='Hypothesis';draft.evidenceQuote='';}
 }
 return draft;
}
export function stpaMinimumAssessmentIssues(row,source) {
 if(!row || row.id!==source.id)return ['Incorrect row identity'];
 const errors=[];
 if(row.applicable!=='No' && source.action && row.assessedAction!==source.action)errors.push('assessedAction must match the modeled action');
 if(!['Yes','No'].includes(row.applicable))errors.push('Conclude applicability as Yes or No');
 if(source.reviewedApplicability && row.applicable!==source.reviewedApplicability)errors.push('Reviewed applicability is read-only');
 if(placeholder(row.applicabilityRationale))errors.push('Provide an applicability rationale');
 if(row.applicable==='No')return row.classification==='Not applicable'?errors:[...errors,'Excluded rows require Not applicable classification'];
 if(!classifications.includes(row.classification))errors.push('Provide a safety classification');
 for(const field of [...fields,'classificationRationale','assumptions'])if(placeholder(row[field]))errors.push(`Provide ${field}`);
 if(!/\bshall\b/i.test(text(row.softwareRequirement)))errors.push('Provide a software shall requirement');
 if(!/\bshall\b/i.test(text(row.safetyConstraint)))errors.push('Provide a system/controller shall constraint');
 if(row.fallbackAssessment && row.fallbackAssessment.kind!=='best-effort-draft')errors.push('Discard the obsolete generic recovery template');
 return errors;
}
export const retainStpaDraft=row=>({...row,completionPolicy:STPA_COMPLETION_POLICY});
// Bounded recovery uses the exact modeled interface. It invents no protective
// role, fatal consequence, source quotation or successful verification result.
export function bestEffortStpaDraft(source,decision) {
 const action=source.action || 'the modeled action',receiver=source.to || 'the receiving function';
 const applicable=source.reviewedApplicability || decision?.applicable || 'Yes';
 const rationale=source.reviewedRationale || decision?.rationale || `The modeled interaction supplies a result to ${receiver}; assess the selected deviation of that responsibility.`;
 if(applicable==='No')return {id:source.id,assessedAction:source.action,applicable,applicabilityRationale:rationale,classification:'Not applicable',classificationRationale:'Guide phrase excluded.',assumptions:'Not applicable',completionPolicy:STPA_COMPLETION_POLICY};
 const phrase=String(source.phrase || '');
 const deviation=/not providing|not provided|omission/i.test(phrase)?'is not provided when the receiver requires it':/too early/i.test(phrase)?'is provided before its input preconditions hold':/too late/i.test(phrase)?'is provided after the receiver needs its result':/wrong order/i.test(phrase)?'is provided out of sequence with its prerequisites':/stopped too soon/i.test(phrase)?'stops before its required result is complete':/too long/i.test(phrase)?'continues after its result should cease to be used':'is provided with an incorrect or unusable result';
 const governed=source.reviewedValues?.['Safety Classification'];
 const classification=classifications.includes(governed)?governed:source.reviewedValues?.['Safety Significant']==='Yes'?'Safety — Related':'Mission/Reliability';
 return {id:source.id,assessedAction:source.action,applicable,applicabilityRationale:rationale,classification,
  classificationRationale:governed?'Classification retained from analyst input.':`This scenario concerns availability and correctness of the modeled result at ${receiver}.`,
  uca:`When ${receiver} requires the interaction in the stated operating context, “${action}” ${deviation}.`,
  loss:`Loss of reliable completion of the operation supported by ${receiver}.`,
  hazard:`${receiver} operates without the usable interaction result required for its current operation.`,
  causalScenario:`If “${action}” ${deviation}, ${receiver} can receive an absent, obsolete or incorrect result and the dependent operation can fail or produce incorrect output.`,
  causalFactor:`Incorrect provision or enforcement of input, sequence or completion conditions for “${action}”.`,
  safetyConstraint:`The controller shall provide “${action}” according to its operating preconditions and the receiving function's result-validity contract.`,
  softwareRequirement:`The software shall provide a valid result for “${action}” before ${receiver} accepts it for the dependent operation and shall prevent acceptance of an invalid or obsolete result.`,
  verification:`Stub or mutate “${action}” to exercise the selected deviation. Assert that ${receiver} does not accept an invalid or obsolete result; exercise normal operation and compare the accepted result with a reference calculation.`,
  assumptions:`${receiver} requires the modeled interaction result for the current operation. The guide phrase concerns this interaction's input, sequence, result validity or completion contract.`,
  causalBasis:'Hypothesis',evidenceQuote:'',completionPolicy:STPA_COMPLETION_POLICY,fallbackAssessment:{version:1,kind:'best-effort-draft'},
 };
}
export async function completeQualifiedStpaAssessments({sources,context,decisions,failures,request,makePrompt,validate,save,results,signal,onProgress=()=>{}}) {
 let next=0,failure;
 const check=()=>{if(signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');};
 await Promise.all(Array.from({length:Math.min(3,sources.length)},async()=>{
  while(!failure && next<sources.length){
   try{
    check();const source=sources[next++];let feedback={priorDecision:decisions.get(source.id),priorIssues:failures[source.id] || []};
    for(let attempt=0;attempt<STPA_QUALIFICATION_ATTEMPTS;attempt++){
     check();onProgress({message:`Finalizing STPA assessment ${source.id}…`});
     const raw=await request(makePrompt(source,{[source.id]:feedback}),source,attempt);check();
     let rows;try{rows=typeof raw==='string'?JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):raw;}catch{rows=[];}
     const matches=Array.isArray(rows)?rows.filter(row=>row?.id===source.id):[];
     const candidate=prepareStpaDraft(matches.length===1?matches[0]:null,source,context),errors=validate(candidate,source);
     if(!errors.length){const value=retainStpaDraft(candidate);await save(source,value);check();results.set(source.id,value);delete failures[source.id];break;}
     feedback={...feedback,structuralErrors:errors,previousAssessment:candidate};
    }
   }catch(error){failure=preferredHazardFailure(failure,error);}
  }
 }));
 check();if(failure)throw failure;
}
