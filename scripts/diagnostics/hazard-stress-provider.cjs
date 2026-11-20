// Deterministic transport fixture; no provider credentials or paid calls.
function inputsFromPrompt(prompt) {
  const end=prompt.lastIndexOf(']')+1;
  for(let start=prompt.lastIndexOf('[',end-1);start>=0;start=prompt.lastIndexOf('[',start-1)){
    try{const rows=JSON.parse(prompt.slice(start,end));if(Array.isArray(rows)&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))return rows;}catch{}
  }
  throw Error('Stress provider did not recognize the requested row contract.');
}
function assessment(input,action='Brake command') {
 const row=input.row||input.source||input;
 const id=input.id||row.id;
 if(!id)throw Error('Stress provider requires an exact source ID.');
 return {id,assessedAction:action,applicable:'Yes',applicabilityRationale:'The brake actuator depends on the brake command to stop the vehicle.',
  guidePhraseApplicable:'Yes',applicabilityDecision:'Yes',guidePhraseApplicabilityRationale:'The brake actuator depends on the brake command to stop the vehicle.',
  semanticMeaningful:'Yes',receiverCanBeAffected:'Yes',contextSupportsMechanism:'Yes',adverseStateSupported:'Yes',
  applicabilityEvidenceField:'Control Action',applicabilityEvidenceQuote:action,applicabilityMechanism:'An omitted brake command prevents stopping before an occupied crossing.',
  unsafeControlActions:'The vehicle controller omits the brake command at an occupied pedestrian crossing.',uca:'The vehicle controller omits the brake command at an occupied pedestrian crossing.',
  losses:'Pedestrians are injured or killed in a collision.',loss:'Pedestrians are injured or killed in a collision.',
  hazards:'The vehicle enters an occupied crossing without stopping.',hazard:'The vehicle enters an occupied crossing without stopping.',
  rawLossCandidate:'Fatal pedestrian injury',rawHazardCandidate:'Vehicle enters an occupied crossing without stopping',
  causalScenario:'An omitted brake command prevents the brake actuator from stopping the vehicle at an occupied crossing.',
  causalFactors:'Hypothesis: a transmission fault prevents the brake actuator from receiving the brake command.',causalFactor:'Hypothesis: a transmission fault prevents the brake actuator from receiving the brake command.',causalFactorCategory:'Communication / interface',
  mitigationStrategy:'Detect brake command loss and invoke independent braking.',safetyRequirementsConstraints:'The vehicle shall stop before an occupied crossing.',safetyConstraint:'The vehicle shall stop before an occupied crossing.',
  systemRequirement:'The vehicle controller shall command braking before entering an occupied crossing.',softwareRequirement:'The software shall reject a brake command whose validity interval has expired.',
  verificationMethod:'Inject loss of the brake command before an occupied crossing.',verification:'Inject loss of the brake command before an occupied crossing.',acceptanceCriteria:'The vehicle stops before the crossing.',
  safetyClassification:'Safety — Direct',classification:'Safety — Direct',safetyClassificationRule:'D1',causalPathType:'Direct',protectionStatus:'Absent',
  causalEffect:'The brake actuator does not apply braking.',resultingSystemState:'The vehicle fails to stop at the occupied crossing.',classificationEvidence:'Braking directly controls vehicle motion.',classificationConfidence:'High',
  classificationRationale:'The omitted brake command directly causes loss of stopping and a pedestrian collision.',safetySignificant:'Yes',safetySignificanceRationale:'The omitted brake command directly causes loss of stopping and a pedestrian collision.',
  proposedSafetyAssessment:'Safety',proposedSafetyAssessmentRationale:'The omitted brake command directly causes loss of stopping and a pedestrian collision.',
  safetyExposureCategory:'People',safetyExposurePath:'Failure to stop exposes pedestrians at the occupied crossing.',safetyEvidenceField:'Control Action',safetyEvidenceQuote:action,safetyContributionType:'Direct',causalNecessitySupported:'Yes',additionalFailureRequired:'No',safeguardPrecludesPath:'No',
  canonicalLossIds:['L1'],canonicalHazardId:'H1',itemFunction:'Vehicle braking',malfunction:'Loss of commanded braking',
  hazardousEvent:'The vehicle fails to stop at an occupied pedestrian crossing during automated urban driving.',potentialHarm:'Fatal pedestrian injury.',personsAtRisk:'Pedestrians',
  severity:'S3',severityRationale:'A vehicle impact can fatally injure a pedestrian.',exposure:'E4',exposureRationale:'The supplied operating-domain record identifies occupied crossings as frequent.',
  controllability:'C3',controllabilityRationale:'No human driver is present and the exposed pedestrian cannot avoid the impact.',ratingRationale:'Fatal harm is possible at frequent crossings without a driver or pedestrian recovery opportunity.',
  safetyGoal:'The vehicle shall prevent loss of braking at occupied crossings.',safeState:'Controlled standstill with propulsion inhibited.',ftti:'100 ms',fttiRationale:'Allow 100 ms from brake command loss to crossing entry; this allocation assumes a stopping margin compatible with the stated approach speed.',
  itemDefinition:'Automated braking item: vehicle controller and brake actuator; no human driver.',assumptions:'The stopping response is a required measure; implementation is not established by this synthetic source.',gaps:'',
  vehicleHazard:'The vehicle enters an occupied crossing without stopping.',operationalSituation:'Automated urban driving at occupied crossings.',
  hazardOutcome:'Fatal pedestrian impact at an occupied crossing',harmChain:'An omitted brake command prevents stopping at an occupied crossing and the moving vehicle can fatally injure pedestrians.',evidenceBasis:'E/E malfunction',
  exposureEvidence:'Frequent occupied crossings in the intended operating situation.',independentMeasures:'No independent external avoidance is established by the source.',
  safeStateJustification:'Holding the vehicle at standstill before the crossing prevents impact with exposed pedestrians.',safeStateEvidence:'',
  fttiEvidence:'',candidateRequirements:'The vehicle controller shall command braking before entering an occupied crossing.',candidateTiming:'',proposedMitigations:'Independent braking must hold standstill before crossing entry.',
  safetyGoalRationale:'All linked events concern loss of stopping at an occupied crossing.',hazardMappingReview:'Supported: the canonical hazard and event both describe failure to stop at an occupied crossing.',decisionBasis:'Engineering judgment',
  causalBasis:'Hypothesis',causalEvidence:'Assumed brake command transmission fault; inject command loss to verify.',executionDependency:'None',operatorDependency:'None',executionEvidenceQuote:'',operatorContextQuote:'',
 };
}
function respond(prompt) {
 if(prompt.includes('Return ONLY one JSON object with arrays losses and hazards'))return {losses:[{id:'L1',statement:'Fatal injury to pedestrians.'}],hazards:[{id:'H1',statement:'The vehicle enters an occupied crossing without stopping.'}]};
 const inputs=inputsFromPrompt(prompt);
 const results=inputs.map(input=>assessment(input));
 if(prompt.startsWith('First-pass '))return results.map(row=>({id:row.id,applicable:'Yes',rationale:row.applicabilityRationale}));
 if(prompt.includes('Perform the ISO 26262-3 HARA'))return {assessments:results};
 return results;
}
module.exports={inputsFromPrompt,assessment,respond};
