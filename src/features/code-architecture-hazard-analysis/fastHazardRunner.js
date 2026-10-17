import {waitForHazardSave} from './waitForHazardSave';
import {safeHazardObserver,usableHazardInputs} from './hazardCompletionSupport';
import {compactReviewEntries} from './fastHazardSemanticReview';
import {organizationProfileContextIdentity} from '../organization-profile/organizationProfile';
import {functionalModelIsReady} from '../code-architecture-context/functionalModel';
import {getStoredActiveAIProvider,getStoredAIProviderModelPreference,getStoredAIProviderEffortPreference} from '../../lib/aiProviderConfig';
import {buildCodeArchitectureHazardInput,normalizeCodeArchitectureHazardRun,makeCodeArchitectureHazardId,traceabilityObjectToSummaryFields} from './codeArchitectureHazardUtils';
import {prepareCodeHazardPreprocessing,reconcileCodeHazardPreprocessing,hazardPreprocessingIdentitySheet} from './codeArchitectureHazardPreprocessing';
import {createCodeHazardCheckpoint} from './codeHazardGenerationCheckpoint';
import {saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {generateFastHazards,compactHazardSources} from './fastHazardPipeline';
import {fastMethod,FAST_HAZARD_VERSION,FAST_HAZARD_COLUMNS,deriveFastAsil,deriveFastSwci,validateFastAssessment} from './fastHazardSchema';

const SUMMARY_ASSESSMENT_FIELDS=method=>({assessmentBasis:'Assessment Basis',executionDependency:'Execution Dependency',executionEvidenceQuote:'Execution Evidence Quote',operatorDependency:'Operator Dependency',operatorContextQuote:'Operator Context Quote',uca:'Unsafe Control Action',loss:'Loss',causalScenario:'Causal Scenario',safetyConstraint:'Safety Constraint',evidenceQuote:'Causal Evidence Quote',assessedAction:'Assessed Control Action',causalBasis:'Causal Assessment Basis',causalEvidence:'Causal Evidence / Assumption',applicable:'Guide Phrase Applicable',applicabilityRationale:'Guide Phrase Applicability Rationale',classification:'Safety Classification',classificationRationale:'Safety Significance Rationale',assumptions:'Assumptions',malfunction:'Malfunctioning Behavior',causalFactor:'Causal Factor',hazard:'Hazard',hazardousEvent:'Hazardous Event',mishap:'Mishap',severity:method==='FHA'?'Severity Category':'Severity',exposure:'Exposure',controllability:'Controllability',ratingRationale:'Rating Rationale',safetyGoal:'Safety Goal',severityRationale:'Severity Rationale',scc:'Software Control Category',sccRationale:'Software Control Category Rationale',softwareRequirement:'Software Safety Requirement',verification:'Verification'});

// Imports remain governed inputs. Validate the merged artifact, and calculate
// dependent ratings from the final ratings rather than retaining stale indexes.
function validateMergedSheet(method,sheet,sources,onInvalid) {
  const headers=sheet[0];
  const fields=SUMMARY_ASSESSMENT_FIELDS(method);
  for(let index=1;index<sheet.length;index++){
    const row=sheet[index],source=sources[index-1];
    // An imported prior assessment must not refill excluded downstream cells.
    if(row[headers.indexOf('Guide Phrase Applicable')]==='No'){
      for(const [key,header] of Object.entries(fields)){
        const column=headers.indexOf(header);
        if(column>=0 && !['applicable','applicabilityRationale','assessedAction'].includes(key))row[column]='Not applicable — guide phrase excluded';
      }
      for(const header of ['ASIL','Software Criticality Index','SWCI Rationale / Derivation','Assessment Basis']){
        const column=headers.indexOf(header);if(column>=0)row[column]='Not applicable — guide phrase excluded';
      }
    }
    const assessment={id:source.id,...Object.fromEntries(Object.entries(fields).map(([key,header])=>[key,row[headers.indexOf(header)]]))};
    if(assessment.applicable==='No')assessment.classification='Not applicable';
    const errors=validateFastAssessment(method,assessment,source,{structuralOnly:true});
    if(errors.length){
      if(!onInvalid)throw new Error(`Imported assessment ${index} conflicts with the completed ${method} result: ${errors.join('; ')}`);
      onInvalid(index,errors);
      validateMergedSheet(method,[headers,sheet[index]],[source]);
      continue;
    }
    if(assessment.applicable==='Yes' && method==='HARA')row[headers.indexOf('ASIL')]=deriveFastAsil(assessment.severity,assessment.exposure,assessment.controllability);
    if(assessment.applicable==='Yes' && method==='FHA'){
      const swci=deriveFastSwci(assessment.severity,assessment.scc);
      row[headers.indexOf('Software Criticality Index')]=swci;
      row[headers.indexOf('SWCI Rationale / Derivation')]=`Severity ${assessment.severity} and SCC ${assessment.scc} map to ${swci} using the software criticality matrix.`;
    }
    row[headers.indexOf('Safety Significant')]=assessment.applicable==='Yes' && assessment.classification!=='Mission/Reliability'?'Yes':'No';
  }
}

export function fastHazardSheets(method,input,assessments) {
  const records=assessments.map((result,index)=>{
    const source=input.tableRows[index], no=result.applicable==='No';
    const downstream=value=>no?'Not applicable — guide phrase excluded':value;
    const classification=downstream(result.classification);
    return {
      ...traceabilityObjectToSummaryFields(source.traceability),
      // Preserve the original architecture snapshot; do not invent classifications.
      'Lifecycle Phase': /^(?:needs? review|unknown|unresolved)?$/i.test(String(source.lifecyclePhase || '').trim()) ? 'Not specified in source architecture' : source.lifecyclePhase,
      'Interface Type': /^(?:needs? review|unknown|unresolved)?$/i.test(String(source.interfaceType || '').trim()) ? 'Not specified in source architecture' : source.interfaceType,
      'Raw Analysis Row ID':source.userPreprocessingId || result.id,
      'Function':source.fromFunction,'Function (From)':source.fromFunction,'Control Action':source.controlAction,'Function (To)':source.toFunction,
      'Operational Context ID':source.operationalContextId,'Operational Scenario':source.operationalScenario || 'Not specified',
      'Operational Mode':source.operationalMode || 'Not specified','Operating Conditions':source.operatingConditions || 'Not specified',
      'Context Assumptions':source.contextAssumptions || 'None specified',
      'Operational Context':[source.operationalScenario,source.operationalMode,source.operatingConditions].filter(Boolean).join(' · ') || 'Not specified',
      'Guide Phrase':source.guidePhrase,'Guide Phrase Applicable':result.applicable,
      'Guide Phrase Applicability Rationale':result.applicabilityRationale,
      'Guide Phrase Applicability Review Status':source.guidePhraseApplicabilityReviewStatus || 'AI assessed',
      'Malfunctioning Behavior':downstream(result.malfunction),'Causal Factor':downstream(result.causalFactor),
      'Unsafe Control Action':downstream(result.uca),'Loss':downstream(result.loss),
      'Causal Scenario':downstream(result.causalScenario),'Safety Constraint':downstream(result.safetyConstraint),
      'Loss ID':no?'Not applicable':`L-${result.id}`,
      'Hazard ID':no?'Not applicable':`H-${result.id}`,
      'UCA ID':no?'Not applicable':`UCA-${result.id}`,
      'Hazard → Loss ID':no?'Not applicable':`L-${result.id}`,
      'UCA → Hazard ID':no?'Not applicable':`H-${result.id}`,
      'Causal Scenario → UCA ID':no?'Not applicable':`UCA-${result.id}`,
      'Safety Constraint → UCA ID':no?'Not applicable':`UCA-${result.id}`,
      'Hazard':downstream(result.hazard || result.hazardousEvent || result.mishap),
      'Hazardous Event':downstream(result.hazardousEvent),'Mishap':downstream(result.mishap),
      'Severity':downstream(result.severity),'Exposure':downstream(result.exposure),'Controllability':downstream(result.controllability),
      'ASIL':downstream(method==='HARA'?deriveFastAsil(result.severity,result.exposure,result.controllability):''),
      'Rating Rationale':downstream(result.ratingRationale),'Safety Goal':downstream(result.safetyGoal),
      'Severity Category':downstream(result.severity),'Severity Rationale':downstream(result.severityRationale),
      'Software Control Category':downstream(result.scc),'Software Control Category Rationale':downstream(result.sccRationale),
      'Software Criticality Index':downstream(method==='FHA'?deriveFastSwci(result.severity,result.scc):''),
      'SWCI Rationale / Derivation':downstream(method==='FHA'?`Severity ${result.severity} and SCC ${result.scc} map to ${deriveFastSwci(result.severity,result.scc)} using the software criticality matrix.`:''),
      'Safety Classification':classification,'Safety Significant':no || result.classification==='Mission/Reliability'?'No':'Yes',
      'Safety Significance Rationale':downstream(result.classificationRationale),
      'Software Safety Requirement':downstream(result.softwareRequirement),'Verification':downstream(result.verification),
      'Execution Dependency':no?'Not applicable':result.executionDependency,
      'Execution Evidence Quote':downstream(result.executionEvidenceQuote || ''),
      'Operator Dependency':no?'Not applicable':result.operatorDependency,
      'Operator Context Quote':downstream(result.operatorContextQuote || ''),
      'Assessed Control Action':result.assessedAction || source.controlAction,
      'Causal Evidence Quote':downstream(result.evidenceQuote || 'No source quote — causal hypothesis'),
      'Causal Assessment Basis':no?'Not applicable':result.causalBasis,
      'Causal Evidence / Assumption':no?'Not applicable':result.causalEvidence,
      'Assumptions':downstream(result.assumptions),'Assessment Basis':downstream(result.assessmentBasis || (result.evidencePreparation?.mode==='chunked'?'AI-generated assessment using chunked evidence summaries; original source retained; assumptions recorded separately':'AI-generated assessment; assumptions recorded separately')),
    };
  });
  const common=['Execution Dependency','Execution Evidence Quote','Operator Dependency','Operator Context Quote','Function (From)','Control Action','Function (To)','Operational Context ID','Operational Scenario','Operational Mode','Operating Conditions','Context Assumptions','Guide Phrase Applicability Rationale','Guide Phrase Applicability Review Status','Hazard','Safety Significant','Safety Significance Rationale','Software Safety Requirement','Verification','Assumptions','Assessment Basis','Assessed Control Action','Causal Assessment Basis','Causal Evidence / Assumption','Causal Evidence Quote','Raw Analysis Row ID'];
  const trace=Object.keys(traceabilityObjectToSummaryFields({}));
  const headers=[...new Set([...FAST_HAZARD_COLUMNS[method],...common,...(method==='HARA'?['Rating Rationale']:[]),...(method==='STPA'?['Causal Factor','Loss ID','Hazard ID','UCA ID','Hazard → Loss ID','UCA → Hazard ID','Causal Scenario → UCA ID','Safety Constraint → UCA ID']:[]),...trace])];
  return {'Functional Decomposition':input.sheets['Functional Decomposition'],Summary:[headers,...records.map(row=>headers.map(header=>row[header] ?? ''))]};
}

export async function runFastCodeArchitectureHazardAnalysis({previousRun=null,regenerate=false,cbaRows=[],method='STPA-Textbook',repoMeta={},projectId='',operationalContexts=[],selectedOperationalContextId='all',organizationContext='',organizationProfileProvenance=null,setProgress=()=>{},onActivityUpdate=()=>{},onPartialRunUpdate=()=>{},signal}={}) {
  setProgress=safeHazardObserver(setProgress);onActivityUpdate=safeHazardObserver(onActivityUpdate);onPartialRunUpdate=safeHazardObserver(onPartialRunUpdate);
  const normalizedMethod=fastMethod(method);
  if(!normalizedMethod)throw new Error('Unsupported compact hazard method');
  const check=()=>{if(signal?.aborted)throw new DOMException('Hazard analysis cancelled.','AbortError');};
  let percent=0;
  const progress=patch=>{percent=Math.max(percent,Math.min(100,patch.step ?? percent));const update={...patch,step:percent,total:100};setProgress(update);onActivityUpdate(update);};
  check();progress({step:0,message:`Preparing ${normalizedMethod} functional assessments...`});
  if(!cbaRows.length)throw new Error('Generate or load a functional architecture before hazard analysis.');
  if(!functionalModelIsReady(cbaRows) && (cbaRows.some(row=>row.functionalAbstraction) || repoMeta.functionalProcessingError))throw new Error('Generate an up-to-date Functional model before hazard analysis.');
  if(previousRun && fastMethod(previousRun.hazardMethod)!==normalizedMethod)previousRun=null;
  let input=prepareCodeHazardPreprocessing(buildCodeArchitectureHazardInput({cbaRows,method:normalizedMethod==='STPA'?'STPA-Textbook':normalizedMethod,repoMeta,projectId,operationalContexts,selectedOperationalContextId}),previousRun);
  const retainedUserInputs={...previousRun?.retainedUserInputs};
  input={...input,tableRows:input.tableRows.map((row,index)=>{
   if(!row.userPreprocessing)return row;
   const {usable,retained}=usableHazardInputs(row.userPreprocessing.values,normalizedMethod);
   if(Object.keys(retained).length)retainedUserInputs[row.userPreprocessingId || `HA-${index+1}`]={...retainedUserInputs[row.userPreprocessingId || `HA-${index+1}`],...retained};
   return {...row,userPreprocessing:{...row.userPreprocessing,values:usable}};
  })};
  if(!input.tableRows.length)throw new Error('No architecture interfaces are included for hazard analysis.');
  const provider=getStoredActiveAIProvider();
  const context={repository:repoMeta.repoName || input.repoId,organizationProfile:organizationContext || 'No organization profile enabled.',operationalContext:input.operationalContext,analysisContext:input.analysisContext,contextSources:input.contextSources};
  let manifestWarning='',checkpointWarning='',lastAssessmentProgress=null,generating=true;
  const reportAssessmentProgress=()=>{
    if(!generating || signal?.aborted || !lastAssessmentProgress)return;
    const warning=[manifestWarning,checkpointWarning].filter(Boolean).join(' · ');
    progress({...lastAssessmentProgress,message:warning?`${lastAssessmentProgress.message} · ${warning}`:lastAssessmentProgress.message});
  };
  const checkpointController=new AbortController();
  const cancelCheckpoint=()=>checkpointController.abort();
  signal?.addEventListener('abort',cancelCheckpoint,{once:true});
  if(signal?.aborted)cancelCheckpoint();
  try{
  const checkpoint=()=>createCodeHazardCheckpoint({pipeline:FAST_HAZARD_VERSION,projectId,repoId:input.repoId,method:normalizedMethod,provider,model:getStoredAIProviderModelPreference(provider,{includeDefault:true}),effort:getStoredAIProviderEffortPreference(provider)},
    {regenerate,signal:checkpointController.signal,onProgress:progress});
  const sources=compactHazardSources(input.tableRows);
  // Publish a small durable recovery record before any provider work. Row
  // checkpoints hold the assessments; this record makes them discoverable after reload.
  const attemptId=makeCodeArchitectureHazardId('cba-hazard-run');
  const interrupted=normalizeCodeArchitectureHazardRun({
    id:attemptId,sourceRunId:attemptId,projectId,repoId:input.repoId,repoName:repoMeta.repoName || input.repoId,
    pipelineVersion:FAST_HAZARD_VERSION,hazardMethod:method,runState:'incomplete',
    totalAssessments:sources.length,validatedAssessments:0,
    failureMessage:'This analysis was interrupted. Continue to reuse saved assessments with matching inputs.',
    architectureSnapshotHash:input.architectureSnapshotHash,analysisAbstraction:input.analysisAbstraction,
    functionalModelSnapshotHash:input.functionalModelSnapshotHash,
    operationalContexts:input.configuredOperationalContexts,analysisOperationalContexts:input.analysisOperationalContexts,
    operationalContext:input.operationalContext,selectedOperationalContextId:input.selectedOperationalContextId,
    userPreprocessing:previousRun?.userPreprocessing || {},retainedUserInputs,
    preprocessingIdentitySheet:hazardPreprocessingIdentitySheet(previousRun),
    archivedUserPreprocessing:previousRun?.archivedUserPreprocessing || {},
    organizationProfileProvenance:{...organizationProfileProvenance,effectiveContextIdentity:organizationProfileContextIdentity(organizationContext),effectiveEnabled:Boolean(organizationContext)},
  });
  const recoverable=previousRun && !['incomplete','draft'].includes(previousRun.runState)
    ? {...previousRun,pendingAttempt:interrupted,updatedAt:new Date().toISOString()} : interrupted;
  const initialSave=saveCodeArchitectureHazardRun(recoverable,{notify:false});
  // A deadline stops waiting, not writing. Only this save's eventual success
  // clears its warning; unrelated checkpoint writes cannot do so.
  Promise.resolve(initialSave).then(()=>{
    if(!generating || signal?.aborted)return;
    manifestWarning='';reportAssessmentProgress();
  },()=>{});
  try{await waitForHazardSave(initialSave,{signal});}
  catch(error){manifestWarning='Recovery information could not be saved. Keep this browser tab open.';}
  check();
  const sourceById=new Map(sources.map(source=>[source.id,source]));
  const buildRun=(assessments,selectedInput=input)=>{
  const generated=fastHazardSheets(normalizedMethod,selectedInput,assessments);
  const reconciled=reconcileCodeHazardPreprocessing(generated,selectedInput.tableRows);
  for(const row of selectedInput.tableRows)if(row.userPreprocessing && !reconciled.ownership[row.userPreprocessingId])
    retainedUserInputs[row.userPreprocessingId]={...row.userPreprocessing.values};
  validateMergedSheet(normalizedMethod,reconciled.sheets.Summary,assessments.map(assessment=>({...sourceById.get(assessment.id),screenedApplicability:assessment.applicable,screenedRationale:assessment.applicabilityRationale})),index=>{
    const source=selectedInput.tableRows[index-1],id=source.userPreprocessingId || assessments[index-1].id;
    retainedUserInputs[id]={...retainedUserInputs[id],...source.userPreprocessing?.values};
    reconciled.sheets.Summary[index]=[...generated.Summary[index]];
    delete reconciled.ownership[id];
  });
  const basisColumn=reconciled.sheets.Summary[0].indexOf('Assessment Basis');
  const idColumn=reconciled.sheets.Summary[0].indexOf('Raw Analysis Row ID');
  for(const row of reconciled.sheets.Summary.slice(1))if(retainedUserInputs[row[idColumn]] && basisColumn>=0)row[basisColumn]+=' Original imported values requiring normalization or replacement are retained separately; generated values use the stated assessment premises.';
  const id=attemptId;
  return normalizeCodeArchitectureHazardRun({id,sourceRunId:id,projectId,repoId:input.repoId,repoName:repoMeta.repoName || input.repoId,repoUrl:repoMeta.repoUrl,repoPath:repoMeta.repoPath,branch:repoMeta.branch,
    pipelineVersion:FAST_HAZARD_VERSION,runState:'complete',retainedUserInputs,preprocessingIdentitySheet:interrupted.preprocessingIdentitySheet,
    narrativeReviewInput:compactReviewEntries(assessments.map((value,index)=>({source:sourceById.get(value.id),assessment:{...assessments[index],...Object.fromEntries(Object.entries(SUMMARY_ASSESSMENT_FIELDS(normalizedMethod)).filter(([,header])=>reconciled.sheets.Summary[0].includes(header)).map(([field,header])=>[field,reconciled.sheets.Summary[index+1][reconciled.sheets.Summary[0].indexOf(header)]]))}}))),narrativeReviewContext:context,
hazardMethod:method,hazardGenerationMode:'compact',
    architectureSnapshotHash:input.architectureSnapshotHash,analysisAbstraction:input.analysisAbstraction,functionalModelSnapshotHash:input.functionalModelSnapshotHash,
    architectureRowsSnapshot:input.architectureRowsSnapshot,traceabilityMap:input.traceabilityMap,hazardEligibilitySummary:input.eligibilitySummary,excludedArchitectureRows:input.excludedArchitectureRows,needsReviewArchitectureRows:input.needsReviewArchitectureRows,
    operationalContext:input.operationalContext,operationalContexts:input.configuredOperationalContexts,analysisOperationalContexts:input.analysisOperationalContexts,selectedOperationalContextId:input.selectedOperationalContextId,
    organizationProfileProvenance:{...organizationProfileProvenance,effectiveContextIdentity:organizationProfileContextIdentity(organizationContext),effectiveEnabled:Boolean(organizationContext)},
    contextSources:input.contextSources,generatedSheets:reconciled.sheets,
    userPreprocessing:reconciled.ownership,userPreprocessingConflicts:reconciled.conflicts,archivedUserPreprocessing:input.archivedUserPreprocessing || previousRun?.archivedUserPreprocessing || {},
  });
  };
  let assessments;
  try {
    assessments=await generateFastHazards({method:normalizedMethod,sources,context,checkpoint,signal,checkpointSignal:checkpointController.signal,onProgress:patch=>{lastAssessmentProgress=patch;reportAssessmentProgress();},onStorageState:state=>{
      checkpointWarning=state.unsaved?(state.status==='pending'?state.message:'Progress could not be saved. Keep this browser tab open.'):'';
      reportAssessmentProgress();
    }});
  } catch(error) {
    if(Array.isArray(error.partialResults)){
      const byId=new Map(sources.map((source,index)=>[source.id,input.tableRows[index]]));
      const partial=buildRun(error.partialResults,{...input,tableRows:error.partialResults.map(row=>byId.get(row.id))});
      Object.assign(partial,{runState:'incomplete',totalAssessments:sources.length,
        validatedAssessments:error.partialResults.length,failedAssessments:error.failedAssessments || [],
        failureMessage:error.message, userPreprocessing:previousRun?.userPreprocessing || {},
        preprocessingIdentitySheet:interrupted.preprocessingIdentitySheet});
      // Preserve the previous completed result as the authoritative result. Store
      // the incomplete attempt beside it, rather than replacing its Summary.
      const priorComplete=previousRun && !['incomplete','draft'].includes(previousRun.runState);
      const recovery=priorComplete ? {...previousRun,pendingAttempt:partial,updatedAt:new Date().toISOString()} : partial;
      try{await waitForHazardSave(saveCodeArchitectureHazardRun(recovery));}catch(saveError){recovery.finalSavePending=true;recovery.saveFailureMessage=saveError.message;}
      error.recoveryRun=recovery;
      onPartialRunUpdate(recovery);
    }
    throw error;
  }finally{generating=false;}
  check();progress({step:96,message:'Preparing traceable hazard results...'});
  const run=buildRun(assessments);
  check();progress({step:98,message:'Saving hazard results...'});
  onPartialRunUpdate({...run,finalSavePending:true,finalSaveStatus:'saving'});
  try{await waitForHazardSave(saveCodeArchitectureHazardRun(run,{onSaveState:({status,message})=>{if(!signal?.aborted && status!=='saved')onPartialRunUpdate({...run,finalSavePending:true,finalSaveStatus:status,saveFailureMessage:message});}}));}catch(cause){run.finalSavePending=true;run.finalSaveStatus='failed';run.saveFailureMessage=cause.message;onPartialRunUpdate(run);}
  progress({step:100,message:run.finalSavePending?'Hazard results ready — save pending. Export before reloading.':'Hazard results saved.'});
  // Successful checkpoints stay available for a continuation; explicit regeneration clears this pipeline's scope.
  return run;
  }finally{generating=false;checkpointController.abort();signal?.removeEventListener('abort',cancelCheckpoint);}
}
